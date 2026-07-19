import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { env } from "cloudflare:workers";
import {
  decompositionInstructions,
  decompositionOutputSchema,
  decompositionSchema,
  sanitizeDecomposition,
} from "../../../lib/decomposition-server";
import { openRouterFailureFromThrown } from "../../../lib/openrouter-errors";

const defaultOpenRouterModel = "anthropic/claude-opus-4.8";
const openRouterBaseURL = "https://openrouter.ai/api/v1";

type DecompositionEnvironment = {
  OPENROUTER_API_KEY?: string;
  EPISTACK_OPENROUTER_MODEL?: string;
};

type DecompositionRequest = {
  prompt?: unknown;
  decisionContext?: unknown;
  openRouterApiKey?: unknown;
  openRouterModel?: unknown;
};

const modelIdPattern = /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i;

export async function POST(request: Request) {
  let prompt = "";
  let decisionContext = "";
  let suppliedOpenRouterKey = "";
  let suppliedOpenRouterModel = "";
  try {
    const body = (await request.json()) as DecompositionRequest;
    prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    decisionContext = typeof body.decisionContext === "string" ? body.decisionContext.trim() : "";
    suppliedOpenRouterKey = typeof body.openRouterApiKey === "string" ? body.openRouterApiKey.trim() : "";
    suppliedOpenRouterModel = typeof body.openRouterModel === "string" ? body.openRouterModel.trim() : "";
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (prompt.length < 12) {
    return Response.json({ error: "Enter a fuller question or paragraph before decomposing it." }, { status: 400 });
  }
  if (prompt.length > 5000) {
    return Response.json({ error: "Keep the starting paragraph under 5,000 characters." }, { status: 400 });
  }
  if (decisionContext.length > 4000) {
    return Response.json({ error: "Keep the decision context under 4,000 characters." }, { status: 400 });
  }
  if (suppliedOpenRouterKey.length > 300) {
    return Response.json({ error: "The OpenRouter key is longer than expected." }, { status: 400 });
  }
  if (suppliedOpenRouterModel && (suppliedOpenRouterModel.length > 160 || !modelIdPattern.test(suppliedOpenRouterModel))) {
    return Response.json({ error: "Use an OpenRouter model id such as anthropic/claude-opus-4.8." }, { status: 400 });
  }

  const caseId = crypto.randomUUID();
  const runtimeEnvironment = env as unknown as DecompositionEnvironment;
  const openRouterApiKey = suppliedOpenRouterKey
    || runtimeEnvironment.OPENROUTER_API_KEY
    || process.env.OPENROUTER_API_KEY;
  const openRouterModel = suppliedOpenRouterModel
    || runtimeEnvironment.EPISTACK_OPENROUTER_MODEL
    || process.env.EPISTACK_OPENROUTER_MODEL
    || defaultOpenRouterModel;

  if (!openRouterApiKey) {
    return Response.json({
      error: "Add an OpenRouter key in Settings to decompose this question.",
    }, { status: 401 });
  }

  try {
    const origin = request.headers.get("origin") || "https://epistack-evidence-lab.avalokai.chatgpt.site";
    const openRouter = createOpenAI({
      apiKey: openRouterApiKey,
      baseURL: openRouterBaseURL,
      headers: {
        "HTTP-Referer": origin,
        "X-OpenRouter-Title": "Epistack Evidence Lab",
        "X-OpenRouter-Metadata": "enabled",
      },
    });
    const basePrompt = `Decompose this submitted paragraph without answering it.\n\nSUBMITTED QUESTION:\n${prompt}\n\nKNOWN DECISION CONTEXT:\n${decisionContext || "None supplied. Ask only high-value follow-up questions."}`;
    let validationSummary = "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repairInstruction = attempt === 0
        ? ""
        : `\n\nREPAIR PASS: The previous attempt missed required fields or cardinalities (${validationSummary || "schema mismatch"}). Return a complete object with 4–7 axes, 2–4 branches per axis, inspectable clusters, exact-substring highlights, and 3–5 context questions with answer options.`;
      const { output } = await generateText({
        model: openRouter(openRouterModel),
        output: Output.object({
          name: "question_decomposition",
          description: "A human-editable interpretation map for an underspecified research question.",
          schema: decompositionOutputSchema,
        }),
        system: decompositionInstructions,
        prompt: `${basePrompt}${repairInstruction}`,
        maxOutputTokens: 12000,
        temperature: 0.2,
      });

      const validatedOutput = decompositionSchema.safeParse(output);
      if (validatedOutput.success) {
        return Response.json({
          caseId,
          mode: "ai",
          model: `OpenRouter · ${openRouterModel}`,
          warning: attempt === 1 ? "The first model response was incomplete; Epistack repaired it automatically." : null,
          prompt,
          decisionContext,
          decomposition: sanitizeDecomposition(validatedOutput.data, prompt, decisionContext),
        });
      }
      validationSummary = validatedOutput.error.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
    }

    return Response.json({
      error: `${openRouterModel} returned an incomplete decomposition after two attempts. Try again or choose another frontier model in Settings.`,
      code: "invalid_model_output",
      details: validationSummary,
    }, { status: 502 });
  } catch (thrown) {
    const failure = openRouterFailureFromThrown(thrown);
    return Response.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
