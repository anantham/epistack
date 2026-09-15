import { sanitizeAgentPromptOverrides, type AgentPromptOverrides } from '../../../lib/agent-prompts';
import { env } from 'cloudflare:workers';
import { getD1, ensureHostedJobTables } from '../../../db';
import { stageRequest, parseStage, finishDecomposition, stageNames, normalizeEffort } from '../../../lib/hosted-decomposition';
import { StructuredOutputError } from '../../../lib/structured-output';
import { recordDecompositionRun } from '../../../lib/decomposition-runs';
import type { DecompositionProvenance } from '../../../lib/decomposition';

type State = { question: string; decisionContext?: string; promptOverrides?: AgentPromptOverrides; effort?: string; stage: number; results: unknown[]; status: string; remoteId?: string; nextAt?: number; error?: string; code?: string; artifact?: unknown; stageStartedAt?: number; stageDurationsMs?: number[]; attempts?: number[]; rateLimits?: number; repairs?: number[]; repairIssues?: string; parseFailure?: { stage: number; raw: string; issues: string }; origin?: string; recorded?: boolean; stageModels?: string[]; stageModelSources?: Array<'reported' | 'requested'> };
const DAILY_PREVIEW_LIMIT = 50;
const HOSTED_STAGE_TIMEOUT_MS = 90_000;
const requestedHostedModel = 'lyra-chatgpt-pro';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

function noteRemoteModel(state: State, payload: unknown) {
  const reported = typeof payload === 'object' && payload !== null && typeof (payload as { model?: unknown }).model === 'string'
    ? (payload as { model: string }).model.trim()
    : '';
  state.stageModels = state.stageModels || [];
  state.stageModelSources = state.stageModelSources || [];
  state.stageModels[state.stage] = reported || state.stageModels[state.stage] || requestedHostedModel;
  state.stageModelSources[state.stage] = reported ? 'reported' : state.stageModelSources[state.stage] || 'requested';
}

