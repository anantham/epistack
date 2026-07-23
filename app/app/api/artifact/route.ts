import {
  liveArtifactContractVersion,
  liveArtifactUnavailableSchema,
} from "../../../lib/live-artifact";
import { isD1Unavailable, readLiveArtifact } from "../../../lib/live-artifact-store";

function unavailableResponse(caseId: string) {
  const payload = liveArtifactUnavailableSchema.parse({
    contractVersion: liveArtifactContractVersion,
    caseId,
    status: {
      phase: "unavailable",
      label: "Durable evidence is unavailable",
      reasons: ["This runtime does not have the configured D1 evidence binding."],
      storage: "d1",
      isStale: false,
    },
    error: {
      code: "D1_UNAVAILABLE",
      message: "The durable evidence store is unavailable in this runtime.",
      recoverable: true,
    },
  });
  return Response.json(payload, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const rawCaseId = new URL(request.url).searchParams.get("caseId");
  const caseId = rawCaseId?.trim() || "";
  if (!caseId) {
    return Response.json({
      contractVersion: liveArtifactContractVersion,
      error: {
        code: "INVALID_CASE_ID",
        message: "caseId is required.",
      },
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (caseId.length > 200 || /[\u0000-\u001f\u007f]/.test(caseId)) {
    return Response.json({
      contractVersion: liveArtifactContractVersion,
      caseId,
      error: {
        code: "INVALID_CASE_ID",
        message: "caseId must be at most 200 characters and contain no control characters.",
      },
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const artifact = await readLiveArtifact(caseId);
    return Response.json(artifact, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (isD1Unavailable(error)) return unavailableResponse(caseId);
    return Response.json({
      contractVersion: liveArtifactContractVersion,
      caseId,
      error: {
        code: "ARTIFACT_READ_FAILED",
        message: "The persisted evidence artifact could not be read.",
      },
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
