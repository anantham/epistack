import { ensureDecisionTables, ensureEvidenceGraphTables, getD1 } from "../../../db";
import { deepDiveSchema, type DeepDiveSource } from "../../../lib/deep-dive";
import {
  adversarialReviewSchema,
  dualReviewPolicyId,
  passageExists,
  reviewDecisionSchema,
  type SourceArtifact,
} from "../../../lib/dual-review";
import { researchClaimFrameSchema } from "../../../lib/research-brief";
import {
  acquisitionSchema,
  canExtractAsStudyResult,
  canReachAcceptedEvidence,
  epistemicRoleForSourceClass,
  isPreliminarySourceClass,
  sourceClassSchema,
} from "../../../lib/source-class";
import { promotedResultSemanticKey, stableSemanticId } from "../../../lib/stable-record-id";

type PromoteRequest = {
  caseId?: unknown;
  originalPrompt?: unknown;
  compiledQuestion?: unknown;
  source?: unknown;
  candidate?: unknown;
  model?: unknown;
  humanChecked?: unknown;
  reviewMode?: unknown;
  verificationStatus?: unknown;
  artifact?: unknown;
  adversarialReview?: unknown;
  claimFrames?: unknown;
  sourceClass?: unknown;
  acquisition?: unknown;
  preliminary?: unknown;
};

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function validCaseId(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/.test(value.trim());
}

function decodeXmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    minus: "−",
    ndash: "–",
    mdash: "—",
    times: "×",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code.toLowerCase()] ?? entity;
  });
}

