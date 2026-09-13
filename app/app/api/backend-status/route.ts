// @ts-ignore The Cloudflare runtime module is provided by the Workers build; its ambient types are absent from this tsc project.
import { env } from "cloudflare:workers";

const openRouterBaseURL = "https://openrouter.ai/api/v1";
const checkTimeoutMs = 8_000;

type HostedConfig = {
  LYRA_PUBLIC_GATEWAY_URL?: string;
  LYRA_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  EPISTACK_OPENROUTER_MODEL?: string;
};

type ServiceStatus = {
  state: "healthy" | "attention" | "unavailable" | "not-configured";
  message: string;
  model?: string;
};

const config = () => env as unknown as HostedConfig;

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function responseMessage(response: Response, service: string) {
  if (response.status === 401 || response.status === 403) {
    return `${service} responded, but the hosted credential was refused.`;
  }
  if (response.status === 404) {
    return `${service} responded, but the requested status route was not found.`;
  }
  if (response.status === 429) {
    return `${service} is reachable but rate-limited right now.`;
  }
  if (response.status >= 500) {
    return `${service} returned HTTP ${response.status}.`;
  }
  return `${service} returned HTTP ${response.status}.`;
}

async function checkAstra(current: HostedConfig): Promise<ServiceStatus> {
  if (!current.LYRA_PUBLIC_GATEWAY_URL || !current.LYRA_API_KEY) {
    return { state: "not-configured", message: "Hosted Astra credentials are not configured." };
  }
  try {
    // The public Funnel intentionally exposes only the Responses surface. A
    // read of a deliberately nonexistent response ID exercises TLS, routing,
    // authentication, and the scoped read permission without creating work.
    const response = await fetch(`${current.LYRA_PUBLIC_GATEWAY_URL.replace(/\/$/, "")}/v1/responses/epistack-health-probe`, {
      headers: { Authorization: `Bearer ${current.LYRA_API_KEY}` },
      signal: AbortSignal.timeout(checkTimeoutMs),
    });
    if (response.ok || response.status === 404) return { state: "healthy", message: "Astra gateway responded and accepted its credential." };
    if (response.status >= 500) return { state: "unavailable", message: responseMessage(response, "Astra") };
    return { state: "attention", message: responseMessage(response, "Astra") };
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Astra did not respond within 8 seconds."
      : "Astra could not be reached from the hosted worker.";
    return { state: "unavailable", message };
  }
}

async function checkOpenRouter(current: HostedConfig): Promise<ServiceStatus> {
  const model = current.EPISTACK_OPENROUTER_MODEL || "anthropic/claude-opus-4.8";
  if (!current.OPENROUTER_API_KEY) {
    return { state: "not-configured", message: "Hosted OpenRouter credentials are not configured.", model };
  }
  const headers = {
    Authorization: `Bearer ${current.OPENROUTER_API_KEY}`,
    "HTTP-Referer": "https://epistack.adityaarpitha.com",
    "X-OpenRouter-Title": "Epistack Evidence Lab",
  };
  try {
    const keyResponse = await fetch(`${openRouterBaseURL}/key`, {
      headers,
      signal: AbortSignal.timeout(checkTimeoutMs),
    });
    if (!keyResponse.ok) {
      return {
        state: keyResponse.status >= 500 ? "unavailable" : "attention",
        message: responseMessage(keyResponse, "OpenRouter"),
        model,
      };
    }
    const [author, slug] = model.split("/");
    const modelResponse = await fetch(`${openRouterBaseURL}/model/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`, {
      headers,
      signal: AbortSignal.timeout(checkTimeoutMs),
    });
    if (modelResponse.ok) return { state: "healthy", message: "OpenRouter responded and the configured model is available.", model };
    return {
      state: modelResponse.status >= 500 ? "unavailable" : "attention",
      message: responseMessage(modelResponse, "OpenRouter"),
      model,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "OpenRouter did not respond within 8 seconds."
      : "OpenRouter could not be reached from the hosted worker.";
    return { state: "unavailable", message, model };
  }
}

export async function GET() {
  const current = config();
  const [astra, openrouter] = await Promise.all([checkAstra(current), checkOpenRouter(current)]);
  return json({ checkedAt: new Date().toISOString(), astra, openrouter });
}
