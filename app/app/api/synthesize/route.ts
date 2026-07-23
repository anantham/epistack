import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { env } from "cloudflare:workers";
import {
  promptOverridesSignature,
  renderAgentPrompt,
  resolveAgentPrompt,
  sanitizeAgentPromptOverrides,
  type AgentPromptOverrides,
} from "../../../lib/agent-prompts";
import {
  canonicalHumanSuppliedValues,
  decisionGraphProjection,
  decisionSynthesisOutputSchema,
  decisionSynthesisSchema,
  privacyMinimizedDecisionBrief,
  validateDecisionOptionCoverage,
  validateDecisionReferences,
  type DecisionSynthesis,
} from "../../../lib/decision-synthesis";
import { isD1Unavailable, readLiveArtifact } from "../../../lib/live-artifact-store";
import { openRouterFailureFromThrown } from "../../../lib/openrouter-errors";
import { researchBriefSchema, type ResearchBrief } from "../../../lib/research-brief";
import { ensureDecisionTables, getD1 } from "../../../db";
import { operationCacheKey, readOperationCache, writeOperationCache } from "../../../db/cache";

const defaultOpenRouterModel = "anthropic/claude-opus-4.8";
const openRouterBaseURL = "https://openrouter.ai/api/v1";
const synthesisCacheContract = "decision-synthesis-v2";
const synthesisCacheTtlMs = 30 * 24 * 60 * 60 * 1000;

type SynthesisRequest = {
  caseId?: unknown;
  researchBrief?: unknown;
  openRouterApiKey?: unknown;
  openRouterModel?: unknown;
  promptOverrides?: unknown;
  refresh?: unknown;
};

type SynthesisEnvironment = {
  OPENROUTER_API_KEY?: string;
  EPISTACK_OPENROUTER_MODEL?: string;
};

type PersistedSynthesis = {
  caseId: string;
  decisionId: string;
  evidenceVersion: string;
  graphSnapshotId: string;
  model: string;
  createdAt: string;
  synthesis: DecisionSynthesis;
};

type ShareableDecisionBrief = ReturnType<typeof privacyMinimizedDecisionBrief>;

