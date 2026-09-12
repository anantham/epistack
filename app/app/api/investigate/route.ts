import { z } from "zod";
import { renderAgentPrompt, resolveAgentPrompt, sanitizeAgentPromptOverrides } from "../../../lib/agent-prompts";
import {
  adversarialReviewSchema,
  adjudicateDualReview,
  fullPaperExtractionSchema,
  type DualReviewResponse,
  type SourceArtifact,
} from "../../../lib/dual-review";
import type { DeepDiveSource } from "../../../lib/deep-dive";
import { lyraConfigured, runLyraStage } from "../../../lib/lyra-stage";
import { researchClaimFrameSchema, type ResearchClaimFrame } from "../../../lib/research-brief";

const primaryModel = "Astra · GPT 6";
// A distinct role label: the adversarial pass is an independent full-text read
// with the reviewer contract. The dual-review gate requires the two labels to
// differ, and Astra exposes one general chat model.
const adversaryModel = "Astra · adversarial full-paper reviewer";
const hostedTextCap = 55_000;

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

class FullTextUnavailableError extends Error {
  readonly code = "NO_OPEN_FULL_TEXT";
}

type InvestigateRequest = {
  record?: {
    pmid?: unknown;
    pmcid?: unknown;
    title?: unknown;
    authors?: unknown;
    journal?: unknown;
    published?: unknown;
    doi?: unknown;
    url?: unknown;
  } | null;
  question?: unknown;
  decisionContext?: unknown;
  claimFrames?: unknown;
  applicabilityProfile?: unknown;
  promptOverrides?: unknown;
  refresh?: unknown;
};

type NormalizedRecord = {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  published: string;
  doi: string | null;
  url: string;
};

function decodeXmlEntities(value: string) {
  const named = new Map([
    ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"],
    ["nbsp", " "], ["minus", "−"], ["ndash", "–"], ["mdash", "—"], ["times", "×"],
  ]);
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named.get(code.toLowerCase()) ?? entity;
  });
}

