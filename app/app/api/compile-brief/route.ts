import { z } from 'zod';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
// @ts-ignore The Cloudflare runtime module is provided by the Workers build; its ambient types are absent from this tsc project (same pre-existing condition as every other API route).
import { env } from 'cloudflare:workers';
import { getD1, ensureHostedJobTables } from '../../../db';
import { resolveAgentPrompt, renderAgentPrompt, sanitizeAgentPromptOverrides, type AgentPromptOverrides } from '../../../lib/agent-prompts';
import { contextualizationEntrySchema, dimensionRoleSchema, researchBriefDraftSchema, researchBriefSchema, normalizeResearchBriefDraft, buildDimensionAssignments, type ContextualizationEntry, type DimensionRole } from '../../../lib/research-brief';
import type { DecompositionCluster } from '../../../lib/decomposition';
import { parseStructured, repairInstruction, StructuredOutputError } from '../../../lib/structured-output';
import { openRouterFailureFromThrown } from '../../../lib/openrouter-errors';

const defaultOpenRouterModel = 'anthropic/claude-opus-4.8';
const defaultOpenRouterRepairModel = 'openai/gpt-4o-mini';
const openRouterBaseURL = 'https://openrouter.ai/api/v1';

const contextQuestionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  question: z.string().min(1),
  whyItMatters: z.string(),
  effect: z.enum(['prune', 'branch', 'match']),
  options: z.array(z.string()),
});

const clusterSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  highlightQuotes: z.array(z.string()).default([]),
  latentVariable: z.string().default(''),
  rationale: z.string().default(''),
  ingestionRequirements: z.object({
    requiredFields: z.array(z.string()).default([]),
    searchConcepts: z.array(z.string()).default([]),
    mismatchRisks: z.array(z.string()).default([]),
  }),
  contextQuestion: contextQuestionSchema,
});

const createInputSchema = z.object({
  caseId: z.string().min(1).max(120),
  originalQuestion: z.string().min(8).max(5000),
  compiledQuestion: z.string().min(8).max(5000),
  decisionContext: z.string().max(8000).optional(),
  clusters: z.array(clusterSchema).min(1).max(12),
  knownUnknowns: z.array(z.string()).max(20).optional(),
  dimensionRoles: z.record(z.string(), dimensionRoleSchema).optional(),
  promptOverrides: z.unknown().optional(),
  contextualization: z.array(contextualizationEntrySchema).max(12).optional(),
});

type State = {
  caseId: string;
  originalQuestion: string;
  compiledQuestion: string;
  decisionContext: string;
  clusters: DecompositionCluster[];
  knownUnknowns: string[];
  dimensionRoles: Record<string, DimensionRole>;
  promptOverrides: AgentPromptOverrides;
  contextualization: ContextualizationEntry[];
  status: string;
  remoteId?: string | null;
  nextAt?: number;
  brief?: unknown;
  error?: string;
  code?: string;
  rateLimits?: number;
  origin?: string;
  compiledBy?: string;
  repairAttempts?: number;
  repairing?: boolean;
  repairRaw?: string;
  repairIssues?: string;
};

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

function shortHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function extractText(response: unknown) {
  const output = (response as { output?: Array<{ content?: Array<{ text?: string }> }> })?.output;
  const item = Array.isArray(output) ? output[0] : null;
  const content = Array.isArray(item?.content) ? item.content[0] : null;
  return typeof content?.text === 'string' ? content.text : '';
}

