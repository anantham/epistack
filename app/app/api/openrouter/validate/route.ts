import {
  classifyOpenRouterFailure,
  openRouterFailureFromResponse,
} from "../../../../lib/openrouter-errors";

const openRouterBaseURL = "https://openrouter.ai/api/v1";
const modelIdPattern = /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i;

type ValidationRequest = {
  openRouterApiKey?: unknown;
  openRouterModel?: unknown;
};

type KeyInformation = {
  data?: {
    limit_remaining?: number | null;
    is_free_tier?: boolean;
  };
};

function failureResponse(failure: ReturnType<typeof classifyOpenRouterFailure>) {
  return Response.json({ ok: false, ...failure }, { status: failure.status });
}

export async function POST(request: Request) {
  let openRouterApiKey = "";
  let openRouterModel = "";
  try {
    const body = (await request.json()) as ValidationRequest;
    openRouterApiKey = typeof body.openRouterApiKey === "string" ? body.openRouterApiKey.trim() : "";
    openRouterModel = typeof body.openRouterModel === "string" ? body.openRouterModel.trim() : "";
  } catch {
    return Response.json({ ok: false, code: "request", message: "The validation request was not valid JSON." }, { status: 400 });
  }

  if (!openRouterApiKey) {
    return Response.json({ ok: false, code: "authentication", message: "Enter an API key before validating." }, { status: 400 });
  }
  if (openRouterApiKey.length > 300) {
    return Response.json({ ok: false, code: "authentication", message: "That API key is longer than expected." }, { status: 400 });
  }
  if (!openRouterModel || openRouterModel.length > 160 || !modelIdPattern.test(openRouterModel)) {
    return Response.json({ ok: false, code: "model", message: "Use a model ID in provider/model form." }, { status: 400 });
  }

  const headers = {
    Authorization: `Bearer ${openRouterApiKey}`,
    "HTTP-Referer": request.headers.get("origin") || "https://epistack-evidence-lab.avalokai.chatgpt.site",
    "X-OpenRouter-Title": "Epistack Evidence Lab",
  };

  try {
    const keyResponse = await fetch(`${openRouterBaseURL}/key`, {
      headers,
      cache: "no-store",
    });
    if (!keyResponse.ok) return failureResponse(await openRouterFailureFromResponse(keyResponse));

    const keyInformation = await keyResponse.json() as KeyInformation;
    const allowance = keyInformation.data?.limit_remaining;
    if (typeof allowance === "number" && allowance <= 0 && !openRouterModel.endsWith(":free")) {
      return failureResponse(classifyOpenRouterFailure(402, "insufficient credits"));
    }

    const [author, slug] = openRouterModel.split("/");
    const modelResponse = await fetch(`${openRouterBaseURL}/model/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`, {
      headers,
      cache: "no-store",
    });
    if (!modelResponse.ok) return failureResponse(await openRouterFailureFromResponse(modelResponse));

    const allowanceMessage = typeof allowance === "number"
      ? ` $${allowance.toFixed(2)} of this key's allowance remains.`
      : "";
    return Response.json({
      ok: true,
      code: "valid",
      message: `Key and model validated.${allowanceMessage}`,
      model: openRouterModel,
      isFreeTier: Boolean(keyInformation.data?.is_free_tier),
    });
  } catch (thrown) {
    const timedOut = thrown instanceof Error && thrown.name === "TimeoutError";
    const failure = classifyOpenRouterFailure(timedOut ? 504 : 0, thrown instanceof Error ? thrown.message : "");
    return failureResponse(failure);
  }
}