function jatsToPlainText(xml: string) {
  return decodeXmlEntities(xml
    .replace(/<\/?(?:p|sec|title|caption|tr|table-wrap|fig|list-item|abstract|article-title|kwd|ack|fn|ref-list)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

class PromotionVerificationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type PersistedPmcArtifact = {
  kind: "pmc-jats";
  pmcid: string;
  canonicalUrl: string;
  contentHash: string;
  serverVerified: true;
};

async function independentlyVerifyPmcArtifact(input: {
  pmid: string;
  artifact: Partial<SourceArtifact>;
  exactExcerpts: string[];
}): Promise<PersistedPmcArtifact> {
  const declaredPmcid = typeof input.artifact.pmcid === "string"
    ? input.artifact.pmcid.trim().toUpperCase()
    : "";
  try {
    const conversionUrl = new URL("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/");
    conversionUrl.searchParams.set("ids", input.pmid);
    conversionUrl.searchParams.set("format", "json");
    conversionUrl.searchParams.set("tool", "epistack-evidence-lab");
    const conversionResponse = await fetch(conversionUrl, {
      headers: { "User-Agent": "Epistack Evidence Lab/0.1 (promotion verification)" },
    });
    if (!conversionResponse.ok) {
      throw new PromotionVerificationError(
        `NCBI PMID-to-PMCID verification returned ${conversionResponse.status}; no evidence was promoted.`,
        "PMC_ID_RESOLUTION_FAILED",
        502,
      );
    }
    const conversion = await conversionResponse.json() as {
      records?: Array<{ pmcid?: string; pmid?: string }>;
    };
    const resolved = conversion.records?.find((record) => String(record.pmid || "") === input.pmid)
      ?? conversion.records?.[0];
    const resolvedPmcid = typeof resolved?.pmcid === "string" ? resolved.pmcid.trim().toUpperCase() : "";
    if (!/^PMC\d{4,12}$/.test(resolvedPmcid) || resolvedPmcid !== declaredPmcid) {
      throw new PromotionVerificationError(
        "The declared PMCID does not resolve from the supplied PMID at NCBI; no evidence was promoted.",
        "PMID_PMCID_MISMATCH",
        409,
      );
    }

    const pmcNumeric = resolvedPmcid.slice(3);
    const fullTextUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
    fullTextUrl.searchParams.set("db", "pmc");
    fullTextUrl.searchParams.set("id", pmcNumeric);
    fullTextUrl.searchParams.set("retmode", "xml");
    const fullTextResponse = await fetch(fullTextUrl, {
      headers: { "User-Agent": "Epistack Evidence Lab/0.1 (promotion verification)" },
    });
    if (!fullTextResponse.ok) {
      throw new PromotionVerificationError(
        `NCBI PMC full-text verification returned ${fullTextResponse.status}; no evidence was promoted.`,
        "PMC_FETCH_FAILED",
        502,
      );
    }
    const xml = await fullTextResponse.text();
    if (!/<article[\s>]/i.test(xml) || xml.length < 5_000) {
      throw new PromotionVerificationError(
        "NCBI did not return a complete JATS article; no evidence was promoted.",
        "PMC_ARTIFACT_INCOMPLETE",
        502,
      );
    }
    const fetchedHash = await sha256(xml);
    const declaredHash = typeof input.artifact.contentHash === "string"
      ? input.artifact.contentHash.trim().toLowerCase()
      : "";
    if (fetchedHash !== declaredHash) {
      throw new PromotionVerificationError(
        "The independently fetched PMC artifact does not match the declared SHA-256; no evidence was promoted.",
        "PMC_ARTIFACT_HASH_MISMATCH",
        409,
      );
    }
    const plainText = jatsToPlainText(xml);
    const missingExcerpt = input.exactExcerpts.find((excerpt) => !passageExists(plainText, excerpt));
    if (missingExcerpt) {
      throw new PromotionVerificationError(
        "At least one promoted excerpt was not found in the independently fetched PMC article; no evidence was promoted.",
        "PMC_EXCERPT_NOT_FOUND",
        422,
      );
    }
    return {
      kind: "pmc-jats",
      pmcid: resolvedPmcid,
      canonicalUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${resolvedPmcid}/`,
      contentHash: fetchedHash,
      serverVerified: true,
    };
  } catch (error) {
    if (error instanceof PromotionVerificationError) throw error;
    throw new PromotionVerificationError(
      `Independent PMC verification could not reach or parse NCBI: ${error instanceof Error ? error.message : "unknown network failure"}. No evidence was promoted.`,
      "PMC_VERIFICATION_UNAVAILABLE",
      502,
    );
  }
}

export async function GET(request: Request) {
  try {
    await ensureEvidenceGraphTables();
    const d1 = getD1();
    const requestedCaseId = new URL(request.url).searchParams.get("caseId")?.trim();
    if (!validCaseId(requestedCaseId)) {
      return Response.json({ error: "A valid caseId is required." }, { status: 400 });
    }
    const caseId = requestedCaseId;
    const rows = await d1.prepare(`SELECT
        s.pmid, s.title, s.canonical_url AS source_url,
        rr.id AS result_id, rr.result_text, rr.verification_status, rr.locator,
        er.relation, er.scope_match, er.rationale, er.status, er.created_at,
        dg.label AS family_label, dg.reason AS family_reason
      FROM evidence_relations er
      JOIN result_records rr ON rr.id = er.result_id
      JOIN analyses a ON a.id = rr.analysis_id
      JOIN studies st ON st.id = a.study_id
      JOIN sources s ON s.id = st.source_id
      JOIN dependence_groups dg ON dg.id = rr.dependence_group_id
      WHERE er.case_id = ?
      ORDER BY er.created_at DESC`)
      .bind(caseId)
      .all();
    return Response.json({ caseId, records: rows.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The promotion register could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: PromoteRequest;
  try {
    body = await request.json() as PromoteRequest;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = deepDiveSchema.safeParse(body.candidate);
  if (!parsed.success) {
    return Response.json({ error: "The proposed extraction no longer matches the canonical result contract." }, { status: 400 });
  }
  if (!validCaseId(body.caseId)) {
    return Response.json({
      error: "A valid lowercase caseId is required; evidence is never written to a fallback case.",
    }, { status: 400 });
  }
  const caseId = body.caseId.trim();
  const rawSource = body.source as Partial<DeepDiveSource> | null;
  const suppliedClaimFrames = researchClaimFrameSchema.array().min(1).max(7).safeParse(body.claimFrames);
  if (!suppliedClaimFrames.success) {
    return Response.json({
      error: "The complete validated claim-frame set is required; return to Contextualize and compile the research brief.",
    }, { status: 400 });
  }
  const promotableClaimFrames = suppliedClaimFrames.data;
  const uniqueClaimIds = new Set(promotableClaimFrames.map((claim) => claim.id));
  if (uniqueClaimIds.size !== promotableClaimFrames.length) {
    return Response.json({ error: "Claim-frame IDs must be unique within the compiled research brief." }, { status: 400 });
  }
  const pmid = typeof rawSource?.pmid === "string" ? rawSource.pmid.trim() : "";
  if (
    !/^\d{5,12}$/.test(pmid)
    || typeof rawSource?.title !== "string"
    || rawSource.title.trim().length < 4
    || typeof rawSource?.url !== "string"
    || !/^https?:\/\//i.test(rawSource.url)
  ) {
    return Response.json({ error: "Source provenance is incomplete." }, { status: 400 });
  }
  const autoRequested = body.reviewMode === "adversarial-auto";
  const rawArtifact = body.artifact as Partial<SourceArtifact> | null;
  const reviewEnvelope = body.adversarialReview as {
    policyId?: unknown;
    models?: { primary?: unknown; adversary?: unknown };
    review?: unknown;
    decisions?: unknown;
  } | null;
  const parsedReview = autoRequested ? adversarialReviewSchema.safeParse(reviewEnvelope?.review) : null;
  const parsedDecisions = autoRequested ? reviewDecisionSchema.array().min(1).max(6).safeParse(reviewEnvelope?.decisions) : null;
  const primaryModel = typeof reviewEnvelope?.models?.primary === "string" ? reviewEnvelope.models.primary.trim() : "";
  const adversaryModel = typeof reviewEnvelope?.models?.adversary === "string" ? reviewEnvelope.models.adversary.trim() : "";
  const artifactHash = typeof rawArtifact?.contentHash === "string" ? rawArtifact.contentHash : "";
  const acceptedDecisions = parsedDecisions?.success
    ? parsedDecisions.data.filter((decision) => decision.finalDecision === "promote" && decision.passageFound && decision.promotedResult)
    : [];
  const candidateMatchesAccepted = acceptedDecisions.length === parsed.data.results.length
    && parsed.data.results.every((result) => acceptedDecisions.some((decision) => JSON.stringify(decision.promotedResult) === JSON.stringify(result)));
  const reviewSupportsDecisions = parsedReview?.success === true && parsedDecisions?.success === true
    && parsedReview.data.reviews.length === parsedDecisions.data.length
    && parsedDecisions.data.every((decision) => {
      const review = parsedReview.data.reviews.find((candidate) => candidate.resultIndex === decision.resultIndex);
      if (!review) return false;
      if (decision.finalDecision === "reject") return true;
      return review.verdict !== "reject"
        && review.quoteVerified
        && review.locatorVerified
        && review.scopeVerified
        && review.relationVerified;
    });
  const autoGatePasses = autoRequested
    && reviewEnvelope?.policyId === dualReviewPolicyId
    && body.verificationStatus === "ai-cross-checked-full-text"
    && rawArtifact?.kind === "pmc-jats"
    && /^PMC\d{4,12}$/.test(rawArtifact.pmcid || "")
    && /^[a-f0-9]{64}$/i.test(artifactHash)
    && parsedReview?.success === true
    && parsedDecisions?.success === true
    && parsedReview.data.artifactHash === artifactHash
    && parsedReview.data.independentlyReadFullText
    && parsedReview.data.methodsAndResultsRead
    && primaryModel.length > 0
    && adversaryModel.length > 0
    && primaryModel.toLowerCase() !== adversaryModel.toLowerCase()
    && typeof body.model === "string"
    && body.model.trim() === primaryModel
    && reviewSupportsDecisions
    && candidateMatchesAccepted;

  // Hard three-axis guard. Legacy PubMed records neither declare a source class
  // nor an acquisition, so they keep their existing causal behavior. Any record
  // that declares the new source model must be a non-preliminary causal artifact
  // acquired as fetched-verified, and the accepted path must clear the adversarial
  // review gate. Non-causal or preliminary records are refused outright.
  const declaredSourceClass = sourceClassSchema.safeParse(body.sourceClass);
  const declaredAcquisition = acquisitionSchema.safeParse(body.acquisition);
  const declaresSourceModel = body.sourceClass !== undefined
    || body.acquisition !== undefined
    || body.preliminary !== undefined;
  const promotionRole = declaredSourceClass.success
    ? epistemicRoleForSourceClass(declaredSourceClass.data)
    : "causal";
  const promotionPreliminary = body.preliminary === true
    || (declaredSourceClass.success ? isPreliminarySourceClass(declaredSourceClass.data) : false);
  const promotionAcquisition = declaredAcquisition.success
    ? declaredAcquisition.data
    : autoGatePasses ? "fetched-verified" : "cited-unverified";

  if (promotionRole !== "causal" || promotionPreliminary) {
    return Response.json({
      error: `Only non-preliminary causal sources can be promoted as study results; this record is ${promotionRole}${promotionPreliminary ? " and preliminary" : ""}.`,
      code: "PROMOTION_ROLE_NOT_CAUSAL",
    }, { status: 422 });
  }
  if (declaresSourceModel || autoRequested) {
    if (!canExtractAsStudyResult({ role: promotionRole, acquisition: promotionAcquisition })) {
      return Response.json({
        error: "Full-text study-result extraction requires a causal, fetched-verified acquisition.",
        code: "PROMOTION_NOT_FETCHED_VERIFIED",
      }, { status: 422 });
    }
    if (!canReachAcceptedEvidence({
      role: promotionRole,
      acquisition: promotionAcquisition,
      adversarialPassed: autoGatePasses,
      preliminary: promotionPreliminary,
    })) {
      return Response.json({
        error: "This record does not satisfy the accepted-evidence rule (causal, fetched-verified, adversarially reviewed, and not preliminary).",
        code: "PROMOTION_NOT_ELIGIBLE",
      }, { status: 422 });
    }
  }

  if (body.humanChecked !== true && !autoGatePasses) {
    return Response.json({
      error: autoRequested
        ? "Automatic promotion failed the declared dual-model full-text policy. The proposal remains reviewable but was not persisted."
        : "A human must explicitly check an abstract-only extraction before promotion.",
    }, { status: 400 });
  }

  let serverVerifiedArtifact: PersistedPmcArtifact | null = null;
  if (autoGatePasses && rawArtifact) {
    try {
      serverVerifiedArtifact = await independentlyVerifyPmcArtifact({
        pmid,
        artifact: rawArtifact,
        exactExcerpts: parsed.data.results.map((result) => result.exactExcerpt),
      });
    } catch (error) {
      const failure = error instanceof PromotionVerificationError
        ? error
        : new PromotionVerificationError("Independent PMC verification failed; no evidence was promoted.", "PMC_VERIFICATION_FAILED", 502);
      return Response.json({ error: failure.message, code: failure.code }, { status: failure.status });
    }
  }

  try {
    await ensureDecisionTables();
    const d1 = getD1();
    const now = new Date().toISOString();
    const originalPrompt = typeof body.originalPrompt === "string" && body.originalPrompt.trim()
      ? body.originalPrompt.trim()
      : "Untitled evidence investigation";
    const compiledQuestion = typeof body.compiledQuestion === "string" && body.compiledQuestion.trim()
      ? body.compiledQuestion.trim().slice(0, 5_000)
      : null;
    const candidate = parsed.data;
    const sourceId = `pubmed-${pmid}`;
    const recordPrefix = `${caseId}-${sourceId}`;
    const studyId = `${recordPrefix}-study`;
    const registrationId = candidate.study.registrationId?.trim().toUpperCase() || null;
    const familyId = registrationId
      ? `${caseId}-registered-family-${await stableSemanticId({ registrationId })}`
      : `${recordPrefix}-family`;
    const dependenceBasis = candidate.evidenceFamily.basis ?? "unknown";
    const dependsOn = Array.from(new Set(candidate.evidenceFamily.dependsOn ?? [])).sort();
    const familyReason = `[${dependenceBasis}] ${candidate.evidenceFamily.reason}`;
    const model = typeof body.model === "string" ? body.model : "unspecified-model";
    const autoPromotion = autoGatePasses;
    const verificationStatus = autoPromotion ? "ai-cross-checked-full-text" : "abstract-only";
    const relationAssessor = autoPromotion ? `${primaryModel}+${adversaryModel}` : "human-checked-ai-extraction";
    const relationStatus = autoPromotion ? "accepted-by-dual-model-review" : "provisional-pending-full-text";
    if (!autoPromotion) {
      const acceptedFullText = await d1.prepare(`SELECT er.id
        FROM evidence_relations er
        JOIN result_records rr ON rr.id = er.result_id
        JOIN analyses a ON a.id = rr.analysis_id
        JOIN studies st ON st.id = a.study_id
        WHERE er.case_id = ?
          AND st.source_id = ?
          AND er.status LIKE 'accepted%'
          AND rr.verification_status = 'ai-cross-checked-full-text'
        LIMIT 1`)
        .bind(caseId, sourceId)
        .first<{ id: string }>();
      if (acceptedFullText) {
        return Response.json({
          error: "This source already has accepted full-text evidence. An abstract-only proposal cannot overwrite or downgrade it.",
        }, { status: 409 });
      }
    }
    const usedClaimIds = new Set(candidate.results.map((result) => result.claimFrameId));
    const missingClaimIds = [...usedClaimIds].filter((claimId) => !promotableClaimFrames.some((claim) => claim.id === claimId));
    if (missingClaimIds.length) {
      return Response.json({ error: `The extraction references claim frames absent from the compiled research brief: ${missingClaimIds.join(", ")}.` }, { status: 400 });
    }

    const identifiedResults = await Promise.all(candidate.results.map(async (result) => {
      const semanticKey = await promotedResultSemanticKey({
        sourceId,
        analysisLabel: result.analysisLabel,
        analysisType: result.analysisType,
        outcome: result.outcome,
        timeHorizon: result.timeHorizon,
        resultRole: result.resultRole,
        estimate: result.estimate,
        exactExcerpt: result.exactExcerpt,
        locator: result.locator,
      });
      return {
        result,
        semanticKey,
        analysisId: `${recordPrefix}-analysis-${semanticKey}`,
        resultId: `${recordPrefix}-result-${semanticKey}`,
        relationId: `${recordPrefix}-relation-${semanticKey}-${safeId(result.claimFrameId)}`,
      };
    }));
    identifiedResults.sort((left, right) =>
      left.resultId.localeCompare(right.resultId)
      || left.result.claimFrameId.localeCompare(right.result.claimFrameId)
      || left.relationId.localeCompare(right.relationId));
    const atomicById = new Map<string, typeof identifiedResults[number] & {
      applicabilityByClaim: Record<string, typeof identifiedResults[number]["result"]["applicability"]>;
    }>();
    const relationById = new Map<string, typeof identifiedResults[number]>();
    for (const identified of identifiedResults) {
      const existingAtomic = atomicById.get(identified.resultId);
      if (existingAtomic) {
        const existingPresentation = JSON.stringify({
          resultText: existingAtomic.result.resultText,
          locator: existingAtomic.result.locator,
        });
        const nextPresentation = JSON.stringify({
          resultText: identified.result.resultText,
          locator: identified.result.locator,
        });
        if (existingPresentation !== nextPresentation) {
          return Response.json({
            error: `Atomic result ${identified.resultId} was repeated with conflicting text or locators.`,
          }, { status: 400 });
        }
        existingAtomic.applicabilityByClaim[identified.result.claimFrameId] = identified.result.applicability;
      } else {
        atomicById.set(identified.resultId, {
          ...identified,
          applicabilityByClaim: {
            [identified.result.claimFrameId]: identified.result.applicability,
          },
        });
      }
      const existingRelation = relationById.get(identified.relationId);
      if (existingRelation) {
        const existingJudgment = JSON.stringify({
          relation: existingRelation.result.relation,
          scopeMatch: existingRelation.result.scopeMatch,
          rationale: existingRelation.result.rationale,
        });
        const nextJudgment = JSON.stringify({
          relation: identified.result.relation,
          scopeMatch: identified.result.scopeMatch,
          rationale: identified.result.rationale,
        });
        if (existingJudgment !== nextJudgment) {
          return Response.json({
            error: `Relation ${identified.relationId} was repeated with conflicting judgments.`,
          }, { status: 400 });
        }
      } else {
        relationById.set(identified.relationId, identified);
      }
    }
    const atomicResults = [...atomicById.values()].sort((left, right) => left.resultId.localeCompare(right.resultId));
    const relationRecords = [...relationById.values()].sort((left, right) => left.relationId.localeCompare(right.relationId));
    const persistedArtifact = autoPromotion ? serverVerifiedArtifact : null;
    const resultPayload = (record: typeof atomicResults[number]) => ({
      extractionModel: model,
      adversarialModel: autoPromotion ? adversaryModel : null,
      policyId: autoPromotion ? dualReviewPolicyId : null,
      sourceArtifact: persistedArtifact,
      extractionCaveat: candidate.extractionCaveat,
      applicability: record.result.applicability,
      applicabilityByClaim: Object.fromEntries(
        Object.entries(record.applicabilityByClaim).sort(([left], [right]) => left.localeCompare(right)),
      ),
    });
    const graphFingerprint = await sha256(JSON.stringify({
      contract: "promotion-source-slice-v2",
      case: { caseId, originalPrompt, compiledQuestion },
      source: {
        sourceId,
        url: rawSource.url,
        doi: rawSource.doi ?? null,
        pmid,
        title: rawSource.title,
        authors: (rawSource.authors || "").split(",").map((name) => name.trim()).filter(Boolean),
        published: rawSource.published ?? null,
        journal: rawSource.journal ?? null,
        sourceType: autoPromotion ? "PMC JATS full text" : "PubMed abstract",
        contentHash: persistedArtifact?.contentHash ?? null,
      },
      study: { studyId, registrationId, ...candidate.study },
      family: {
        familyId,
        label: candidate.evidenceFamily.label,
        reason: familyReason,
        dependsOn,
      },
      claims: promotableClaimFrames
        .map((claim) => ({
          id: `${caseId}-${claim.id}`,
          statement: claim.statement,
          population: claim.population,
          exposure: claim.exposure,
          comparator: claim.comparator,
          outcome: claim.outcome,
          timeHorizon: claim.timeHorizon,
          modality: claim.modality,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      results: atomicResults.map((record) => ({
        id: record.resultId,
        analysisId: record.analysisId,
        familyId,
        result: {
          analysisLabel: record.result.analysisLabel,
          analysisType: record.result.analysisType,
          outcome: record.result.outcome,
          timeHorizon: record.result.timeHorizon,
          resultRole: record.result.resultRole,
          resultText: record.result.resultText,
          estimate: record.result.estimate,
          exactExcerpt: record.result.exactExcerpt,
          locator: record.result.locator,
        },
        payload: resultPayload(record),
        verificationStatus,
      })),
      relations: relationRecords.map((record) => ({
        id: record.relationId,
        resultId: record.resultId,
        claimFrameId: `${caseId}-${record.result.claimFrameId}`,
        relation: record.result.relation,
        scopeMatch: record.result.scopeMatch,
        rationale: record.result.rationale,
        assessor: relationAssessor,
        status: relationStatus,
      })),
    }));
    const [previousSnapshot, latestCaseSnapshot] = await Promise.all([
      d1.prepare(`SELECT
          id,
          json_extract(artifact_json, '$.graphFingerprint') AS graph_fingerprint
        FROM snapshots
        WHERE case_id = ?
          AND operation IN ('autopromote-full-text-results', 'record-provisional-abstract-results')
          AND json_extract(artifact_json, '$.sourceId') = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1`)
        .bind(caseId, sourceId)
        .first<{ id: string; graph_fingerprint: string | null }>(),
      d1.prepare(`SELECT id
        FROM snapshots
        WHERE case_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1`)
        .bind(caseId)
        .first<{ id: string }>(),
    ]);
    const graphChanged = previousSnapshot?.graph_fingerprint !== graphFingerprint;

    const statements = [
      d1.prepare(`INSERT INTO cases (id, slug, title, original_prompt, active_question, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET original_prompt = excluded.original_prompt, active_question = excluded.active_question, status = excluded.status, updated_at = excluded.updated_at`)
        .bind(caseId, `case-${caseId}`, "Epistack investigation · live MVP", originalPrompt, compiledQuestion, "evidence-promoted", now, now),
      d1.prepare(`INSERT INTO sources (id, canonical_url, doi, pmid, title, authors_json, issued_at, publisher, source_type, csl_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          canonical_url = excluded.canonical_url,
          doi = excluded.doi,
          pmid = excluded.pmid,
          title = excluded.title,
          authors_json = excluded.authors_json,
          issued_at = excluded.issued_at,
          publisher = excluded.publisher,
          source_type = excluded.source_type,
          csl_json = excluded.csl_json,
          content_hash = excluded.content_hash`)
        .bind(
          sourceId,
          rawSource.url,
          rawSource.doi ?? null,
          pmid,
          rawSource.title,
          JSON.stringify((rawSource.authors || "").split(",").map((name) => name.trim()).filter(Boolean)),
          rawSource.published ?? null,
          rawSource.journal ?? null,
          autoPromotion ? "PMC JATS full text" : "PubMed abstract",
          JSON.stringify({ title: rawSource.title, DOI: rawSource.doi, PMID: pmid }),
          persistedArtifact?.contentHash ?? null,
          now,
        ),
      d1.prepare(`INSERT INTO studies (id, source_id, registration_id, design, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_id = excluded.source_id,
          registration_id = excluded.registration_id,
          design = excluded.design,
          payload_json = excluded.payload_json`)
        .bind(studyId, sourceId, registrationId, candidate.study.design, JSON.stringify(candidate.study), now),
      d1.prepare(`INSERT INTO dependence_groups (id, case_id, label, reason, depends_on_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          case_id = excluded.case_id,
          label = excluded.label,
          reason = excluded.reason,
          depends_on_json = excluded.depends_on_json`)
        .bind(familyId, caseId, candidate.evidenceFamily.label, familyReason, JSON.stringify(dependsOn), now),
    ];

    for (const claim of promotableClaimFrames) {
      statements.push(
        d1.prepare(`INSERT INTO claim_frames (id, case_id, statement, population_json, exposure_json, comparator_json, outcome_json, time_horizon, modality, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            case_id = excluded.case_id,
            statement = excluded.statement,
            population_json = excluded.population_json,
            exposure_json = excluded.exposure_json,
            comparator_json = excluded.comparator_json,
            outcome_json = excluded.outcome_json,
            time_horizon = excluded.time_horizon,
            modality = excluded.modality,
            status = excluded.status,
            updated_at = excluded.updated_at`)
          .bind(
            `${caseId}-${claim.id}`,
            caseId,
            claim.statement,
            JSON.stringify({ description: claim.population }),
            JSON.stringify({ description: claim.exposure }),
            JSON.stringify({ description: claim.comparator }),
            JSON.stringify({ description: claim.outcome }),
            claim.timeHorizon,
            claim.modality,
            "active",
            now,
            now,
          ),
      );
    }

    atomicResults.forEach((record) => {
      const { result, analysisId, resultId } = record;
      statements.push(
        d1.prepare(`INSERT INTO analyses (id, study_id, label, analysis_type, population_json, exposure_json, comparator_json, outcome_json, time_horizon, estimand, model_json, multiplicity, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            study_id = excluded.study_id,
            label = excluded.label,
            analysis_type = excluded.analysis_type,
            population_json = excluded.population_json,
            exposure_json = excluded.exposure_json,
            comparator_json = excluded.comparator_json,
            outcome_json = excluded.outcome_json,
            time_horizon = excluded.time_horizon,
            estimand = excluded.estimand,
            model_json = excluded.model_json,
            multiplicity = excluded.multiplicity`)
          .bind(
            analysisId,
            studyId,
            result.analysisLabel,
            result.analysisType,
            JSON.stringify({ description: candidate.study.population }),
            JSON.stringify({ description: candidate.study.exposure }),
            JSON.stringify({ description: candidate.study.comparator }),
            JSON.stringify({ description: result.outcome }),
            result.timeHorizon,
            null,
            "{}",
            autoPromotion ? "unknown-from-ai-full-text-extraction" : "unknown-from-abstract",
            now,
          ),
        d1.prepare(`INSERT INTO result_records (id, analysis_id, dependence_group_id, result_role, result_text, estimate_json, locator, excerpt, verification_status, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            analysis_id = excluded.analysis_id,
            dependence_group_id = excluded.dependence_group_id,
            result_role = excluded.result_role,
            result_text = excluded.result_text,
            estimate_json = excluded.estimate_json,
            locator = excluded.locator,
            excerpt = excluded.excerpt,
            verification_status = excluded.verification_status,
            payload_json = excluded.payload_json`)
          .bind(
            resultId,
            analysisId,
            familyId,
            result.resultRole,
            result.resultText,
            JSON.stringify({ display: result.estimate || null }),
            result.locator,
            result.exactExcerpt || null,
            verificationStatus,
            JSON.stringify(resultPayload(record)),
            now,
          ),
      );
    });

    relationRecords.forEach(({ result, resultId, relationId }) => {
      statements.push(
        d1.prepare(`INSERT INTO evidence_relations (id, case_id, result_id, claim_frame_id, relation, scope_match, rationale, assessor, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            case_id = excluded.case_id,
            result_id = excluded.result_id,
            claim_frame_id = excluded.claim_frame_id,
            relation = excluded.relation,
            scope_match = excluded.scope_match,
            rationale = excluded.rationale,
            assessor = excluded.assessor,
            status = excluded.status`)
          .bind(
            relationId,
            caseId,
            resultId,
            `${caseId}-${result.claimFrameId}`,
            result.relation,
            result.scopeMatch,
            result.rationale,
            relationAssessor,
            relationStatus,
            now,
          ),
      );
    });

    if (autoPromotion) {
      const relationPlaceholders = relationRecords.map(() => "?").join(", ");
      const resultPlaceholders = atomicResults.map(() => "?").join(", ");
      statements.push(
        d1.prepare(`UPDATE evidence_relations AS er
          SET status = 'superseded-by-full-text-review'
          WHERE er.case_id = ?
            AND (
              er.status LIKE 'accepted%'
              OR er.status = 'provisional-pending-full-text'
            )
            AND er.result_id IN (
              SELECT rr.id
              FROM result_records rr
              JOIN analyses a ON a.id = rr.analysis_id
              JOIN studies st ON st.id = a.study_id
              WHERE st.source_id = ?
            )
            AND er.id NOT IN (${relationPlaceholders})`)
          .bind(caseId, sourceId, ...relationRecords.map((record) => record.relationId)),
        d1.prepare(`UPDATE result_records AS rr
          SET verification_status = 'superseded-by-full-text-review'
          WHERE rr.id IN (
              SELECT candidate_rr.id
              FROM result_records candidate_rr
              JOIN analyses a ON a.id = candidate_rr.analysis_id
              JOIN studies st ON st.id = a.study_id
              WHERE st.source_id = ?
            )
            AND rr.id NOT IN (${resultPlaceholders})
            AND NOT EXISTS (
              SELECT 1
              FROM evidence_relations er
              WHERE er.result_id = rr.id
                AND er.status LIKE 'accepted%'
            )`)
          .bind(sourceId, ...atomicResults.map((record) => record.resultId)),
      );
    }

    if (autoPromotion && parsedDecisions?.success) {
      parsedDecisions.data.forEach((decision) => {
        statements.push(
          d1.prepare(`INSERT INTO assessments (id, case_id, target_type, target_id, policy_id, assessor, dimension, score, label, rationale, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET label = excluded.label, rationale = excluded.rationale, status = excluded.status`)
            .bind(
              `${recordPrefix}-adversarial-assessment-${decision.resultIndex + 1}`,
              caseId,
              "extraction-proposal",
              `${recordPrefix}-proposal-${decision.resultIndex + 1}`,
              dualReviewPolicyId,
              adversaryModel,
              "full-text-result-fidelity",
              decision.finalDecision === "promote" ? 1 : 0,
              decision.finalDecision,
              decision.rationale,
              "recorded",
              now,
            ),
        );
      });
    }

    const snapshotId = graphChanged ? crypto.randomUUID() : previousSnapshot?.id ?? crypto.randomUUID();
    if (graphChanged) {
      statements.push(
        d1.prepare(`INSERT INTO snapshots (id, case_id, parent_id, actor, operation, artifact_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            snapshotId,
            caseId,
            latestCaseSnapshot?.id ?? null,
            autoPromotion ? "claude-dual-model-policy" : "human-ai-workflow",
            autoPromotion ? "autopromote-full-text-results" : "record-provisional-abstract-results",
            JSON.stringify({
              sourceId,
              graphFingerprint,
              source: rawSource,
              candidate,
              claimFrames: promotableClaimFrames,
              model,
              artifact: persistedArtifact,
              adversarialReview: autoPromotion ? reviewEnvelope : null,
            }),
            now,
          ),
      );
      if (autoPromotion) {
        statements.push(
          d1.prepare(`UPDATE decision_episodes
            SET status = 'stale', updated_at = ?
            WHERE case_id = ? AND status NOT IN ('stale', 'superseded')`)
            .bind(now, caseId),
          d1.prepare(`INSERT INTO update_events
            (id, event_type, target_type, target_id, source_url, scope, payload_json, review_status, occurred_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(
              crypto.randomUUID(),
              "accepted-evidence-changed",
              "case",
              caseId,
              rawSource.url,
              "All decision episodes based on an earlier accepted graph require sensitivity review.",
              JSON.stringify({
                resultIds: atomicResults.map(({ resultId }) => resultId),
                sourceId,
                graphSnapshotId: snapshotId,
              }),
              "queued",
              now,
              now,
            ),
        );
      }
    }
    await d1.batch(statements);

    return Response.json({
      caseId,
      sourceId,
      studyId,
      dependenceGroupId: familyId,
      resultCount: atomicResults.length,
      relationCount: relationRecords.length,
      snapshotId,
      graphChanged,
      status: relationStatus,
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The result graph could not be updated." }, { status: 500 });
  }
}
