import { ensureSnapshotTables, getD1 } from "../../../db";
import { decompositionSchema } from "../../../lib/decomposition-server";
import {
  projectResearchBriefForArtifact,
  researchBriefSchema,
  researchClaimFrameSchema,
  type ResearchClaimFrame,
} from "../../../lib/research-brief";

type ArtifactPayload = {
  caseId?: string;
  originalPrompt?: string;
  compiledClaim?: { statement?: string } | null;
  claims?: unknown;
  researchBrief?: unknown;
  shareContextInArtifact?: boolean;
  workflow?: unknown;
};

type WorkflowPayload = {
  version: 1;
  decomposition: {
    caseId: string;
    prompt: string;
    decisionContext: string;
    mode: "ai" | "local-fallback";
    model: string;
    warning: string | null;
    decomposition: unknown;
  };
  researchBrief: unknown;
  researchState?: Record<string, unknown>;
};

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const artifact = (await request.json()) as ArtifactPayload;
    const originalPrompt = artifact.originalPrompt?.trim();
    if (!originalPrompt) {
      return Response.json({ error: "originalPrompt is required" }, { status: 400 });
    }

    await ensureSnapshotTables();
    const d1 = getD1();
    const now = new Date().toISOString();
    const caseId = artifact.caseId?.trim() || crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const activeQuestion = artifact.compiledClaim?.statement?.trim() || null;
    const title = originalPrompt.replace(/\s+/g, " ").slice(0, 120);
    const slug = `case-${caseId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    const parsedClaims = artifact.claims === undefined
      ? { success: true as const, data: [] as ResearchClaimFrame[] }
      : researchClaimFrameSchema.array().min(3).max(7).safeParse(artifact.claims);
    if (!parsedClaims.success) {
      return Response.json({ error: "The shareable claim contract is incomplete or invalid." }, { status: 400 });
    }
    const claims = parsedClaims.data;
    const parsedBrief = artifact.researchBrief === undefined
      ? null
      : researchBriefSchema.safeParse(artifact.researchBrief);
    if (artifact.researchBrief !== undefined && !parsedBrief?.success) {
      return Response.json({ error: "The persisted research contract is incomplete or invalid." }, { status: 400 });
    }
    const researchBrief = parsedBrief?.success
      ? projectResearchBriefForArtifact(parsedBrief.data, artifact.shareContextInArtifact === true)
      : null;
    let persistedWorkflow: WorkflowPayload | null = null;
    if (artifact.workflow !== undefined) {
      const candidate = artifact.workflow as Partial<WorkflowPayload> | null;
      const decompositionCandidate = candidate?.decomposition;
      const parsedDecomposition = decompositionCandidate
        ? decompositionSchema.safeParse(decompositionCandidate.decomposition)
        : { success: false as const };
      const parsedWorkflowBrief = researchBriefSchema.safeParse(candidate?.researchBrief);
      if (
        candidate?.version !== 1
        || !decompositionCandidate
        || typeof decompositionCandidate.caseId !== "string"
        || typeof decompositionCandidate.prompt !== "string"
        || typeof decompositionCandidate.decisionContext !== "string"
        || (decompositionCandidate.mode !== "ai" && decompositionCandidate.mode !== "local-fallback")
        || typeof decompositionCandidate.model !== "string"
        || (decompositionCandidate.warning !== null && typeof decompositionCandidate.warning !== "string")
        || !parsedDecomposition.success
        || !parsedWorkflowBrief.success
        || !researchBrief
      ) {
        return Response.json({ error: "The persisted case workflow is incomplete or invalid." }, { status: 400 });
      }
      persistedWorkflow = {
        version: 1,
        decomposition: {
          ...decompositionCandidate,
          decomposition: parsedDecomposition.data,
        },
        researchBrief: parsedWorkflowBrief.data,
        ...(candidate.researchState && typeof candidate.researchState === "object" && !Array.isArray(candidate.researchState)
          ? { researchState: candidate.researchState as Record<string, unknown> }
          : {}),
      };
    }
    const artifactWithoutWorkflow = { ...artifact };
    delete artifactWithoutWorkflow.workflow;
    const persistedArtifact = researchBrief
      ? {
          ...artifactWithoutWorkflow,
          ...(persistedWorkflow ? { workflow: persistedWorkflow } : {}),
          researchBrief,
          shareContextInArtifact: researchBrief.privacy.shareContextInArtifact,
        }
      : artifactWithoutWorkflow;

    const statements = [
      d1
        .prepare(`INSERT INTO cases (
          id, slug, title, original_prompt, active_question, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          original_prompt = excluded.original_prompt,
          active_question = excluded.active_question,
          updated_at = excluded.updated_at`)
        .bind(
          caseId,
          slug,
          title,
          originalPrompt,
          activeQuestion,
          activeQuestion ? "claim-created" : "framing",
          now,
          now,
        ),
      d1
        .prepare(`INSERT INTO snapshots (
          id, case_id, parent_id, actor, operation, artifact_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(snapshotId, caseId, null, "human-ai-workflow", "save-snapshot", JSON.stringify(persistedArtifact), now),
      ...claims.map((claim) => d1.prepare(`INSERT INTO claim_frames (
        id, case_id, statement, population_json, exposure_json, comparator_json, outcome_json,
        time_horizon, modality, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        updated_at = excluded.updated_at`).bind(
        `${caseId}-${claim.id}`,
        caseId,
        claim.statement,
        JSON.stringify({ description: claim.population }),
        JSON.stringify({ description: claim.exposure }),
        JSON.stringify({ description: claim.comparator }),
        JSON.stringify({ description: claim.outcome }),
        claim.timeHorizon,
        claim.modality,
        "proposed",
        now,
        now,
      )),
    ];
    await d1.batch(statements);

    return Response.json({ caseId, snapshotId, savedAt: now, claimCount: claims.length }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}

export async function GET(request: Request) {
  try {
    const caseId = new URL(request.url).searchParams.get("caseId");
    if (!caseId) {
      return Response.json({ error: "caseId is required" }, { status: 400 });
    }
    await ensureSnapshotTables();
    const d1 = getD1();
    const caseRecord = await d1.prepare("SELECT * FROM cases WHERE id = ?").bind(caseId).first();
    const snapshots = await d1
      .prepare("SELECT * FROM snapshots WHERE case_id = ? ORDER BY created_at DESC LIMIT 20")
      .bind(caseId)
      .all();
    let workflow: unknown = null;
    for (const snapshot of snapshots.results ?? []) {
      if (!snapshot || typeof snapshot !== "object") continue;
      const artifactJson = (snapshot as { artifact_json?: unknown }).artifact_json;
      if (typeof artifactJson !== "string") continue;
      try {
        const parsed = JSON.parse(artifactJson) as { workflow?: unknown };
        if (parsed.workflow !== undefined) {
          workflow = parsed.workflow;
          break;
        }
      } catch {
        // Ignore a malformed historical snapshot and keep looking for a valid one.
      }
    }
    return Response.json({ case: caseRecord, snapshots: snapshots.results, workflow });
  } catch (error) {
    return routeError(error);
  }
}
