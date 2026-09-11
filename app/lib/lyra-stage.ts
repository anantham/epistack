// @ts-ignore The Cloudflare runtime module is provided by the Workers build; its ambient types are absent from this tsc project (same pre-existing condition as every other API route).
import { env } from "cloudflare:workers";

type LyraEnvironment = {
  LYRA_PUBLIC_GATEWAY_URL?: string;
  LYRA_API_KEY?: string;
};

type LyraResponse = {
  id?: string;
  status?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
};

export type LyraStageOptions = {
  model: string;
  input: string;
  instructions?: string;
  effort?: "instant" | "medium" | "high" | "xhigh" | "pro";
  timeoutMs?: number;
};

const pollIntervalMs = 4_000;
const defaultTimeoutMs = 10 * 60 * 1000;

function lyraEnvironment(): LyraEnvironment {
  return env as unknown as LyraEnvironment;
}

export function lyraConfigured(): boolean {
  const current = lyraEnvironment();
  return Boolean(current.LYRA_PUBLIC_GATEWAY_URL && current.LYRA_API_KEY);
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
    if (remaining <= 0) throw new Error("The hosted Lyra stage timed out before it completed.");
    const response = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(Math.min(remaining, 30_000)),
    });
    if (response.status === 429 || response.status === 503) {
      const delay = retryDelayMs(response);
      if (Date.now() + delay > deadline) throw new Error("The hosted Lyra stage timed out while rate limited.");
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok) throw new Error(`The hosted Lyra stage returned HTTP ${response.status}.`);
    return response;
  }
}

export async function runLyraStage(options: LyraStageOptions): Promise<string> {
  const current = lyraEnvironment();
  if (!current.LYRA_PUBLIC_GATEWAY_URL || !current.LYRA_API_KEY) {
    throw new Error("The hosted Lyra gateway is not configured.");
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
      input: options.input,
    }),
  }, deadline);
  const receipt = await submission.json() as LyraResponse;
  if (!receipt.id) throw new Error("The hosted Lyra gateway did not return a response id.");
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
      throw new Error("The hosted Lyra stage did not complete.");
    }
    if (Date.now() >= deadline) throw new Error("The hosted Lyra stage timed out before it completed.");
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
