// @ts-ignore The Cloudflare runtime module is provided by the Workers build; its ambient types are absent from this tsc project (same pre-existing condition as every other API route).
import { env } from "cloudflare:workers";
import { isAbortTimeout, isHostedBackendUnavailableCode } from "./provider-failure-policy.ts";

type LyraEnvironment = {
  LYRA_PUBLIC_GATEWAY_URL?: string;
  LYRA_API_KEY?: string;
};

type LyraResponse = {
  id?: string;
  status?: string;
  error?: unknown;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  lyra?: {
    failure?: {
      classification?: string;
      detail?: string;
      phase?: string;
      provider?: string;
      prompt_submitted?: boolean;
    };
  };
};

export class LyraStageError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "LyraStageError";
    this.code = code;
  }
}

export type LyraStageOptions = {
  model: string;
  input: string;
  instructions?: string;
  effort?: "instant" | "medium" | "high" | "xhigh" | "pro";
  timeoutMs?: number;
  metadata?: Record<string, string | number | boolean>;
};

const pollIntervalMs = 4_000;
// A hosted request must yield to the alternate provider before a browser or
// Worker request becomes an apparently hung investigation. Background Astra
// receipts still continue on the gateway; this deadline only bounds this
// caller's wait before it falls back or reports the outage.
export const defaultTimeoutMs = 90_000;

function lyraEnvironment(): LyraEnvironment {
  return env as unknown as LyraEnvironment;
}

export function lyraConfigured(): boolean {
  const current = lyraEnvironment();
  return Boolean(current.LYRA_PUBLIC_GATEWAY_URL && current.LYRA_API_KEY);
}

export function isBackendUnreachable(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && isHostedBackendUnavailableCode((error as { code?: string }).code));
}

export function backendUnreachableResponse(): Response {
  return Response.json(
    { error: "Astra is offline. Try again shortly.", code: "backend-unreachable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function annotateBackendUnreachable(error: unknown): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  (failure as Error & { code?: string }).code = "backend-unreachable";
  return failure;
}

function annotateBackendTimeout(error: unknown): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  (failure as Error & { code?: string }).code = "backend-timeout";
  return failure;
}

function retryDelayMs(response: Response) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 86_400) * 1000;
  return 60_000;
}

function extractStageText(response: LyraResponse) {
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("\n");
}

async function gatewayRequest(
  baseUrl: string,
  apiKey: string,
  path: string,
  init: { method: string; body?: string },
  deadline: number,
) {
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw annotateBackendTimeout(new Error("The hosted Astra stage timed out before it completed."));
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: AbortSignal.timeout(Math.min(remaining, 30_000)),
      });
    } catch (error) {
      if (isAbortTimeout(error)) throw annotateBackendTimeout(error);
      throw annotateBackendUnreachable(error);
    }
    if (response.status === 429 || response.status === 503) {
      const delay = retryDelayMs(response);
      if (Date.now() + delay > deadline) {
        throw annotateBackendTimeout(new Error("The hosted Astra stage timed out while rate limited."));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok) {
      const error = new Error(`The hosted Astra stage returned HTTP ${response.status}.`);
      if (response.status >= 500) throw annotateBackendUnreachable(error);
      throw error;
    }
    return response;
  }
}

export async function runLyraStage(options: LyraStageOptions): Promise<string> {
  const current = lyraEnvironment();
  if (!current.LYRA_PUBLIC_GATEWAY_URL || !current.LYRA_API_KEY) {
    throw new Error("The hosted Astra gateway is not configured.");
  }
  const baseUrl = current.LYRA_PUBLIC_GATEWAY_URL.replace(/\/$/, "");
  const deadline = Date.now() + (options.timeoutMs ?? defaultTimeoutMs);
  const submission = await gatewayRequest(baseUrl, current.LYRA_API_KEY, "/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: options.model,
      background: true,
      reasoning: { effort: options.effort ?? "instant" },
      ...(options.instructions ? { instructions: options.instructions } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
      input: options.input,
    }),
  }, deadline);
  const receipt = await submission.json() as LyraResponse;
  if (!receipt.id) throw new Error("The hosted Astra gateway did not return a response id.");
  while (true) {
    const response = await gatewayRequest(
      baseUrl,
      current.LYRA_API_KEY,
      `/v1/responses/${receipt.id}`,
      { method: "GET" },
      deadline,
    );
    const result = await response.json() as LyraResponse;
    if (result.status === "completed") return extractStageText(result);
    if (["failed", "cancelled", "incomplete"].includes(result.status || "")) {
      const errorObject = result.error && typeof result.error === "object"
        ? result.error as { message?: string; code?: string }
        : null;
      const failure = result.lyra?.failure;
      const detail = failure?.detail || errorObject?.message || errorObject?.code || result.error;
      const transientProviderFailure = failure?.phase === "controls"
        && failure?.provider === "chatgpt_tools"
        && failure?.prompt_submitted === false;
      throw new LyraStageError(
        `The hosted Astra stage did not complete${detail ? `: ${String(detail).slice(0, 300)}` : ""}.`,
        transientProviderFailure ? "provider_transient" : errorObject?.code,
      );
    }
    if (Date.now() >= deadline) {
      throw annotateBackendTimeout(new Error("The hosted Astra stage timed out before it completed."));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