function hostedProvenance(state: State): DecompositionProvenance {
  const stages = stageNames.map((stage, index) => {
    const model = state.stageModels?.[index] || requestedHostedModel;
    const source = state.stageModelSources?.[index] || 'requested';
    return {
      stage,
      provider: 'Astra/Lyra',
      model,
      status: 'used' as const,
      ...(source === 'requested' ? { reason: 'The gateway did not report a concrete model; this is the model requested by the app.' } : {}),
    };
  });
  const distinctModels = Array.from(new Set(stages.map((stage) => stage.model)));
  return {
    path: 'hosted-primary',
    provider: 'Astra/Lyra',
    model: distinctModels.length === 1 ? distinctModels[0] : 'stage-reported models',
    stages,
  };
}
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Use this site to submit a question.' }, 403);
  const config = env as unknown as { LYRA_PUBLIC_GATEWAY_URL?: string; LYRA_API_KEY?: string };
  if (!config.LYRA_PUBLIC_GATEWAY_URL || !config.LYRA_API_KEY) return json({ error: 'Hosted decomposition is not configured yet.', code: 'hosted-not-configured' }, 503);
  let body;
  try { const raw = await request.text(); if (raw.length > 140000) return json({ error: 'Request too large.' }, 413); body = JSON.parse(raw) as { question?: string; decisionContext?: string; promptOverrides?: unknown; id?: string; token?: string; effort?: unknown }; if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400); }
  catch { return json({ error: 'Invalid request.' }, 400); }
  await ensureHostedJobTables();
  const db = getD1();
  if (!body.id) {
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (question.length < 12 || question.length > 5000) return json({ error: 'Enter a question between 12 and 5,000 characters.' }, 400);
    const decisionContext = typeof body.decisionContext === 'string' ? body.decisionContext.trim() : '';
    if (decisionContext.length > 4000) return json({ error: 'Keep context under 4,000 characters.' }, 400);
    const promptOverrides = sanitizeAgentPromptOverrides(body.promptOverrides);
    const effort = normalizeEffort(body.effort);
    const id = crypto.randomUUID(), token = crypto.randomUUID();
    const state: State = { question, decisionContext, promptOverrides, effort, stage: 0, results: [], status: 'queued', origin: new URL(request.url).origin };
    const row = await db.prepare('INSERT INTO hosted_decomposition_jobs (id, token, state_json, created_at) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM hosted_decomposition_jobs WHERE created_at > ?) < ? RETURNING id').bind(id, token, JSON.stringify(state), Date.now(), Date.now() - 86400000, DAILY_PREVIEW_LIMIT).first();
    if (!row) return json({ error: `This preview has reached its limit of ${DAILY_PREVIEW_LIMIT} investigations per day. Existing runs can still finish.` }, 429);
    return json({ id, token, status: 'queued', stage: 0, stages: stageNames }, 202);
  }
  if (typeof body.id !== 'string' || typeof body.token !== 'string') return json({ error: 'Job credentials required.' }, 400);
  const row = await db.prepare('UPDATE hosted_decomposition_jobs SET locked_until = ? WHERE id = ? AND token = ? AND locked_until < ? RETURNING state_json').bind(Date.now() + 60000, body.id, body.token, Date.now()).first<{ state_json: string }>();
  if (!row) {
    const owned = await db.prepare('SELECT id FROM hosted_decomposition_jobs WHERE id = ? AND token = ?').bind(body.id, body.token).first();
    return owned ? json({ status: 'busy' }, 202) : json({ error: 'Run unavailable in this browser.' }, 404);
  }
  const state = JSON.parse(row.state_json) as State;
  const save = () => db.prepare('UPDATE hosted_decomposition_jobs SET state_json = ? WHERE id = ?').bind(JSON.stringify(state), body.id).run();
  async function remote(path: string, payload?: unknown) {
    let response: Response;
    try {
      response = await fetch(config.LYRA_PUBLIC_GATEWAY_URL!.replace(/\/$/, '') + path, { method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${config.LYRA_API_KEY}`, 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(25000) });
    } catch {
      // A thrown fetch (network error / timeout) means the Astra gateway is
      // unreachable — distinct from an HTTP error response.
      const failure = new Error('The Astra backend is unreachable.') as Error & { code?: string };
      failure.code = 'backend-unreachable';
      throw failure;
    }
    if ((response.status === 429 || response.status === 503) && payload) {
      const delay = Number(response.headers.get('retry-after'));
      state.nextAt = Date.now() + (Number.isFinite(delay) && delay > 0 ? Math.min(delay, 86400) : 60) * 1000;
      state.rateLimits = (state.rateLimits || 0) + 1;
      state.status = 'queued'; return null;
    }
    if (!response.ok) {
      const error = new Error(response.status >= 500
        ? `The Astra backend returned HTTP ${response.status}.`
        : `Backend returned HTTP ${response.status}. The saved run has stopped; it will not resubmit automatically.`) as Error & { code?: string };
      // Cloudflare edge / origin errors (522, 524, 525) and other 5xx mean the
      // gateway is effectively unreachable; allow the pre-acceptance fallback.
      if (response.status >= 500) error.code = 'backend-unreachable';
      throw error;
    }
    return response.json();
  }
  try {
    if (state.status === 'in_progress' && state.remoteId && state.stageStartedAt && Date.now() - state.stageStartedAt >= HOSTED_STAGE_TIMEOUT_MS) {
      const timeout = new Error('The Astra stage exceeded its hosted time budget.') as Error & { code?: string };
      timeout.code = 'backend-timeout';
      throw timeout;
    }
    if (state.status === 'submitting') throw new Error('Submission was interrupted before its receipt was saved. Stopped to avoid consuming another job; owner review is needed.');
    if (!['completed', 'failed'].includes(state.status) && Date.now() >= (state.nextAt || 0)) {
      if (!state.remoteId) {
        state.status = 'submitting';
        state.attempts = state.attempts || [];
        state.attempts[state.stage] = (state.attempts[state.stage] || 0) + 1;
        state.stageStartedAt = Date.now();
        await save();
        const created = await remote('/v1/responses', stageRequest(state.stage, state.question, state.results, state.decisionContext, state.promptOverrides, state.effort, state.repairIssues));
        if (created) {
          noteRemoteModel(state, created);
          if (!/^job_[a-zA-Z0-9_-]+$/.test(created.id || '')) throw new Error('Backend did not return a durable job receipt.');
          state.remoteId = created.id; state.status = 'in_progress'; state.repairIssues = undefined;
        }
      } else {
        const result = await remote('/v1/responses/' + state.remoteId);
        noteRemoteModel(state, result);
        if (result.status === 'completed') {
          state.stageDurationsMs = state.stageDurationsMs || [];
          state.stageDurationsMs[state.stage] = Math.max(0, Date.now() - (state.stageStartedAt || Date.now()));
          state.repairs = state.repairs || [];
          let parsed: unknown;
          try {
            parsed = parseStage(state.stage, result);
          } catch (error) {
            if (error instanceof StructuredOutputError && (state.repairs[state.stage] || 0) < 1) {
              state.repairs[state.stage] = (state.repairs[state.stage] || 0) + 1;
              state.repairIssues = error.issues;
              delete state.remoteId;
              state.status = 'queued';
              state.nextAt = 0;
            } else {
              throw error;
            }
          }
          if (parsed !== undefined) {
            state.results.push(parsed);
            state.stage++;
            delete state.remoteId;
            state.repairIssues = undefined;
            if (state.stage === 3) { state.artifact = finishDecomposition(state.question, state.results, state.decisionContext); state.status = 'completed'; }
            else { state.status = 'queued'; state.nextAt = 0; }
          }
        } else if (['failed', 'cancelled', 'incomplete'].includes(result.status)) {
          const failure = new Error('The Astra job failed before a validated decomposition was produced.') as Error & { code?: string };
          // A failed remote receipt contains no accepted artifact. Let the
          // browser continue through the server-side OpenRouter pipeline
          // instead of trapping the user behind a terminal Astra error.
          failure.code = 'backend-unreachable';
          throw failure;
        }
        else state.status = result.status === 'queued' ? 'queued' : 'in_progress';
      }
    }
  } catch (error) {
    state.status = 'failed';
    const failureCode = (error as { code?: string })?.code;
    if ((failureCode === 'backend-unreachable' || failureCode === 'backend-timeout') && !state.artifact) {
      // No validated artifact has been accepted, so it is safe to let the
      // client continue through the alternate provider even when Astra had
      // already issued a receipt that later failed.
      state.code = failureCode;
      state.error = failureCode === 'backend-timeout'
        ? 'Astra did not complete this stage within its time budget; falling back to the alternate provider.'
        : 'Astra could not complete this run; falling back to the alternate provider.';
    } else if (error instanceof StructuredOutputError) {
      state.parseFailure = { stage: state.stage, raw: error.raw.slice(0, 4000), issues: error.issues.slice(0, 2000) };
      state.error = `${stageNames[state.stage]} output did not match its schema after a repair attempt.`;
    } else {
      state.error = error instanceof Error && error.message.startsWith('Backend returned') ? error.message : 'This stage could not complete or validate. The saved run has stopped without retrying the submission.';
    }
  } finally {
    if (!state.recorded && (state.status === 'completed' || state.status === 'failed')) {
      state.recorded = true;
      await recordDecompositionRun(db, {
        jobId: body.id,
        outcome: state.status,
        stage: state.stage,
        stageMs: state.stageDurationsMs ?? [],
        attempts: state.attempts ?? [],
        rateLimits: state.rateLimits ?? 0,
        effort: state.effort,
      });
    }
    await save();
    await db.prepare('UPDATE hosted_decomposition_jobs SET locked_until = 0 WHERE id = ?').bind(body.id).run();
  }
  return json({ id: body.id, status: state.status, stage: state.stage, stages: stageNames, question: state.question, decisionContext: state.decisionContext || '', error: state.error, code: state.code, parseFailure: state.parseFailure, artifact: state.artifact, results: state.results, nextAt: state.nextAt, attempts: state.attempts, durationsMs: state.stageDurationsMs, rateLimits: state.rateLimits, ...(state.status === 'completed' ? { model: `Astra/Lyra · ${hostedProvenance(state).model} · orchestrated specialists`, provenance: hostedProvenance(state) } : {}) });
}
