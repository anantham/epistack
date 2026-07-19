export type OpenRouterFailure = {
  status: number;
  code: "authentication" | "credits" | "permission" | "model" | "rate_limit" | "timeout" | "availability" | "request" | "unknown";
  message: string;
  provider?: string;
};

type ErrorEnvelope = {
  error?: {
    code?: number | string;
    message?: string;
    type?: string;
    metadata?: {
      error_type?: string;
      provider_code?: string | number;
      provider_name?: string;
      raw?: unknown;
      reasons?: unknown;
    };
  };
  error_type?: string;
  message?: string;
  type?: string;
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

function cleanDetail(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 320 ? `${compact.slice(0, 317)}…` : compact;
}

function providerDetails(envelope: ErrorEnvelope | null) {
  const metadata = envelope?.error?.metadata;
  const nested = parseEnvelope(metadata?.raw);
  const nestedMessage = nested?.error?.message || nested?.message || "";
  return {
    providerName: metadata?.provider_name || "",
    providerCode: metadata?.provider_code === undefined ? "" : String(metadata.provider_code),
    providerMessage: cleanDetail(nestedMessage),
    nestedErrorType: nested?.error?.metadata?.error_type || nested?.error_type || nested?.error?.type || nested?.type || "",
  };
}

export function classifyOpenRouterFailure(
  status: number,
  rawMessage = "",
  errorType = "",
  retryAfter: string | null = null,
  providerName = "",
  providerMessage = "",
  providerCode = "",
): OpenRouterFailure {
  const searchable = `${errorType} ${rawMessage} ${providerMessage} ${providerCode}`.toLowerCase();
  const provider = providerName ? cleanDetail(providerName) : "";
  const namedProvider = provider || "The selected model's provider";
  const safeRawMessage = cleanDetail(rawMessage);
  const safeProviderMessage = cleanDetail(providerMessage);
  const genericProviderMessage = /^(provider returned error|provider error|bad request|request failed)$/i;

  if (status === 401 || /authentication|invalid api key|invalid.*credential|revoked key/.test(searchable)) {
    return { status: 401, code: "authentication", message: "That API key is invalid, disabled, or revoked.", provider };
  }
  if (status === 402 || /payment_required|insufficient credit|out of credit|credit balance/.test(searchable)) {
    return { status: 402, code: "credits", message: "The key is valid, but its account or allowance has insufficient credits.", provider };
  }
  if (status === 404 || /not_found|model.*not found|unknown model|invalid model/.test(searchable)) {
    return { status: 404, code: "model", message: "That model ID is not available on OpenRouter. Check the provider/model spelling.", provider };
  }
  if (status === 403 || /permission_denied|forbidden|permission/.test(searchable)) {
    return { status: 403, code: "permission", message: "The key is valid, but it does not have permission to use this model.", provider };
  }
  if (status === 429 || /rate_limit|rate limit|too many requests/.test(searchable)) {
    const timing = retryAfter ? ` Retry after ${retryAfter} seconds.` : " Try again shortly.";
    return { status: 429, code: "rate_limit", message: `OpenRouter is rate-limiting this key.${timing}`, provider };
  }
  if (status === 408 || status === 504 || /timeout|timed out/.test(searchable)) {
    return { status: 504, code: "timeout", message: `${namedProvider} timed out. Try again or choose another model.`, provider };
  }
  if (status === 502 || status === 503 || /provider_unavailable|provider_overloaded|no available provider/.test(searchable)) {
    return { status: 503, code: "availability", message: "The model exists, but no provider is currently available. Try again or choose another model.", provider };
  }
  if (/context_length_exceeded/.test(searchable)) {
    return { status: 400, code: "request", message: "The question, context, and output schema exceed this model's context window. Shorten the input or choose a larger-context model.", provider };
  }
  if (/max_tokens_exceeded|string_too_long/.test(searchable)) {
    return { status: 400, code: "request", message: `${namedProvider} rejected the request because its input or output limit was exceeded. Shorten the question or choose another model.`, provider };
  }
  if (/invalid_prompt/.test(searchable)) {
    return { status: 400, code: "request", message: `${namedProvider} rejected the prompt format. Try another model; the selected endpoint may not support this decomposition request.`, provider };
  }
  if (/content_policy_violation|moderation|guardrail|refusal/.test(searchable)) {
    return { status: 403, code: "permission", message: `${namedProvider} blocked the request under a content policy or guardrail.`, provider };
  }
  if (status === 400 || status === 422 || /invalid_request|unprocessable/.test(searchable)) {
    if (safeProviderMessage && !genericProviderMessage.test(safeProviderMessage)) {
      return { status: 400, code: "request", message: `${namedProvider} rejected the request: ${safeProviderMessage}`, provider };
    }
    if (safeRawMessage && !genericProviderMessage.test(safeRawMessage)) {
      return { status: 400, code: "request", message: `OpenRouter rejected the request: ${safeRawMessage}`, provider };
    }
    return {
      status: 400,
      code: "request",
      message: `${namedProvider} rejected the decomposition request (HTTP 400) without a specific reason. Retry once, then choose another model in Settings.`,
      provider,
    };
  }
  if (safeProviderMessage && !genericProviderMessage.test(safeProviderMessage)) {
    return { status: 502, code: "unknown", message: `${namedProvider} returned an error: ${safeProviderMessage}`, provider };
  }
  return { status: 502, code: "unknown", message: "OpenRouter could not complete the request and did not return a specific cause. Retry or choose another model.", provider };
}

export async function openRouterFailureFromResponse(response: Response): Promise<OpenRouterFailure> {
  let envelope: ErrorEnvelope | null = null;
  try {
    envelope = parseEnvelope(await response.json());
  } catch {
    envelope = null;
  }
  const rawMessage = envelope?.error?.message || envelope?.message || "";
  const details = providerDetails(envelope);
  const errorType = envelope?.error?.metadata?.error_type || envelope?.error_type || details.nestedErrorType;
  return classifyOpenRouterFailure(
    response.status,
    rawMessage,
    errorType,
    response.headers.get("retry-after"),
    details.providerName,
    details.providerMessage,
    details.providerCode,
  );
}

export function openRouterFailureFromThrown(thrown: unknown): OpenRouterFailure {
  const candidates: unknown[] = [thrown];
  let status = 0;
  let rawMessage = "";
  let errorType = "";
  let providerName = "";
  let providerMessage = "";
  let providerCode = "";

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
      const details = providerDetails(envelope);
      errorType = envelope.error?.metadata?.error_type || envelope.error_type || details.nestedErrorType || errorType;
      providerName = details.providerName || providerName;
      providerMessage = details.providerMessage || providerMessage;
      providerCode = details.providerCode || providerCode;
      if (!status && typeof envelope.error?.code === "number") status = envelope.error.code;
    }
    if (record.cause) candidates.push(record.cause);
  }

  return classifyOpenRouterFailure(status, rawMessage, errorType, null, providerName, providerMessage, providerCode);
}
