export type HostedBackendFailureCode = "backend-unreachable" | "backend-timeout";

export function isHostedBackendUnavailableCode(code: unknown): code is HostedBackendFailureCode {
  return code === "backend-unreachable" || code === "backend-timeout";
}

export function isAbortTimeout(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return candidate.name === "TimeoutError"
    || candidate.code === "ETIMEDOUT"
    || (typeof candidate.message === "string" && /timed out|timeout/i.test(candidate.message));
}