function parseDraftText(text: string) {
  return parseStructured(text, researchBriefDraftSchema);
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Use this site to compile a research brief.' }, 403);
  const config = env as unknown as {
    LYRA_PUBLIC_GATEWAY_URL?: string;
    LYRA_API_KEY?: string;
    OPENROUTER_API_KEY?: string;
    EPISTACK_OPENROUTER_MODEL?: string;
    EPISTACK_OPENROUTER_REPAIR_MODEL?: string;
  };
  if (!config.LYRA_PUBLIC_GATEWAY_URL || !config.LYRA_API_KEY) return json({ error: 'Hosted brief compilation is not configured yet.', code: 'hosted-not-configured' }, 503);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 300000) return json({ error: 'Request too large.' }, 413);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Invalid request.' }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  await ensureHostedJobTables();
  const db = getD1();
  if (!body.id) {
    const candidate = createInputSchema.safeParse(body);
    if (!candidate.success) {
      const issue = candidate.error.issues[0];
      return json({ error: issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid brief request.' }, 400);
    }
    const input = candidate.data;
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const state: State = {
      caseId: input.caseId,
      originalQuestion: input.originalQuestion,
      compiledQuestion: input.compiledQuestion,
      decisionContext: input.decisionContext ?? '',
      clusters: input.clusters as DecompositionCluster[],
      knownUnknowns: input.knownUnknowns ?? [],
      dimensionRoles: input.dimensionRoles ?? {},
      promptOverrides: sanitizeAgentPromptOverrides(input.promptOverrides),
      contextualization: input.contextualization ?? [],
      status: 'queued',
      remoteId: null,
      origin: new URL(request.url).origin,
    };
    await db.prepare('INSERT INTO hosted_brief_jobs (id, token, state_json, created_at) VALUES (?, ?, ?, ?)').bind(id, token, JSON.stringify(state), Date.now()).run();
    return json({ id, token, status: 'queued' }, 202);
  }
  if (typeof body.id !== 'string' || typeof body.token !== 'string') return json({ error: 'Job credentials required.' }, 400);
  const row = await db.prepare('UPDATE hosted_brief_jobs SET locked_until = ? WHERE id = ? AND token = ? AND locked_until < ? RETURNING state_json').bind(Date.now() + 60000, body.id, body.token, Date.now()).first<{ state_json: string }>();
  if (!row) {
    const owned = await db.prepare('SELECT id FROM hosted_brief_jobs WHERE id = ? AND token = ?').bind(body.id, body.token).first();
    return owned ? json({ id: body.id, status: 'busy', brief: null, error: null }, 202) : json({ error: 'Run unavailable in this browser.' }, 404);
  }
  const state = JSON.parse(row.state_json) as State;
  const save = () => db.prepare('UPDATE hosted_brief_jobs SET state_json = ? WHERE id = ?').bind(JSON.stringify(state), body.id).run();
  async function remote(path: string, payload?: unknown) {
    let response: Response;
    try {
      response = await fetch(config.LYRA_PUBLIC_GATEWAY_URL!.replace(/\/$/, '') + path, {
        method: payload ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${config.LYRA_API_KEY}`, 'Content-Type': 'application/json' },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      const failure = new Error('The Astra backend is unreachable.') as Error & { code?: string };
      failure.code = 'backend-unreachable';
      throw failure;
    }
    if (response.status === 429 || response.status === 503) {
      const delay = Number(response.headers.get('retry-after'));
      state.nextAt = Date.now() + (Number.isFinite(delay) && delay > 0 ? Math.min(delay, 86400) : 60) * 1000;
      state.rateLimits = (state.rateLimits || 0) + 1;
      state.status = 'queued';
      return null;
    }
    if (!response.ok) {
      const error = new Error(response.status >= 500
        ? `The Astra backend returned HTTP ${response.status}.`
        : `Backend returned HTTP ${response.status}. The saved run has stopped; it will not resubmit automatically.`) as Error & { code?: string };
      if (response.status >= 500) error.code = 'backend-unreachable';
      throw error;
    }
    return response.json();
  }
  function compilerRequest(current: State) {
    const agent = resolveAgentPrompt('research-brief-compiler', current.promptOverrides);
    const dimensionAssignments = buildDimensionAssignments({ clusters: current.clusters, dimensionRoles: current.dimensionRoles });
    const values = {
      question: current.originalQuestion,
      compiledQuestion: current.compiledQuestion,
      decisionContext: current.decisionContext || 'No personal context supplied. Preserve this as an explicit limitation.',
      dimensionAssignmentsJson: JSON.stringify(dimensionAssignments, null, 2),
      contextualizationJson: JSON.stringify(current.contextualization, null, 2),
      axesJson: JSON.stringify(current.clusters.map((cluster) => ({ id: cluster.id, label: cluster.label })), null, 2),
      knownUnknownsJson: JSON.stringify(current.knownUnknowns, null, 2),
    };
    return {
      model: 'lyra-chatgpt-pro',
      background: true,
      // Brief compilation is an interactive stage. Medium effort keeps the
      // hosted browser lane responsive; malformed output still goes through
      // the strict OpenRouter repair/fallback path below.
      reasoning: { effort: 'medium' },
      instructions: agent.instructions + '\nReturn only one JSON object matching this schema. No markdown fences.\n' + JSON.stringify(z.toJSONSchema(researchBriefDraftSchema)),
      input: renderAgentPrompt(agent.taskTemplate, values),
      metadata: { client_job: 'epistack-hosted-research-brief-compiler' },
    };
  }
  function compilerRepairRequest(current: State, raw: string, issues: string) {
    const agent = resolveAgentPrompt('research-brief-compiler', current.promptOverrides);
    return {
      model: 'lyra-chatgpt-pro',
      background: true,
      reasoning: { effort: 'medium' },
      instructions: agent.instructions + repairInstruction(researchBriefDraftSchema, issues),
      input: `Repair the previous research brief response below. Preserve its substantive claims where possible, but return a complete valid JSON object.\n\nPREVIOUS RESPONSE\n${raw.slice(0, 40_000)}`,
      metadata: { client_job: 'epistack-hosted-research-brief-compiler-repair' },
    };
  }
  async function openRouterCompilerRequest(current: State) {
    const apiKey = config.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('Astra is unreachable and the hosted fallback is not configured.');
    const primaryModelId = config.EPISTACK_OPENROUTER_MODEL || defaultOpenRouterModel;
    const repairModelId = config.EPISTACK_OPENROUTER_REPAIR_MODEL || defaultOpenRouterRepairModel;
    const modelIds = Array.from(new Set([primaryModelId, repairModelId]));
    const agent = resolveAgentPrompt('research-brief-compiler', current.promptOverrides);
    const dimensionAssignments = buildDimensionAssignments({ clusters: current.clusters, dimensionRoles: current.dimensionRoles });
    const values = {
      question: current.originalQuestion,
      compiledQuestion: current.compiledQuestion,
      decisionContext: current.decisionContext || 'No personal context supplied. Preserve this as an explicit limitation.',
      dimensionAssignmentsJson: JSON.stringify(dimensionAssignments, null, 2),
      contextualizationJson: JSON.stringify(current.contextualization, null, 2),
      axesJson: JSON.stringify(current.clusters.map((cluster) => ({ id: cluster.id, label: cluster.label })), null, 2),
      knownUnknownsJson: JSON.stringify(current.knownUnknowns, null, 2),
    };
    const openRouter = createOpenAI({
      apiKey,
      baseURL: openRouterBaseURL,
      headers: {
        'HTTP-Referer': new URL(request.url).origin,
        'X-OpenRouter-Title': 'Epistack Evidence Lab',
        'X-OpenRouter-Metadata': 'enabled',
      },
    });
    let lastFailure: Error | null = null;
    for (const modelId of modelIds) {
      try {
        const result = await generateText({
          model: openRouter(modelId),
          output: Output.object({
            name: 'research_brief',
            description: 'A validated research contract with claim frames for a decision question.',
            schema: researchBriefDraftSchema,
          }),
          system: agent.instructions,
          prompt: renderAgentPrompt(agent.taskTemplate, values),
          maxOutputTokens: agent.maxOutputTokens,
          temperature: agent.temperature,
          abortSignal: AbortSignal.timeout(30000),
        });
        return { draft: result.output, model: modelId };
      } catch (error) {
        const failure = openRouterFailureFromThrown(error);
        lastFailure = new Error(failure.message);
      }
    }
    throw lastFailure || new Error('OpenRouter could not compile the research brief.');
  }
  async function openRouterRepairRequest(current: State, raw: string, issues: string) {
    const apiKey = config.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('Astra returned malformed JSON and the hosted repair fallback is not configured.');
    const modelId = config.EPISTACK_OPENROUTER_REPAIR_MODEL || defaultOpenRouterRepairModel;
    const agent = resolveAgentPrompt('research-brief-compiler', current.promptOverrides);
    const openRouter = createOpenAI({
      apiKey,
      baseURL: openRouterBaseURL,
      headers: {
        'HTTP-Referer': new URL(request.url).origin,
        'X-OpenRouter-Title': 'Epistack Evidence Lab',
        'X-OpenRouter-Metadata': 'enabled',
      },
    });
    try {
      const result = await generateText({
        model: openRouter(modelId),
        output: Output.object({
          name: 'repaired_research_brief',
          description: 'The same research brief content repaired into valid JSON.',
          schema: researchBriefDraftSchema,
        }),
        system: agent.instructions + repairInstruction(researchBriefDraftSchema, issues),
        prompt: `Repair this malformed research brief response. Preserve its substantive content and return only the complete JSON object.\n\n${raw.slice(0, 40_000)}`,
        maxOutputTokens: agent.maxOutputTokens,
        temperature: 0,
        abortSignal: AbortSignal.timeout(30000),
      });
      return { draft: result.output, model: modelId };
    } catch (error) {
      const failure = openRouterFailureFromThrown(error);
      throw new Error(failure.message);
    }
  }
  function acceptDraft(draft: z.infer<typeof researchBriefDraftSchema>, compiledBy: string) {
    const normalized = normalizeResearchBriefDraft(draft, state.clusters.map((cluster) => cluster.id));
    state.brief = researchBriefSchema.parse({
      ...normalized,
      schemaVersion: '0.2.0',
      briefId: `brief-${state.caseId.slice(0, 60)}-${shortHash(state.caseId + state.compiledQuestion)}`,
      caseId: state.caseId,
      originalQuestion: state.originalQuestion,
      compiledQuestion: state.compiledQuestion,
      decisionContext: state.decisionContext,
      dimensionAssignments: buildDimensionAssignments({ clusters: state.clusters, dimensionRoles: state.dimensionRoles }),
      contextualization: state.contextualization,
      privacy: {
        localContextPolicy: 'The full decision context stays in this device-local brief and is used only to compile the research contract; it is not sent to PubMed.',
        outboundQueryPolicy: "Only each claim's compact searchQuery and publication filters leave the workflow during discovery.",
      },
      generatedAt: new Date().toISOString(),
      compiledBy,
    });
    state.compiledBy = compiledBy;
    state.repairing = false;
    state.repairRaw = undefined;
    state.repairIssues = undefined;
    state.status = 'completed';
  }
  try {
    if (state.status === 'submitting') throw new Error('Submission was interrupted before its receipt was saved. Stopped to avoid consuming another job; owner review is needed.');
    if (!['completed', 'failed'].includes(state.status) && Date.now() >= (state.nextAt || 0)) {
      if (!state.remoteId) {
        state.status = 'submitting';
        await save();
        let created: { id?: string } | null;
        try {
          const payload = state.repairing && state.repairRaw
            ? compilerRepairRequest(state, state.repairRaw, state.repairIssues || 'The previous response was not valid JSON.')
            : compilerRequest(state);
          created = await remote('/v1/responses', payload) as { id?: string } | null;
        } catch (error) {
          if ((error as { code?: string })?.code !== 'backend-unreachable' || !config.OPENROUTER_API_KEY) throw error;
          const fallback = await openRouterCompilerRequest(state);
          acceptDraft(fallback.draft, `OpenRouter · ${fallback.model} (Astra fallback)`);
          created = null;
        }
        if (created) {
          if (!/^job_[a-zA-Z0-9_-]+$/.test(created.id || '')) throw new Error('Backend did not return a durable job receipt.');
          state.remoteId = created.id;
          state.status = 'in_progress';
        }
      } else {
        const result = await remote('/v1/responses/' + state.remoteId) as { status?: string } | null;
        if (result && result.status === 'completed') {
          const resultText = extractText(result);
          try {
            const draft = parseDraftText(resultText);
            acceptDraft(draft, state.compiledBy || 'Astra · GPT 6');
          } catch (error) {
            if (!(error instanceof StructuredOutputError)) throw error;
            if ((state.repairAttempts || 0) >= 1) {
              if (!config.OPENROUTER_API_KEY) throw error;
              try {
                const repaired = await openRouterRepairRequest(state, resultText, error.issues);
                acceptDraft(repaired.draft, `OpenRouter · ${repaired.model} (Astra JSON repair)`);
              } catch {
                const fallback = await openRouterCompilerRequest(state);
                acceptDraft(fallback.draft, `OpenRouter · ${fallback.model} (Astra repair fallback)`);
              }
            } else {
              state.repairAttempts = (state.repairAttempts || 0) + 1;
              state.repairing = true;
              state.repairRaw = resultText;
              state.repairIssues = error.issues;
              state.remoteId = null;
              state.status = 'queued';
            }
          }
        } else if (result && ['failed', 'cancelled', 'incomplete'].includes(result.status || '')) {
          if (!config.OPENROUTER_API_KEY) {
            throw new Error('The backend job failed. Its receipt is retained; no automatic resubmission.');
          }
          const fallback = await openRouterCompilerRequest(state);
          acceptDraft(fallback.draft, `OpenRouter · ${fallback.model} (Astra provider fallback)`);
        } else if (result) {
          state.status = result.status === 'queued' ? 'queued' : 'in_progress';
        }
      }
    }
  } catch (error) {
    state.status = 'failed';
    if ((error as { code?: string })?.code === 'backend-unreachable' && !state.remoteId) {
      state.code = 'backend-unreachable';
      state.error = 'Astra is unreachable.';
    } else {
      state.error = error instanceof Error ? error.message.slice(0, 500) : 'This stage could not complete or validate. The saved run has stopped without retrying the submission.';
    }
  } finally {
    await save();
    await db.prepare('UPDATE hosted_brief_jobs SET locked_until = 0 WHERE id = ?').bind(body.id).run();
  }
  return json({ id: body.id, status: state.status, brief: state.brief ?? null, error: state.error, code: state.code, nextAt: state.nextAt, repairing: Boolean(state.repairing) });
}