function jatsToPlainText(xml: string) {
  return decodeXmlEntities(xml
    .replace(/<\/?(?:p|sec|title|caption|tr|table-wrap|fig|list-item|abstract|article-title|kwd|ack|fn|ref-list)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safePmcNumeric(value: unknown) {
  const numeric = String(value || "").replace(/^PMC/i, "");
  return /^\d{4,12}$/.test(numeric) ? numeric : null;
}

async function resolvePmcNumeric(pmid: string) {
  const url = new URL("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/");
  url.searchParams.set("ids", pmid);
  url.searchParams.set("format", "json");
  url.searchParams.set("tool", "epistack-evidence-lab");
  const response = await fetch(url, {
    headers: { "User-Agent": "Epistack Evidence Lab/0.1 (hosted full-text review)" },
  });
  if (!response.ok) throw new Error(`NCBI PMID-to-PMCID conversion returned ${response.status}.`);
  const payload = await response.json() as { records?: Array<{ pmcid?: string; pmid?: string }> };
  const record = Array.isArray(payload.records)
    ? payload.records.find((candidate) => String(candidate.pmid || "") === pmid) ?? payload.records[0]
    : null;
  return safePmcNumeric(record?.pmcid);
}

async function acquirePmcArtifact(pmid: string) {
  const pmcNumeric = await resolvePmcNumeric(pmid);
  if (!pmcNumeric) {
    throw new FullTextUnavailableError("No open PMC full text is linked to this PubMed record. Automatic promotion is disabled; use the explicit abstract-only fallback.");
  }
  const pmcid = `PMC${pmcNumeric}`;
  const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  url.searchParams.set("db", "pmc");
  url.searchParams.set("id", pmcNumeric);
  url.searchParams.set("retmode", "xml");
  const response = await fetch(url, {
    headers: { "User-Agent": "Epistack Evidence Lab/0.1 (hosted full-text review)" },
  });
  if (!response.ok) throw new Error(`PMC full-text fetch returned ${response.status}.`);
  const xml = await response.text();
  if (!/<article[\s>]/i.test(xml) || xml.length < 5_000) {
    throw new FullTextUnavailableError("PMC did not return a complete open-access JATS article for this record.");
  }
  const artifact: SourceArtifact = {
    kind: "pmc-jats",
    pmcid,
    canonicalUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
    localXmlPath: "(hosted inline)",
    localTextPath: "(hosted inline)",
    contentHash: await sha256(xml),
    retrievedAt: new Date().toISOString(),
  };
  return { artifact, plainText: jatsToPlainText(xml) };
}

function inlineArtifactText(fullText: string) {
  const truncated = fullText.length > hostedTextCap;
  const body = truncated ? fullText.slice(0, hostedTextCap) : fullText;
  const note = truncated
    ? `\n\n[The preserved plain-text artifact was truncated to its first ${hostedTextCap.toLocaleString()} characters of ${fullText.length.toLocaleString()} for this hosted run. The SHA-256 above still attests to the complete artifact.]`
    : "";
  return [
    "PRESERVED FULL-TEXT ARTIFACT (plain text inlined for the hosted run)",
    "----- BEGIN ARTIFACT -----",
    body,
    "----- END ARTIFACT -----",
  ].join("\n") + note;
}

function stripMarkdownFences(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function parseStructured<T>(text: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(stripMarkdownFences(text)));
}

function citationFor(record: NormalizedRecord) {
  return [record.title, record.authors, `${record.journal} · ${record.published}`, `PMID ${record.pmid}${record.doi ? ` · DOI ${record.doi}` : ""}`].join("\n");
}

function sourceFor(record: NormalizedRecord, artifact: SourceArtifact): DeepDiveSource {
  return {
    pmid: record.pmid,
    title: record.title,
    authors: record.authors,
    journal: record.journal,
    published: record.published,
    doi: record.doi,
    url: artifact.canonicalUrl,
    abstract: "",
  };
}

function claimFramesText(claimFrames: ResearchClaimFrame[]) {
  return claimFrames.map((frame) => [
    frame.id,
    frame.statement,
    `Kind: ${frame.kind}`,
    `Population: ${frame.population}`,
    `Exposure: ${frame.exposure}`,
    `Comparator: ${frame.comparator}`,
    `Outcome: ${frame.outcome}`,
    `Time horizon: ${frame.timeHorizon}`,
    `Applicability fields: ${frame.applicabilityFields.join(", ")}`,
  ].join("\n")).join("\n\n");
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Use this site to run a hosted full-text review." }, 403);
  }
  if (!lyraConfigured()) {
    return json({ error: "Hosted full-text review is not configured yet.", code: "hosted-not-configured" }, 503);
  }

  let body: InvestigateRequest;
  try {
    body = await request.json() as InvestigateRequest;
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const record = body.record;
  const pmid = typeof record?.pmid === "string" ? record.pmid.trim() : "";
  if (!/^\d{5,12}$/.test(pmid)) {
    return json({ error: "A valid PubMed identifier is required." }, 400);
  }
  const parsedClaimFrames = researchClaimFrameSchema.array().min(1).max(7).safeParse(body.claimFrames);
  if (!parsedClaimFrames.success) {
    return json({
      error: "The investigation request is missing the compiled claim frames. Return to Contextualize and compile a research brief first.",
    }, 400);
  }
  if (body.promptOverrides && JSON.stringify(body.promptOverrides).length > 120_000) {
    return json({ error: "Prompt overrides are too large." }, 400);
  }

  const claimFrames = parsedClaimFrames.data;
  const normalizedRecord: NormalizedRecord = {
    pmid,
    title: typeof record?.title === "string" && record.title.trim() ? record.title.trim() : "Untitled PubMed record",
    authors: typeof record?.authors === "string" && record.authors.trim() ? record.authors.trim() : "Authors not returned",
    journal: typeof record?.journal === "string" && record.journal.trim() ? record.journal.trim() : "Journal not returned",
    published: typeof record?.published === "string" && record.published.trim() ? record.published.trim() : "Date not returned",
    doi: typeof record?.doi === "string" && record.doi.trim() ? record.doi.trim() : null,
    url: typeof record?.url === "string" && record.url.trim() ? record.url.trim() : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  };
  const question = typeof body.question === "string" && body.question.trim()
    ? body.question.trim().slice(0, 4_000)
    : "What does this source establish about the supplied claim frames?";
  const decisionContext = typeof body.decisionContext === "string" && body.decisionContext.trim()
    ? body.decisionContext.trim().slice(0, 8_000)
    : "No personal decision context supplied.";
  const applicabilityProfile = body.applicabilityProfile && typeof body.applicabilityProfile === "object"
    ? JSON.stringify(body.applicabilityProfile, null, 2).slice(0, 20_000)
    : "No structured applicability profile supplied.";
  const promptOverrides = sanitizeAgentPromptOverrides(body.promptOverrides);
  const refresh = body.refresh === true;

  try {
    const { artifact, plainText } = await acquirePmcArtifact(pmid);
    const artifactText = inlineArtifactText(plainText);
    const commonValues = {
      question,
      decisionContext,
      citation: citationFor(normalizedRecord),
      artifactTextPath: artifactText,
      artifactXmlPath: "(JATS XML is not separately inlined for the hosted run; the preserved article is supplied as plain text above.)",
      artifactHash: artifact.contentHash,
      claimFrames: claimFramesText(claimFrames),
      applicabilityProfile,
    };

    const extractorAgent = resolveAgentPrompt("full-paper-extractor", promptOverrides);
    const extractorInstructions = extractorAgent.instructions
      + "\nReturn only one JSON object matching this schema. No markdown fences.\n"
      + JSON.stringify(z.toJSONSchema(fullPaperExtractionSchema));
    const primaryRaw = await runLyraStage({
      model: "lyra-chatgpt-pro",
      effort: "medium",
      instructions: extractorInstructions,
      input: renderAgentPrompt(extractorAgent.taskTemplate, commonValues),
    });
    const primary = parseStructured(primaryRaw, fullPaperExtractionSchema);

    const indexedCandidate = primary.results.map((result, resultIndex) => ({ resultIndex, ...result }));
    const reviewerAgent = resolveAgentPrompt("adversarial-reviewer", promptOverrides);
    const reviewerInstructions = reviewerAgent.instructions
      + "\nReturn only one JSON object matching this schema. No markdown fences.\n"
      + JSON.stringify(z.toJSONSchema(adversarialReviewSchema));
    const reviewRaw = await runLyraStage({
      model: "lyra-chatgpt-pro",
      effort: "medium",
      instructions: reviewerInstructions,
      input: renderAgentPrompt(reviewerAgent.taskTemplate, {
        ...commonValues,
        candidateJson: JSON.stringify({ ...primary, results: indexedCandidate }, null, 2),
      }),
    });
    const review = parseStructured(reviewRaw, adversarialReviewSchema);

    const adjudicated = adjudicateDualReview({
      primary,
      review,
      fullText: plainText,
      artifact,
      primaryModel,
      adversaryModel,
    });
    const cacheKey = `investigate-${(await sha256(JSON.stringify({
      pmid,
      artifactHash: artifact.contentHash,
      question,
      decisionContext,
      claimFrames,
      applicabilityProfile,
      promptOverrides,
    }))).slice(0, 32)}`;
    const response: DualReviewResponse = {
      source: sourceFor(normalizedRecord, artifact),
      artifact,
      primaryCandidate: primary,
      candidate: adjudicated.candidate,
      review,
      decisions: adjudicated.decisions,
      promotion: {
        policyId: adjudicated.policyId,
        eligible: adjudicated.eligible,
        acceptedCount: adjudicated.acceptedCount,
        rejectedCount: adjudicated.rejectedCount,
        reasons: adjudicated.reasons,
      },
      models: { primary: primaryModel, adversary: adversaryModel },
      verificationStatus: "ai-cross-checked-full-text",
      cache: { status: refresh ? "bypass" : "miss", key: cacheKey, createdAt: new Date().toISOString() },
    };
    return json(response);
  } catch (error) {
    if (error instanceof FullTextUnavailableError) {
      return json({ error: error.message, code: error.code }, 200);
    }
    return json({
      error: error instanceof Error ? error.message : "The hosted full-text review failed.",
    }, 502);
  }
}
