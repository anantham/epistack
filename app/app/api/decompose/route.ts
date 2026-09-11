import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { env } from "cloudflare:workers";
import { operationCacheKey, readOperationCache, writeOperationCache } from "../../../db/cache";
import type { DecompositionResponse } from "../../../lib/decomposition";
import {
  assembleDecomposition,
  contextAgentOutputSchema,
  contextAgentSchema,
  createFallbackDecomposition,
  decompositionSchema,
  dimensionScoutOutputSchema,
  dimensionScoutSchema,
  normalizeDimensionScout,
  traceAgentOutputSchema,
  traceAgentSchema,
  type ContextAgentResult,
  type DimensionScout,
  type TraceAgentResult,
} from "../../../lib/decomposition-server";
import {
  promptOverridesSignature,
  renderAgentPrompt,
  resolveAgentPrompt,
  sanitizeAgentPromptOverrides,
  type AgentPromptOverrides,
} from "../../../lib/agent-prompts";
import {
  decompositionCacheContract,
  normalizeDecompositionText,
} from "../../../lib/decomposition-cache";
import { openRouterFailureFromThrown } from "../../../lib/openrouter-errors";

const defaultOpenRouterModel = "anthropic/claude-opus-4.8";
const openRouterBaseURL = "https://openrouter.ai/api/v1";
const decompositionCacheTtlMs = 30 * 24 * 60 * 60 * 1000;
type CachedDecomposition = Omit<DecompositionResponse, "cache">;

type DecompositionEnvironment = {
  OPENROUTER_API_KEY?: string;
  EPISTACK_OPENROUTER_MODEL?: string;
};

type DecompositionRequest = {
  prompt?: unknown;
  decisionContext?: unknown;
  openRouterApiKey?: unknown;
  openRouterModel?: unknown;
  promptOverrides?: unknown;
  refresh?: unknown;
};

const modelIdPattern = /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i;

function issueSummary(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
}

