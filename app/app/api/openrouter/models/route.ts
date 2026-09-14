import { env } from "cloudflare:workers";

type ModelsEnvironment = {
  OPENROUTER_API_KEY?: string;
};

type OpenRouterModelRecord = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: Record<string, unknown>;
  supported_parameters?: unknown;
  architecture?: { output_modalities?: unknown };
};

function pricePerMillion(value: unknown) {
  const perToken = Number(value);
  return Number.isFinite(perToken) && perToken >= 0 ? Math.round(perToken * 1_000_000 * 1_000) / 1_000 : null;
}

function pricePerCall(value: unknown) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

const noStore = { "Cache-Control": "no-store" };

/** A compact model list for the Settings picker, fetched with the hosted key. */
export async function GET() {
  const apiKey = (env as unknown as ModelsEnvironment).OPENROUTER_API_KEY;
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "HTTP-Referer": "https://epistack.adityaarpitha.com",
        "X-OpenRouter-Title": "Epistack Evidence Lab",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: "OpenRouter's model list could not be reached." }, { status: 502, headers: noStore });
  }
  if (!response.ok) {
    return Response.json({ error: `OpenRouter's model list returned HTTP ${response.status}.` }, { status: 502, headers: noStore });
  }
  const payload = await response.json() as { data?: OpenRouterModelRecord[] };
  const models = (payload.data ?? []).flatMap((model) => {
    if (typeof model.id !== "string") return [];
    const modalities = model.architecture?.output_modalities;
    if (Array.isArray(modalities) && !modalities.includes("text")) return [];
    const parameters = Array.isArray(model.supported_parameters) ? model.supported_parameters : [];
    return [{
      id: model.id,
      name: typeof model.name === "string" ? model.name : model.id,
      contextLength: typeof model.context_length === "number" ? model.context_length : null,
      promptPerMillion: pricePerMillion(model.pricing?.prompt),
      completionPerMillion: pricePerMillion(model.pricing?.completion),
      webSearchPerCall: pricePerCall(model.pricing?.web_search),
      reasoning: parameters.includes("reasoning"),
    }];
  }).sort((a, b) => a.id.localeCompare(b.id));
  return Response.json(
    { models, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
