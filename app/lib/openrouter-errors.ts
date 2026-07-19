export type OpenRouterFailure = {
  status: number;
  code: "authentication" | "credits" | "permission" | "model" | "rate_limit" | "timeout" | "availability" | "request" | "unknown";
  message: string;
};

type ErrorEnvelope = {
  error?: {
    code?: number | string;
    message?: string;
    metadata?: { error_type?: string };
  };
  error_type?: string;
  message?: string;
};

function safeEnvelope(value: unknown): ErrorEnvelope | null {
  if (!value || typeof value !== "object") return null;
  return value as ErrorEnvelope;
}

function parseEnvelope(value: unknown): ErrorEnvelope | null {
  if (typeof value === "string") {
    try {
      return safeEnvelope(JSON.parse(value));
    } catch {
      return { message: value };
    }
  }
  return safeEnvelope(value);
}

export function classifyOpenRouterFailure(
  status: number,
  rawMessage = "",
  errorType = "",
  retryAfter: string | null = null,
): OpenRouterFailure {
  const searchable = `${errorType} ${rawMessage}`.toLowerCase();

  if (status === 401 || /authentication|invalid api key|invalid.*credential|revoked key/.test(searchable)) {
    return { status: 401, code: "authentication", message: "That API key is invalid, disabled, or revoked." };
  }
  if (status === 402 || /payment_required|insufficient credit|out of credit|credit balance/.test(searchable)) {
    return { status: 402, code: "credits", message: "The key is valid, but its account or allowance has insufficient credits." };
  }
  if (status === 404 || /not_found|model.*not found|unknown model|invalid model/.test(searchable)) {
    return { status: 404, code: "model", message: "That model ID is not available on OpenRouter. Check the provider/model spelling." };
  }
  if (status === 403 || /permission_denied|forbidden|permission/.test(searchable)) {
    return { status: 403, code: "permission", message: "The key is valid, but it does not have permission to use this model." };
  }
  if (status === 429 || /rate_limit|rate limit|too many requests/.test(searchable)) {
    const timing = retryAfter ? ` Retry after ${retryAfter} seconds.` : " Try again shortly.";
    return { status: 429, code: "rate_limit", message: `OpenRouter is rate-limiting this key.${timing}` };
  }
  if (status === 408 || status === 504 || /timeout|timed out/.test(searchable)) {
    return { status: 504, code: "timeout", message: "OpenRouter timed out while checking this connection. Try again." };
  }
  if (status === 502 || status === 503 || /provider_unavailable|provider_overloaded|no available provider/.test(searchable)) {
    return { status: 503, code: "availability", message: "The model exists, but no provider is currently available. Try again or choose another model." };
  }
  if (status === 400 || status === 422 || /invalid_request|unprocessable/.test(searchable)) {
    return { status: 400, code: "request", message: rawMessage || "OpenRouter rejected the request parameters." };
  }
  return { status: 502, code: "unknown", message: rawMessage || "OpenRouter could not complete the request." };
}

export async function openRouterFailureFromResponse(response: Response): Promise<OpenRouterFailure> {
  let envelope: ErrorEnvelope | null = null;
  try {
    envelope = parseEnvelope(await response.json());
  } catch {
    envelope = null;
  }
  const rawMessage = envelope?.error?.message || envelope?.message || "";
  const errorType = envelope?.error?.metadata?.error_type || envelope?.error_type || "";
  return classifyOpenRouterFailure(response.status, rawMessage, errorType, response.headers.get("retry-after"));
}

export function openRouterFailureFromThrown(thrown: unknown): OpenRouterFailure {
  const candidates: unknown[] = [thrown];
  let status = 0;
  let rawMessage = "";
  let errorType = "";

  for (let index = 0; index < candidates.length && index < 5; index += 1) {
    const candidate = candidates[index];
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    if (!status) {
      const candidateStatus = record.statusCode ?? record.status;
      if (typeof candidateStatus === "number") status = candidateStatus;
    }
    if (!rawMessage && typeof record.message === "string") rawMessage = record.message;
    const envelope = parseEnvelope(record.responseBody) || parseEnvelope(record.data);
    if (envelope) {
      rawMessage = envelope.error?.message || envelope.message || rawMessage;
      errorType = envelope.error?.metadata?.error_type || envelope.error_type || errorType;
      if (!status && typeof envelope.error?.code === "number") status = envelope.error.code;
    }
    if (record.cause) candidates.push(record.cause);
  }

  return classifyOpenRouterFailure(status, rawMessage, errorType);
}
