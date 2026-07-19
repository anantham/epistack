import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { env } from "cloudflare:workers";
import {
  createFallbackDecomposition,
  decompositionInstructions,
  decompositionSchema,
  sanitizeDecomposition,
} from "../../../lib/decomposition-server";

const defaultModel = "gpt-5.6-terra";

type DecompositionEnvironment = {
  OPENAI_API_KEY?: string;
  EPISTACK_DECOMPOSITION_MODEL?: string;
};

export async function POST(request: Request) {
  let prompt = "";
  try {
    const body = (await request.json()) as { prompt?: unknown };
    prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (prompt.length < 12) {
    return Response.json({ error: "Enter a fuller question or paragraph before decomposing it." }, { status: 400 });
  }
  if (prompt.length > 5000) {
    return Response.json({ error: "Keep the starting paragraph under 5,000 characters." }, { status: 400 });
  }

  const caseId = crypto.randomUUID();
  const runtimeEnvironment = env as unknown as DecompositionEnvironment;
  const apiKey = runtimeEnvironment.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const configuredModel = runtimeEnvironment.EPISTACK_DECOMPOSITION_MODEL
    || process.env.EPISTACK_DECOMPOSITION_MODEL
    || defaultModel;
  if (!apiKey) {
    return Response.json({
      caseId,
      mode: "local-fallback",
      model: "domain-general fallback",
      warning: "The model connection is not configured, so this map was generated locally and should receive extra scrutiny.",
      prompt,
      decomposition: createFallbackDecomposition(prompt),
    });
  }

  try {
    const openai = createOpenAI({ apiKey });
    const { output } = await generateText({
      model: openai(configuredModel),
      output: Output.object({
        name: "question_decomposition",
        description: "A human-editable interpretation map for an underspecified research question.",
        schema: decompositionSchema,
      }),
      system: decompositionInstructions,
      prompt: `Decompose this submitted paragraph without answering it:\n\n${prompt}`,
      maxOutputTokens: 6000,
    });

    return Response.json({
      caseId,
      mode: "ai",
      model: configuredModel,
      warning: null,
      prompt,
      decomposition: sanitizeDecomposition(output, prompt),
    });
  } catch {
    return Response.json({
      caseId,
      mode: "local-fallback",
      model: "domain-general fallback",
      warning: "The model could not complete this decomposition, so a local fallback was used. Review every branch before relying on it.",
      prompt,
      decomposition: createFallbackDecomposition(prompt),
    });
  }
}