export async function POST(request: Request) {
  let prompt = "";
  let decisionContext = "";
  let suppliedOpenRouterKey = "";
  let suppliedOpenRouterModel = "";
  let promptOverrides: AgentPromptOverrides = {};
  let refresh = false;
  try {
    const body = (await request.json()) as DecompositionRequest;
    prompt = typeof body.prompt === "string" ? normalizeDecompositionText(body.prompt) : "";
    decisionContext = typeof body.decisionContext === "string" ? normalizeDecompositionText(body.decisionContext) : "";
    suppliedOpenRouterKey = typeof body.openRouterApiKey === "string" ? body.openRouterApiKey.trim() : "";
    suppliedOpenRouterModel = typeof body.openRouterModel === "string" ? body.openRouterModel.trim() : "";
    if (body.promptOverrides && JSON.stringify(body.promptOverrides).length > 120_000) {
      return Response.json({ error: "Prompt overrides are too large." }, { status: 400 });
    }
    promptOverrides = sanitizeAgentPromptOverrides(body.promptOverrides);
    refresh = body.refresh === true;
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

  const runtimeEnvironment = env as unknown as DecompositionEnvironment;
  const openRouterModel = suppliedOpenRouterModel
    || runtimeEnvironment.EPISTACK_OPENROUTER_MODEL
    || process.env.EPISTACK_OPENROUTER_MODEL
    || defaultOpenRouterModel;
  const cacheKey = await operationCacheKey("question-decomposition", decompositionCacheContract, {
    prompt,
    decisionContext,
    model: openRouterModel,
    promptConfig: promptOverridesSignature(promptOverrides),
  });
  if (!refresh) {
    const cached = await readOperationCache<CachedDecomposition>(cacheKey);
    if (cached) {
      return Response.json({
        ...cached.payload,
        cache: { status: "hit", layer: "d1", createdAt: cached.createdAt, expiresAt: cached.expiresAt },
      } satisfies DecompositionResponse);
    }
  }

  const openRouterApiKey = suppliedOpenRouterKey
    || runtimeEnvironment.OPENROUTER_API_KEY
    || process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey) {
    return Response.json({
      error: "No reusable decomposition is cached for this question and model. Add an OpenRouter key in Settings to create one.",
    }, { status: 401 });
  }

  const openRouter = createOpenAI({
    apiKey: openRouterApiKey,
    baseURL: openRouterBaseURL,
    headers: {
      "HTTP-Referer": request.headers.get("origin") || "https://epistack-evidence-lab.avalokai.chatgpt.site",
      "X-OpenRouter-Title": "Epistack Evidence Lab",
      "X-OpenRouter-Metadata": "enabled",
    },
  });
  const dimensionAgent = resolveAgentPrompt("dimension-scout", promptOverrides);
  const traceAgent = resolveAgentPrompt("trace-specialist", promptOverrides);
  const contextAgent = resolveAgentPrompt("context-retrieval", promptOverrides);
  const dimensionPrompt = renderAgentPrompt(dimensionAgent.taskTemplate, {
    question: prompt,
    decisionContext: decisionContext || "None supplied. Do not invent personal facts.",
  });
  let scout: DimensionScout | null = null;
  let scoutFailure: unknown = null;
  let scoutValidation = "";

  for (let attempt = 0; attempt < 2 && !scout; attempt += 1) {
    try {
      const { output } = await generateText({
        model: openRouter(openRouterModel),
        output: Output.object({
          name: "dimension_scout",
          description: "A compact list of substantive dimensions and concrete resolutions for an underspecified question.",
          schema: dimensionScoutOutputSchema,
        }),
        system: dimensionAgent.instructions,
        prompt: attempt === 0
          ? dimensionPrompt
          : renderAgentPrompt(dimensionAgent.repairTemplate ?? "{{basePrompt}}", {
              basePrompt: dimensionPrompt,
              validation: scoutValidation || "incomplete object",
            }),
        maxOutputTokens: dimensionAgent.maxOutputTokens,
        temperature: dimensionAgent.temperature,
      });
      const parsed = dimensionScoutSchema.safeParse(output);
      if (parsed.success) scout = parsed.data;
      else scoutValidation = issueSummary(parsed.error.issues);
    } catch (error) {
      scoutFailure = error;
      scoutValidation = error instanceof Error ? error.message : "specialist request failed";
    }
  }

  if (!scout) {
    const providerFailure = scoutFailure ? openRouterFailureFromThrown(scoutFailure) : null;
    if (providerFailure && ["authentication", "credits", "permission", "model", "rate_limit", "request"].includes(providerFailure.code)) {
      return Response.json({ error: providerFailure.message, code: providerFailure.code }, { status: providerFailure.status });
    }
    const payload: CachedDecomposition = {
      caseId: crypto.randomUUID(),
      mode: "local-fallback",
      model: `Local scaffold after ${openRouterModel}`,
      warning: "The dimension specialist did not return a usable compact object, so Epistack kept the workflow moving with an editable domain-general scaffold. This fallback was not added to the shared cache.",
      prompt,
      decisionContext,
      decomposition: createFallbackDecomposition(prompt, decisionContext),
    };
    return Response.json({
      ...payload,
      cache: { status: refresh ? "bypass" : "miss", layer: "d1", createdAt: null, expiresAt: null },
    } satisfies DecompositionResponse);
  }

  scout = normalizeDimensionScout(scout);
  const axisBrief = scout.dimensions.slice(0, 7).map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
  }));
  const tracePromise = (async (): Promise<TraceAgentResult> => {
    const { output } = await generateText({
      model: openRouter(openRouterModel),
      output: Output.object({
        name: "decomposition_trace",
        description: "Exact submitted-language cues mapped to fixed dimensions.",
        schema: traceAgentOutputSchema,
      }),
      system: traceAgent.instructions,
      prompt: renderAgentPrompt(traceAgent.taskTemplate, {
        question: prompt,
        dimensionsJson: JSON.stringify(axisBrief),
      }),
      maxOutputTokens: traceAgent.maxOutputTokens,
      temperature: traceAgent.temperature,
    });
    return traceAgentSchema.parse(output);
  })();
  const contextPromise = (async (): Promise<ContextAgentResult> => {
    const { output } = await generateText({
      model: openRouter(openRouterModel),
      output: Output.object({
        name: "context_and_retrieval_plan",
        description: "Retrieval metadata, mismatch risks, claim template, and high-value context questions for fixed dimensions.",
        schema: contextAgentOutputSchema,
      }),
      system: contextAgent.instructions,
      prompt: renderAgentPrompt(contextAgent.taskTemplate, {
        question: prompt,
        dimensionsJson: JSON.stringify(axisBrief),
        decisionContext: decisionContext || "None supplied. Ask only facts with high pruning or evidence-matching value.",
      }),
      maxOutputTokens: contextAgent.maxOutputTokens,
      temperature: contextAgent.temperature,
    });
    return contextAgentSchema.parse(output);
  })();
  const [traceSettled, contextSettled] = await Promise.allSettled([tracePromise, contextPromise]);
  const traceResult = traceSettled.status === "fulfilled" ? traceSettled.value : null;
  const contextResult = contextSettled.status === "fulfilled" ? contextSettled.value : null;
  const warnings: string[] = [];
  if (!traceResult) warnings.push("The trace specialist fell back to deterministic exact-word mapping.");
  if (!contextResult) warnings.push("The context specialist fell back to domain-general retrieval fields and interview questions.");
  const decomposition = assembleDecomposition(scout, traceResult, contextResult, prompt, decisionContext);
  const validated = decompositionSchema.safeParse(decomposition);
  if (!validated.success) {
    warnings.push("The merged specialist output missed the persistent artifact contract, so an editable scaffold is shown instead.");
  }
  const payload: CachedDecomposition = {
    caseId: crypto.randomUUID(),
    mode: validated.success ? "ai" : "local-fallback",
    model: `OpenRouter · ${openRouterModel} · orchestrated specialists`,
    warning: warnings.length ? warnings.join(" ") : null,
    prompt,
    decisionContext,
    decomposition: validated.success ? validated.data : createFallbackDecomposition(prompt, decisionContext),
  };
  const stored = validated.success
    ? await writeOperationCache(cacheKey, "question-decomposition", decompositionCacheContract, payload, decompositionCacheTtlMs)
    : null;
  return Response.json({
    ...payload,
    cache: {
      status: refresh ? "bypass" : "miss",
      layer: "d1",
      createdAt: stored?.createdAt ?? null,
      expiresAt: stored?.expiresAt ?? null,
    },
  } satisfies DecompositionResponse);
}
