import { z } from "zod";
import {
  adversarialReviewSchema,
  adjudicateDualReview,
  fullPaperExtractionSchema,
  type DualReviewResponse,
  type SourceArtifact,
} from "./dual-review.ts";
import type { DeepDiveSource } from "./deep-dive.ts";
import {
  renderAgentPrompt,
  resolveAgentPrompt,
  type AgentPromptOverrides,
} from "./agent-prompts.ts";
import {
  epistemicRoleForSourceClass,
  type Acquisition,
  type EpistemicRole,
  type EvidenceStatus,
  type SourceClass,
} from "./source-class.ts";
import type { ResearchClaimFrame } from "./research-brief.ts";
import { parseStructuredWithRepair, repairInstruction, schemaInstruction } from "./structured-output.ts";

const primaryModel = "Astra · GPT 6";
const adversaryModel = "Astra · adversarial full-paper reviewer";
const stageModel = "lyra-chatgpt-pro";
const stageEffort = "medium";
const fetchTimeoutMs = 20_000;
const minimumVerifiedChars = 800;
const hostedTextCap = 12_000;
const userAgent = "Epistack Evidence Lab/0.1 (hosted source adapter)";
const minimumExtractableChars = 40;

export class InsufficientSourceTextError extends Error {
  readonly code = "INSUFFICIENT_SOURCE_TEXT";
  constructor(message: string) {
    super(message);
    this.name = "InsufficientSourceTextError";
  }
}

// The three-axis model treats a comparison as scoped only when topic,
// population, and jurisdiction are explicit. Effectiveness/episode datestamps
// are optional because many normative and registry artifacts do not state them.
export const comparisonScopeSchema = z.object({
  topic: z.string().trim().min(3).max(320),
  population: z.string().trim().min(2).max(320),
  jurisdiction: z.string().trim().min(2).max(200),
  effectiveFrom: z.string().trim().min(4).max(40).optional(),
  effectiveTo: z.string().trim().min(4).max(40).optional(),
});

export type ComparisonScope = z.infer<typeof comparisonScopeSchema>;

