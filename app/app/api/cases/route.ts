import { ensureSnapshotTables, getD1 } from "../../../db";
import { researchClaimFrameSchema, type ResearchClaimFrame } from "../../../lib/research-brief";

type ArtifactPayload = {
  caseId?: string;
  originalPrompt?: string;
  compiledClaim?: { statement?: string } | null;
  claims?: unknown;
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
        .bind(snapshotId, caseId, null, "human-ai-workflow", "save-snapshot", JSON.stringify(artifact), now),
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
    return Response.json({ case: caseRecord, snapshots: snapshots.results });
  } catch (error) {
    return routeError(error);
  }
}