function validCaseId(value: unknown) {
  return typeof value === "string"
    && /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(value.trim());
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function validateSynthesis(
  synthesis: DecisionSynthesis,
  brief: ResearchBrief,
  resultIds: string[],
  familyIds: string[],
  resultFamilyById: ReadonlyMap<string, string>,
  claimFrameIds: string[],
  relationById: ReadonlyMap<string, { resultId: string; claimFrameId: string; relation: string }>,
) {
  const references = validateDecisionReferences(
    synthesis,
    resultIds,
    familyIds,
    resultFamilyById,
    claimFrameIds,
    relationById,
  );
  const options = validateDecisionOptionCoverage(synthesis, brief);
  const allowedHumanValues = new Set(canonicalHumanSuppliedValues(brief));
  const mislabeledHumanValues = synthesis.valuesAndConstraints.humanSupplied
    .filter((value) => !allowedHumanValues.has(value));
  return {
    valid: references.valid && options.valid && mislabeledHumanValues.length === 0,
    references,
    options,
    mislabeledHumanValues,
  };
}

async function generateSynthesis(input: {
  openRouterApiKey: string;
  openRouterModel: string;
  origin: string;
  brief: ResearchBrief;
  shareableBrief: ShareableDecisionBrief;
  projection: ReturnType<typeof decisionGraphProjection>;
  promptOverrides: AgentPromptOverrides;
}) {
  const openRouter = createOpenAI({
    apiKey: input.openRouterApiKey,
    baseURL: openRouterBaseURL,
    headers: {
      "HTTP-Referer": input.origin || "https://epistack-evidence-lab.avalokai.chatgpt.site",
      "X-OpenRouter-Title": "Epistack Evidence Lab",
      "X-OpenRouter-Metadata": "enabled",
    },
  });
  const agent = resolveAgentPrompt("decision-synthesizer", input.promptOverrides);
  const humanValues = canonicalHumanSuppliedValues(input.brief);
  const basePrompt = renderAgentPrompt(agent.taskTemplate, {
    question: input.brief.compiledQuestion,
    evidenceVersion: input.projection.evidenceVersion,
    researchBrief: JSON.stringify(input.shareableBrief, null, 2),
    humanSuppliedValues: JSON.stringify(humanValues, null, 2),
    acceptedGraph: JSON.stringify(input.projection, null, 2),
  });
  const resultIds = input.projection.results.map((result) => result.id);
  const familyIds = input.projection.dependenceFamilies.map((family) => family.id);
  const resultFamilyById = new Map(
    input.projection.results.map((result) => [result.id, result.dependenceGroupId]),
  );
  const relationById = new Map(
    input.projection.relations.map((relation) => [relation.id, {
      resultId: relation.resultId,
      claimFrameId: relation.claimFrameId,
      relation: relation.relation,
    }]),
  );

  let lastValidation: ReturnType<typeof validateSynthesis> | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const repair = attempt === 0 || !lastValidation
      ? ""
      : `\n\nREPAIR THE PREVIOUS CONTRACT FAILURE.
Unknown result IDs: ${JSON.stringify(lastValidation.references.unknownResultIds)}
Unknown family IDs: ${JSON.stringify(lastValidation.references.unknownFamilyIds)}
Unknown relation IDs: ${JSON.stringify(lastValidation.references.unknownRelationIds)}
Unknown claim-frame IDs: ${JSON.stringify(lastValidation.references.unknownClaimFrameIds)}
Relations attached to uncited results: ${JSON.stringify(lastValidation.references.mismatchedResultRelationIds)}
Relations attached to uncited claims: ${JSON.stringify(lastValidation.references.mismatchedClaimRelationIds)}
Result IDs without a cited relation: ${JSON.stringify(lastValidation.references.ungroundedBasisResultIds)}
Missing load-bearing family IDs: ${JSON.stringify(lastValidation.references.missingLoadBearingFamilyIds)}
Unbacked load-bearing family IDs: ${JSON.stringify(lastValidation.references.unbackedLoadBearingFamilyIds)}
Unknown option IDs: ${JSON.stringify(lastValidation.options.unknownOptionIds)}
Missing option IDs: ${JSON.stringify(lastValidation.options.missingOptionIds)}
Duplicate option IDs: ${JSON.stringify(lastValidation.options.duplicateOptionIds)}
Options with changed labels: ${JSON.stringify(lastValidation.options.mismatchedOptionLabels)}
Options with changed feasibility: ${JSON.stringify(lastValidation.options.mismatchedOptionFeasibilities)}
Unknown recommendation option ID: ${JSON.stringify(lastValidation.options.unknownRecommendationOptionId)}
Values incorrectly labeled human-supplied: ${JSON.stringify(lastValidation.mislabeledHumanValues)}
Use only exact IDs and copy human-supplied values verbatim from the supplied list. Return the complete object again.`;
    const { output } = await generateText({
      model: openRouter(input.openRouterModel),
      output: Output.object({
        name: "accepted_graph_decision_synthesis",
        description: "A conditional, reversible decision synthesis grounded only in accepted result-level evidence.",
        schema: decisionSynthesisOutputSchema,
      }),
      system: agent.instructions,
      prompt: `${basePrompt}${repair}`,
      maxOutputTokens: agent.maxOutputTokens,
      temperature: agent.temperature,
    });
    const parsed = decisionSynthesisSchema.safeParse(output);
    if (!parsed.success) continue;
    lastValidation = validateSynthesis(
      parsed.data,
      input.brief,
      resultIds,
      familyIds,
      resultFamilyById,
      input.projection.claims.map((claim) => claim.id),
      relationById,
    );
    if (lastValidation.valid) return parsed.data;
  }

  const detail = lastValidation
    ? {
        unknownResultIds: lastValidation.references.unknownResultIds,
        unknownFamilyIds: lastValidation.references.unknownFamilyIds,
        unknownRelationIds: lastValidation.references.unknownRelationIds,
        unknownClaimFrameIds: lastValidation.references.unknownClaimFrameIds,
        mismatchedResultRelationIds: lastValidation.references.mismatchedResultRelationIds,
        mismatchedClaimRelationIds: lastValidation.references.mismatchedClaimRelationIds,
        ungroundedBasisResultIds: lastValidation.references.ungroundedBasisResultIds,
        missingLoadBearingFamilyIds: lastValidation.references.missingLoadBearingFamilyIds,
        unbackedLoadBearingFamilyIds: lastValidation.references.unbackedLoadBearingFamilyIds,
        unknownOptionIds: lastValidation.options.unknownOptionIds,
        missingOptionIds: lastValidation.options.missingOptionIds,
        duplicateOptionIds: lastValidation.options.duplicateOptionIds,
        mismatchedOptionLabels: lastValidation.options.mismatchedOptionLabels,
        mismatchedOptionFeasibilities: lastValidation.options.mismatchedOptionFeasibilities,
        unknownRecommendationOptionId: lastValidation.options.unknownRecommendationOptionId,
        mislabeledHumanValueCount: lastValidation.mislabeledHumanValues.length,
      }
    : null;
  const error = new Error("The model could not satisfy the accepted-graph decision contract after two attempts.");
  Object.assign(error, { code: "SYNTHESIS_CONTRACT_FAILED", detail });
  throw error;
}

