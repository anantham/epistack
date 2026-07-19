import { ensureSnapshotTables, getD1 } from "../../../db";

type ArtifactPayload = {
  caseId?: string;
  originalPrompt?: string;
  compiledClaim?: { statement?: string } | null;
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

    await d1.batch([
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
    ]);

    return Response.json({ caseId, snapshotId, savedAt: now }, { status: 201 });
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