export type AcquiredSource = {
  acquisition: "fetched-verified" | "cited-unverified";
  text: string;
  contentHash: string;
  url: string;
  title: string;
  publisher?: string;
  metadata: Record<string, string>;
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

function htmlToPlainText(html: string) {
  return decodeXmlEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(?:p|div|section|article|li|tr|h[1-6]|header|footer|blockquote|pre|table|ul|ol|figure)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
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

async function fetchWithTimeout(url: URL | string) {
  return fetch(url, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
}

async function resolvePmcNumeric(pmid: string) {
  const url = new URL("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/");
  url.searchParams.set("ids", pmid);
  url.searchParams.set("format", "json");
  url.searchParams.set("tool", "epistack-evidence-lab");
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`NCBI PMID-to-PMCID conversion returned ${response.status}.`);
  const payload = await response.json() as { records?: Array<{ pmcid?: string; pmid?: string }> };
  const record = Array.isArray(payload.records)
    ? payload.records.find((candidate) => String(candidate.pmid || "") === pmid) ?? payload.records[0]
    : null;
  return safePmcNumeric(record?.pmcid);
}

async function fetchPmcXml(pmcNumeric: string) {
  const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  url.searchParams.set("db", "pmc");
  url.searchParams.set("id", pmcNumeric);
  url.searchParams.set("retmode", "xml");
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`PMC full-text fetch returned ${response.status}.`);
  const xml = await response.text();
  if (!/<article[\s>]/i.test(xml) || xml.length < 5_000) {
    throw new Error("PMC did not return a complete open-access JATS article.");
  }
  return xml;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

// Keep only the decision-relevant slices of a ClinicalTrials.gov v2 record so
// the artifact stays small, stable, and hashable.
function compactRegistryStudy(payload: unknown, nctId: string) {
  const protocol = asRecord(asRecord(payload).protocolSection);
  const identification = asRecord(protocol.identificationModule);
  const status = asRecord(protocol.statusModule);
  const design = asRecord(protocol.designModule);
  const conditions = asRecord(protocol.conditionsModule);
  const arms = asRecord(protocol.armsInterventionsModule);
  const sponsor = asRecord(protocol.sponsorCollaboratorsModule);
  const description = asRecord(protocol.descriptionModule);
  const startDate = asRecord(status.startDateStruct);
  const completionDate = asRecord(status.completionDateStruct);
  const primaryCompletionDate = asRecord(status.primaryCompletionDateStruct);
  const enrollment = asRecord(design.enrollmentInfo);
  return {
    registrationId: asString(identification.nctId) || nctId,
    title: asString(identification.briefTitle) || asString(identification.officialTitle),
    status: asString(status.overallStatus),
    sponsor: asString(asRecord(sponsor.leadSponsor).name),
    startDate: asString(startDate.date),
    completionDate: asString(completionDate.date) || asString(primaryCompletionDate.date),
    conditions: asStringArray(conditions.conditions),
    interventions: (Array.isArray(arms.interventions) ? arms.interventions : [])
      .map((intervention) => asString(asRecord(intervention).name))
      .filter(Boolean),
    studyType: asString(design.studyType),
    phases: asStringArray(design.phases),
    enrollment: typeof enrollment.count === "number" ? enrollment.count : null,
    briefSummary: asString(description.briefSummary),
    sourceUrl: `https://clinicaltrials.gov/study/${nctId}`,
  };
}

// Acquisition never throws: any failure degrades to a cited-unverified artifact
// so callers can keep the lead without pretending the container was verified.
export async function acquireSource(input: {
  sourceClass: SourceClass;
  url: string;
  title?: string;
  pmid?: string;
  pmcid?: string;
  citedText?: string;
}): Promise<AcquiredSource> {
  const title = (input.title ?? "").trim() || input.url;
  const citedText = (input.citedText ?? "").trim();

  const cited = async (reason: string): Promise<AcquiredSource> => ({
    acquisition: "cited-unverified",
    text: citedText,
    contentHash: await sha256(citedText),
    url: input.url,
    title,
    metadata: { acquisitionNote: reason },
  });

  if (input.sourceClass === "primary-study" || input.sourceClass === "systematic-review") {
    const pmid = (input.pmid ?? "").trim();
    let pmcNumeric = safePmcNumeric(input.pmcid);
    if (!pmcNumeric && pmid) {
      try {
        pmcNumeric = await resolvePmcNumeric(pmid);
      } catch {
        pmcNumeric = null;
      }
    }
    if (pmcNumeric) {
      try {
        const text = jatsToPlainText(await fetchPmcXml(pmcNumeric));
        const pmcid = `PMC${pmcNumeric}`;
        return {
          acquisition: "fetched-verified",
          text,
          contentHash: await sha256(text),
          url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
          title,
          metadata: { pmcid, pmid, source: "pmc-jats" },
        };
      } catch {
        // Fall through to a best-effort public URL fetch, then the cited text.
      }
    }
  }

  if (input.sourceClass === "trial-registry") {
    const nctMatch = input.url.match(/NCT\d{8}/i);
    if (nctMatch) {
      const nctId = nctMatch[0].toUpperCase();
      try {
        const response = await fetchWithTimeout(`https://clinicaltrials.gov/api/v2/studies/${nctId}`);
        if (response.ok) {
          const text = JSON.stringify(compactRegistryStudy(await response.json(), nctId), null, 2);
          return {
            acquisition: "fetched-verified",
            text,
            contentHash: await sha256(text),
            url: `https://clinicaltrials.gov/study/${nctId}`,
            title,
            metadata: { registrationId: nctId, source: "clinicaltrials-v2" },
          };
        }
      } catch {
        // Fall through to the cited text.
      }
    }
    return cited("No ClinicalTrials.gov registry record could be fetched; retaining the cited description only.");
  }

  // guideline / standard / official-statistics / preprint / reporting / anecdote
  try {
    const response = await fetchWithTimeout(input.url);
    if (response.ok) {
      const text = htmlToPlainText(await response.text());
      if (text.length >= minimumVerifiedChars) {
        return {
          acquisition: "fetched-verified",
          text,
          contentHash: await sha256(text),
          url: input.url,
          title,
          metadata: { source: "html" },
        };
      }
    }
  } catch {
    // Fall through to the cited text.
  }
  return cited("The URL could not be fetched or returned too little text; retaining the cited description only.");
}

async function runSchemaExtraction<T>(input: {
  schema: z.ZodType<T>;
  instructions: string;
  task: string;
}): Promise<T> {
  const { runLyraStage } = await import("./lyra-stage.ts");
  const first = await runLyraStage({
    model: stageModel,
    effort: stageEffort,
    instructions: input.instructions + schemaInstruction(input.schema),
    input: input.task,
  });
  return parseStructuredWithRepair({
    text: first,
    schema: input.schema,
    repair: async ({ raw, issues }) => runLyraStage({
      model: stageModel,
      effort: stageEffort,
      instructions: input.instructions + repairInstruction(input.schema, issues),
      input: `${input.task}\n\nPREVIOUS ATTEMPT (failed schema validation):\n${raw}`,
    }),
  });
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

function applicabilityProfileText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 20_000);
  if (value && typeof value === "object") return JSON.stringify(value, null, 2).slice(0, 20_000);
  return "No structured applicability profile supplied.";
}

function inlineArtifactText(fullText: string) {
  const truncated = fullText.length > hostedTextCap;
  const body = truncated ? fullText.slice(0, hostedTextCap) : fullText;
  const note = truncated
    ? `\n\n[The preserved plain-text artifact was truncated to its first ${hostedTextCap.toLocaleString()} characters of ${fullText.length.toLocaleString()} for this hosted run. The SHA-256 above still attests to the complete artifact.]`
    : "";
  return [
    "PRESERVED SOURCE ARTIFACT (plain text inlined for the hosted run)",
    "----- BEGIN ARTIFACT -----",
    body,
    "----- END ARTIFACT -----",
  ].join("\n") + note;
}

export const normativeExtractionSchema = z.object({
  recommendations: z.array(z.object({
    id: z.string().trim().min(2).max(80),
    statement: z.string().trim().min(8).max(620),
    strength: z.string().trim().min(2).max(160),
    issuingBody: z.string().trim().min(2).max(240),
    effectiveDate: z.string().trim().max(40).optional(),
    comparisonScope: comparisonScopeSchema,
  })).min(1).max(20),
});

export const descriptiveExtractionSchema = z.object({
  statistics: z.array(z.object({
    measure: z.string().trim().min(1).max(220),
    value: z.string().trim().min(1).max(140),
    unit: z.string().trim().max(140).optional(),
    population: z.string().trim().min(1).max(320),
    geography: z.string().trim().min(1).max(220),
    period: z.string().trim().min(1).max(140),
    datasetVersion: z.string().trim().max(160).optional(),
    comparisonScope: comparisonScopeSchema,
  })).min(1).max(30),
});

export const statusExtractionSchema = z.object({
  registry: z.object({
    registrationId: z.string().trim().min(3).max(120),
    title: z.string().trim().min(3).max(420),
    status: z.string().trim().min(2).max(160),
    sponsor: z.string().trim().min(2).max(320),
    startDate: z.string().trim().max(40).optional(),
    completionDate: z.string().trim().max(40).optional(),
    conditions: z.array(z.string().trim().min(1).max(180)).max(30),
    interventions: z.array(z.string().trim().min(1).max(220)).max(30),
    comparisonScope: comparisonScopeSchema,
  }),
});

export const contextExtractionSchema = z.object({
  signals: z.array(z.object({
    claim: z.string().trim().min(8).max(620),
    signalType: z.string().trim().min(2).max(140),
    sourceType: z.string().trim().min(2).max(140),
  })).min(1).max(20),
});

// A cited-only causal source can never become evidence. It only produces up to
// three explicitly unverified proposals for human triage.
export const citedCausalExtractionSchema = z.object({
  results: z.array(z.object({
    unverified: z.literal(true),
    analysisLabel: z.string().trim().min(3).max(160),
    resultText: z.string().trim().min(8).max(520),
    claimFrameId: z.string().trim().min(2).max(80),
    relation: z.enum(["supports", "contradicts", "qualifies", "undercuts", "bounds", "not-informative"]),
    exactExcerpt: z.string().max(420),
  })).min(1).max(3),
});

export type SourceReviewResponse = {
  source: {
    sourceClass: SourceClass;
    url: string;
    title: string;
    publisher?: string;
    acquisition: Acquisition;
    contentHash: string;
  };
  role: EpistemicRole;
  evidenceStatus: EvidenceStatus;
  preliminary: boolean;
  payload: unknown;
};

// The class/acquisition to schema mapping. A causal fetched-verified artifact
// runs the full dual review (null here); every other combination maps to one
// of the typed non-causal extractors.
export function extractionSchemaFor(
  sourceClass: SourceClass,
  acquisition: Acquisition,
): z.ZodType<unknown> | null {
  const causal = sourceClass === "primary-study"
    || sourceClass === "systematic-review"
    || sourceClass === "preprint";
  if (causal) {
    return acquisition === "cited-unverified" ? citedCausalExtractionSchema : null;
  }
  if (sourceClass === "guideline" || sourceClass === "standard") return normativeExtractionSchema;
  if (sourceClass === "official-statistics") return descriptiveExtractionSchema;
  if (sourceClass === "trial-registry") return statusExtractionSchema;
  return contextExtractionSchema;
}

type ExtractionInput = {
  sourceClass: SourceClass;
  acquisition: Acquisition;
  acquired: AcquiredSource;
  question: string;
  decisionContext: string;
  claimFrames: ResearchClaimFrame[];
  applicabilityProfile: unknown;
  promptOverrides: AgentPromptOverrides;
};

function extractionTask(input: ExtractionInput) {
  return renderAgentPrompt(`RESEARCH QUESTION
{{question}}

DECISION CONTEXT
{{decisionContext}}

SOURCE CLASS
{{sourceClass}} (fixed epistemic role: {{role}})

ACQUISITION
{{acquisition}}

SOURCE
Title: {{title}}
URL: {{url}}
Publisher: {{publisher}}
Content SHA-256: {{contentHash}}

CLAIM FRAMES
{{claimFrames}}

LOCAL APPLICABILITY PROFILE
{{applicabilityProfile}}

SOURCE TEXT
----- BEGIN SOURCE -----
{{sourceText}}
----- END SOURCE -----`, {
    question: input.question,
    decisionContext: input.decisionContext,
    sourceClass: input.sourceClass,
    role: epistemicRoleForSourceClass(input.sourceClass),
    acquisition: input.acquisition,
    title: input.acquired.title,
    url: input.acquired.url,
    publisher: input.acquired.publisher ?? "not stated",
    contentHash: input.acquired.contentHash,
    claimFrames: claimFramesText(input.claimFrames),
    applicabilityProfile: applicabilityProfileText(input.applicabilityProfile),
    sourceText: inlineArtifactText(input.acquired.text),
  });
}

async function runCausalDualReview(input: ExtractionInput): Promise<DualReviewResponse> {
  const artifact: SourceArtifact = {
    kind: "pmc-jats",
    pmcid: input.acquired.metadata.pmcid || `NONPMC-${input.acquired.contentHash.slice(0, 12)}`,
    canonicalUrl: input.acquired.url,
    localXmlPath: "(hosted inline)",
    localTextPath: "(hosted inline)",
    contentHash: input.acquired.contentHash,
    retrievedAt: new Date().toISOString(),
  };
  const source: DeepDiveSource = {
    pmid: input.acquired.metadata.pmid ?? "",
    title: input.acquired.title,
    authors: input.acquired.metadata.authors ?? "Authors not returned",
    journal: input.acquired.publisher ?? input.acquired.metadata.journal ?? "Publisher not returned",
    published: input.acquired.metadata.published ?? "Date not returned",
    doi: input.acquired.metadata.doi ?? null,
    url: input.acquired.url,
    abstract: "",
  };
  const artifactText = inlineArtifactText(input.acquired.text);
  const commonValues = {
    question: input.question,
    decisionContext: input.decisionContext,
    citation: [
      input.acquired.title,
      source.authors,
      `${source.journal} · ${source.published}`,
      input.acquired.url,
    ].join("\n"),
    artifactTextPath: artifactText,
    artifactXmlPath: "(The acquired artifact is supplied as plain text above.)",
    artifactHash: input.acquired.contentHash,
    claimFrames: claimFramesText(input.claimFrames),
    applicabilityProfile: applicabilityProfileText(input.applicabilityProfile),
  };

  const extractorAgent = resolveAgentPrompt("full-paper-extractor", input.promptOverrides);
  const primary = await runSchemaExtraction({
    schema: fullPaperExtractionSchema,
    instructions: extractorAgent.instructions,
    task: renderAgentPrompt(extractorAgent.taskTemplate, commonValues),
  });

  const indexedCandidate = primary.results.map((result, resultIndex) => ({ resultIndex, ...result }));
  const reviewerAgent = resolveAgentPrompt("adversarial-reviewer", input.promptOverrides);
  const review = await runSchemaExtraction({
    schema: adversarialReviewSchema,
    instructions: reviewerAgent.instructions,
    task: renderAgentPrompt(reviewerAgent.taskTemplate, {
      ...commonValues,
      candidateJson: JSON.stringify({ ...primary, results: indexedCandidate }, null, 2),
    }),
  });

  const adjudicated = adjudicateDualReview({
    primary,
    review,
    fullText: input.acquired.text,
    artifact,
    primaryModel,
    adversaryModel,
  });
  return {
    source,
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
    cache: {
      status: "miss",
      key: `source-review-${(await sha256(JSON.stringify({
        url: input.acquired.url,
        contentHash: input.acquired.contentHash,
        question: input.question,
        decisionContext: input.decisionContext,
        claimFrames: input.claimFrames,
        applicabilityProfile: input.applicabilityProfile,
        promptOverrides: input.promptOverrides,
      }))).slice(0, 32)}`,
      createdAt: new Date().toISOString(),
    },
  };
}

export async function extractSource(input: ExtractionInput): Promise<{
  role: EpistemicRole;
  evidenceStatus: EvidenceStatus;
  payload: unknown;
}> {
  const role = epistemicRoleForSourceClass(input.sourceClass);

  if (input.acquired.text.trim().length < minimumExtractableChars) {
    throw new InsufficientSourceTextError(
      input.acquired.acquisition === "cited-unverified"
        ? "The source could not be fetched and no citable text was supplied, so there is nothing to extract. Open the source or paste its text, then retry."
        : "The acquired artifact contained too little text to extract from.",
    );
  }

  if (role === "causal") {
    if (input.acquisition === "fetched-verified") {
      return { role, evidenceStatus: "reviewed", payload: await runCausalDualReview(input) };
    }
    const payload = await runSchemaExtraction({
      schema: citedCausalExtractionSchema,
      instructions: [
        "You triage a cited-only description of a causal study whose full text could not be acquired.",
        "Propose at most three results the cited text actually asserts. Work only from the cited text.",
        "Every result must set unverified: true. These are human-triage leads and can never be promoted as verified study results.",
        "exactExcerpt must be a short exact substring of the cited text or an empty string.",
      ].join("\n"),
      task: extractionTask(input),
    });
    return { role, evidenceStatus: "extracted", payload };
  }

  if (input.sourceClass === "guideline" || input.sourceClass === "standard") {
    const payload = await runSchemaExtraction({
      schema: normativeExtractionSchema,
      instructions: [
        "You extract the normative recommendations a guideline or standard makes.",
        "A recommendation is a directive or guidance, never a study finding. Do not upgrade this source to causal evidence.",
        "strength must be the document's own wording (for example \"strong\", \"conditional\", or its exact phrasing).",
        "comparisonScope is required for every recommendation and must name the topic, population, and jurisdiction the recommendation governs.",
      ].join("\n"),
      task: extractionTask(input),
    });
    return { role, evidenceStatus: "extracted", payload };
  }

  if (input.sourceClass === "official-statistics") {
    const payload = await runSchemaExtraction({
      schema: descriptiveExtractionSchema,
      instructions: [
        "You extract descriptive statistics an official statistics source reports.",
        "These are descriptive facts about a population or territory, never causal effects.",
        "comparisonScope is required for every statistic and must name the topic, population, and jurisdiction it describes.",
      ].join("\n"),
      task: extractionTask(input),
    });
    return { role, evidenceStatus: "extracted", payload };
  }

  if (input.sourceClass === "trial-registry") {
    const payload = await runSchemaExtraction({
      schema: statusExtractionSchema,
      instructions: [
        "You extract the single trial registry record this source describes.",
        "Report registration status and planned design only; a registry entry is status, not a study result.",
        "comparisonScope is required and must name the topic, population, and jurisdiction of the registered study.",
      ].join("\n"),
      task: extractionTask(input),
    });
    return { role, evidenceStatus: "extracted", payload };
  }

  const payload = await runSchemaExtraction({
    schema: contextExtractionSchema,
    instructions: [
      "You extract discrete context signals (reporting, commentary, or lived experience) as hypotheses only.",
      "These signals can never be evidence that an intervention causes an effect. Keep each claim clearly hypothetical.",
      "comparisonScope is not required here; instead label the signal type and the source type.",
    ].join("\n"),
    task: extractionTask(input),
  });
  return { role, evidenceStatus: "extracted", payload };
}

export { fullPaperExtractionSchema };