async function persistSynthesis(input: {
  caseId: string;
  shareableBrief: ShareableDecisionBrief;
  synthesis: DecisionSynthesis;
  evidenceVersion: string;
  projection: ReturnType<typeof decisionGraphProjection>;
  projectionHash: string;
  promptPolicySignature: string;
  parentSnapshotId: string | null;
  model: string;
}) {
  await ensureDecisionTables();
  const d1 = getD1();
  const now = new Date().toISOString();
  const decisionId = crypto.randomUUID();
  const basisSnapshotId = crypto.randomUUID();
  const synthesisSnapshotId = crypto.randomUUID();
  const statements = [];

  statements.push(
    d1.prepare(`INSERT INTO snapshots (id, case_id, parent_id, actor, operation, artifact_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        basisSnapshotId,
        input.caseId,
        input.parentSnapshotId,
        "epistack-system",
        "freeze-accepted-evidence-basis",
        JSON.stringify({
          contractVersion: "decision-evidence-basis.v1",
          evidenceVersion: input.evidenceVersion,
          projectionHash: input.projectionHash,
          projection: input.projection,
          researchBrief: input.shareableBrief,
          model: input.model,
          promptPolicySignature: input.promptPolicySignature,
        }),
        now,
      ),
  );

  statements.push(
    d1.prepare(`UPDATE decision_episodes
      SET status = 'superseded', updated_at = ?
      WHERE case_id = ? AND status <> 'superseded'`)
      .bind(now, input.caseId),
    d1.prepare(`INSERT INTO decision_episodes
      (id, case_id, question, target_context_json, constraints_json, values_json, graph_snapshot_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        decisionId,
        input.caseId,
        input.shareableBrief.compiledQuestion,
        JSON.stringify(input.shareableBrief.stakeholderProfile),
        JSON.stringify(input.shareableBrief.actionSpace),
        JSON.stringify(input.synthesis.valuesAndConstraints),
        basisSnapshotId,
        "recorded",
        now,
        now,
      ),
  );

  for (const option of input.synthesis.options) {
    const optionId = `${decisionId}-option-${option.optionId}`;
    statements.push(
      d1.prepare(`INSERT INTO decision_options
        (id, decision_id, label, action_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(
          optionId,
          decisionId,
          option.label,
          JSON.stringify({
            optionId: option.optionId,
            feasibility: option.feasibility,
            outcomeReads: option.outcomeReads,
            tradeoffs: option.tradeoffs,
          }),
          "assessed",
          now,
        ),
    );
    option.outcomeReads.forEach((outcome, index) => {
      statements.push(
        d1.prepare(`INSERT INTO decision_outcomes
          (id, decision_id, label, measure, importance, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            `${optionId}-outcome-${index + 1}`,
            decisionId,
            `${option.label} · ${outcome.outcome}`,
            outcome.outcome,
            null,
            JSON.stringify({ optionId: option.optionId, ...outcome }),
            now,
          ),
      );
    });
  }

  statements.push(
    d1.prepare(`INSERT INTO protocols
      (id, decision_id, option_id, title, protocol_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        `${decisionId}-protocol`,
        decisionId,
        null,
        input.synthesis.observationProtocol.title,
        JSON.stringify(input.synthesis.observationProtocol),
        "proposed",
        now,
      ),
    d1.prepare(`INSERT INTO snapshots (id, case_id, parent_id, actor, operation, artifact_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        synthesisSnapshotId,
        input.caseId,
        basisSnapshotId,
        `decision-synthesizer:${decisionId}`,
        "synthesize-decision",
        JSON.stringify({
          decisionId,
          researchBriefId: input.shareableBrief.briefId,
          evidenceVersion: input.evidenceVersion,
          graphSnapshotId: basisSnapshotId,
          projectionHash: input.projectionHash,
          promptPolicySignature: input.promptPolicySignature,
          model: input.model,
          synthesis: input.synthesis,
        }),
        now,
      ),
    d1.prepare(`INSERT INTO update_events
      (id, event_type, target_type, target_id, source_url, scope, payload_json, review_status, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        "decision-synthesized",
        "decision",
        decisionId,
        null,
        "A reversible action policy was generated from the recorded accepted-evidence basis.",
        JSON.stringify({ graphSnapshotId: basisSnapshotId, synthesisSnapshotId }),
        "recorded",
        now,
        now,
      ),
  );
  await d1.batch(statements);
  return { decisionId, graphSnapshotId: basisSnapshotId, createdAt: now };
}

export async function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get("caseId")?.trim();
  if (!validCaseId(caseId)) {
    return Response.json({ error: "A valid caseId is required." }, { status: 400 });
  }
  try {
    await ensureDecisionTables();
    const d1 = getD1();
    const decision = await d1.prepare(`SELECT id, question, graph_snapshot_id, status, created_at, updated_at
      FROM decision_episodes WHERE case_id = ?
      ORDER BY created_at DESC,
        CASE status WHEN 'recorded' THEN 0 WHEN 'stale' THEN 1 WHEN 'draft' THEN 2 WHEN 'superseded' THEN 3 ELSE 2 END,
        id DESC LIMIT 1`).bind(caseId).first<{
        id: string;
        question: string;
        graph_snapshot_id: string;
        status: string;
        created_at: string;
        updated_at: string;
      }>();
    if (!decision) return Response.json({ caseId, decision: null }, { headers: { "Cache-Control": "no-store" } });
    const snapshot = await d1.prepare(`SELECT artifact_json
      FROM snapshots WHERE case_id = ? AND actor = ? AND operation = 'synthesize-decision'
      ORDER BY created_at DESC LIMIT 1`)
      .bind(caseId, `decision-synthesizer:${decision.id}`)
      .first<{ artifact_json: string }>();
    const stored = snapshot ? JSON.parse(snapshot.artifact_json) as Partial<PersistedSynthesis> & { synthesis?: unknown } : null;
    const synthesis = decisionSynthesisSchema.safeParse(stored?.synthesis);
    if (!synthesis.success) {
      return Response.json({
        caseId,
        decision: {
          id: decision.id,
          status: decision.status,
          graphSnapshotId: decision.graph_snapshot_id,
          createdAt: decision.created_at,
          updatedAt: decision.updated_at,
        },
        synthesis: null,
        error: "The latest decision metadata exists, but its structured snapshot could not be read.",
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({
      caseId,
      decision: {
        id: decision.id,
        status: decision.status,
        graphSnapshotId: decision.graph_snapshot_id,
        createdAt: decision.created_at,
        updatedAt: decision.updated_at,
      },
      evidenceVersion: stored?.evidenceVersion ?? decision.graph_snapshot_id,
      model: stored?.model ?? "not-recorded",
      synthesis: synthesis.data,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isD1Unavailable(error)) {
      return Response.json({ error: "The durable evidence store is unavailable in this runtime.", code: "D1_UNAVAILABLE" }, { status: 503 });
    }
    return Response.json({ error: "The recorded decision could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: SynthesisRequest;
  try {
    body = await request.json() as SynthesisRequest;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!validCaseId(body.caseId)) {
    return Response.json({ error: "A valid caseId is required." }, { status: 400 });
  }
  const caseId = (body.caseId as string).trim();
  const refresh = body.refresh === true;
  const parsedBrief = researchBriefSchema.safeParse(body.researchBrief);
  if (!parsedBrief.success || parsedBrief.data.caseId !== caseId) {
    return Response.json({ error: "The contextualized research brief is missing, invalid, or belongs to another case." }, { status: 400 });
  }
  if (body.promptOverrides && JSON.stringify(body.promptOverrides).length > 120_000) {
    return Response.json({ error: "Prompt overrides are too large." }, { status: 400 });
  }

  try {
    await ensureDecisionTables();
    const artifact = await readLiveArtifact(caseId);
    if (artifact.integrityWarnings.length) {
      return Response.json({ error: "Resolve the live artifact's integrity warnings before synthesizing a decision." }, { status: 409 });
    }
    if (artifact.graph.results.length === 0 || artifact.graph.evidenceRelations.length === 0) {
      return Response.json({ error: "No accepted result-level evidence exists for this case. Investigate and promote evidence first." }, { status: 409 });
    }
    const projection = decisionGraphProjection(artifact);
    if (projection.results.length === 0 || projection.relations.length === 0) {
      return Response.json({
        error: "Accepted evidence exists, but none is eligible for a final decision. Complete full-text acquisition and cross-checking before synthesis.",
        code: "NO_DECISION_ELIGIBLE_EVIDENCE",
      }, { status: 409 });
    }
    const serializedProjection = JSON.stringify(projection);
    if (serializedProjection.length > 600_000) {
      return Response.json({ error: "The accepted graph is too large for one synthesis pass. Split the decision into claim-scoped views first." }, { status: 413 });
    }
    const suppliedKey = typeof body.openRouterApiKey === "string" ? body.openRouterApiKey.trim() : "";
    const suppliedModel = typeof body.openRouterModel === "string" ? body.openRouterModel.trim() : "";
    const runtimeEnvironment = env as unknown as SynthesisEnvironment;
    const openRouterModel = suppliedModel
      || runtimeEnvironment.EPISTACK_OPENROUTER_MODEL
      || process.env.EPISTACK_OPENROUTER_MODEL
      || defaultOpenRouterModel;
    const promptOverrides = sanitizeAgentPromptOverrides(body.promptOverrides);
    const shareableBrief = privacyMinimizedDecisionBrief(parsedBrief.data);
    const promptPolicySignature = await operationCacheKey(
      "decision-prompt-policy",
      synthesisCacheContract,
      resolveAgentPrompt("decision-synthesizer", promptOverrides),
    );
    const projectionHash = await operationCacheKey(
      "accepted-graph-projection",
      "decision-evidence-basis.v1",
      projection,
    );
    const cacheKey = await operationCacheKey("decision-synthesis", synthesisCacheContract, {
      caseId,
      model: openRouterModel,
      brief: shareableBrief,
      projectionHash,
      promptPolicySignature,
      promptConfig: promptOverridesSignature(promptOverrides),
    });
    let synthesis: DecisionSynthesis | null = null;
    let cacheStatus: "hit" | "miss" | "bypass" = refresh ? "bypass" : "miss";
    let cacheCreatedAt: string | null = null;
    let cacheExpiresAt: string | null = null;
    if (!refresh) {
      const cached = await readOperationCache<PersistedSynthesis>(cacheKey);
      const parsedCached = decisionSynthesisSchema.safeParse(cached?.payload.synthesis);
      if (cached && parsedCached.success) {
        const cachedValidation = validateSynthesis(
          parsedCached.data,
          parsedBrief.data,
          projection.results.map((result) => result.id),
          projection.dependenceFamilies.map((family) => family.id),
          new Map(projection.results.map((result) => [result.id, result.dependenceGroupId])),
          projection.claims.map((claim) => claim.id),
          new Map(projection.relations.map((relation) => [relation.id, {
            resultId: relation.resultId,
            claimFrameId: relation.claimFrameId,
            relation: relation.relation,
          }])),
        );
        if (cachedValidation.valid) {
          synthesis = parsedCached.data;
          cacheStatus = "hit";
          cacheCreatedAt = cached.createdAt;
          cacheExpiresAt = cached.expiresAt;
        }
      }
    }

    if (!synthesis) {
      const openRouterApiKey = suppliedKey
        || runtimeEnvironment.OPENROUTER_API_KEY
        || process.env.OPENROUTER_API_KEY;
      if (!openRouterApiKey) {
        return Response.json({
          error: "No reusable synthesis is cached for this evidence version and model. Add a bring-your-own model key in Settings to create one.",
        }, { status: 401 });
      }
      synthesis = await generateSynthesis({
        openRouterApiKey,
        openRouterModel,
        origin: request.headers.get("origin") || "",
        brief: parsedBrief.data,
        shareableBrief,
        projection,
        promptOverrides,
      });
    }

    const canonicalHumanValues = canonicalHumanSuppliedValues(parsedBrief.data);
    const normalizedSynthesis = decisionSynthesisSchema.parse({
      ...synthesis,
      valuesAndConstraints: {
        humanSupplied: synthesis.valuesAndConstraints.humanSupplied
          .filter((value) => canonicalHumanValues.includes(value)),
        modelAssumptions: unique(synthesis.valuesAndConstraints.modelAssumptions),
      },
    });
    const persisted = await persistSynthesis({
      caseId,
      shareableBrief,
      synthesis: normalizedSynthesis,
      evidenceVersion: projection.evidenceVersion,
      projection,
      projectionHash,
      promptPolicySignature,
      parentSnapshotId: artifact.latestSnapshot?.id ?? null,
      model: openRouterModel,
    });
    const payload: PersistedSynthesis = {
      caseId,
      ...persisted,
      evidenceVersion: projection.evidenceVersion,
      model: openRouterModel,
      synthesis: normalizedSynthesis,
    };
    const stored = cacheStatus === "hit"
      ? null
      : await writeOperationCache(
          cacheKey,
          "decision-synthesis",
          synthesisCacheContract,
          payload,
          synthesisCacheTtlMs,
        );
    return Response.json({
      ...payload,
      cache: {
        status: cacheStatus,
        createdAt: cacheCreatedAt ?? stored?.createdAt ?? persisted.createdAt,
        expiresAt: cacheExpiresAt ?? stored?.expiresAt ?? null,
      },
    }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "SYNTHESIS_CONTRACT_FAILED") {
      return Response.json({
        error: error instanceof Error ? error.message : "The synthesis contract failed.",
        detail: (error as { detail?: unknown }).detail ?? null,
      }, { status: 502 });
    }
    if (isD1Unavailable(error)) {
      return Response.json({ error: "The durable evidence store is unavailable in this runtime.", code: "D1_UNAVAILABLE" }, { status: 503 });
    }
    const providerFailure = openRouterFailureFromThrown(error);
    return Response.json(
      { error: providerFailure.message, code: providerFailure.code },
      { status: providerFailure.status },
    );
  }
}
