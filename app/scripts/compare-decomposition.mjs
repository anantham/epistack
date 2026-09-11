// Run the existing three decomposition contracts through Lyra's durable API.
// Credentials are read only from the owner's scoped public client configuration.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolveAgentPrompt, renderAgentPrompt } from '../lib/agent-prompts.ts';
import { dimensionScoutSchema, traceAgentSchema, contextAgentSchema, normalizeDimensionScout, assembleDecomposition, decompositionSchema } from '../lib/decomposition-server.ts';

const dir = resolve(process.argv[2] || '../runs/eggs-2026-09-10/decomposition-comparison');
await mkdir(dir, { recursive: true });
const question = JSON.parse(await readFile(resolve(dir, '../question.json'), 'utf8')).prompt;
const config = Object.fromEntries((await readFile(resolve(homedir(), '.config/lyra/public-gateway.env'), 'utf8')).split('\n').filter(s => s.includes('=') && !s.startsWith('#')).map(s => {
  const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
}));
const base = config.LYRA_PUBLIC_GATEWAY_URL?.replace(/\/$/, '');
const key = config.LYRA_API_KEY;
if (!base || !key) throw new Error('Scoped Lyra public client configuration missing.');
const save = (name, data) => writeFile(resolve(dir, name + '.json'), JSON.stringify(data, null, 2) + '\n');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function call(path, body) {
  let response;
  try {
    response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  } catch { throw new Error('Lyra transport failed; no automatic resubmission. Retain saved job IDs.'); }
  if (!response.ok) throw new Error(`Lyra HTTP ${response.status}; Retry-After=${response.headers.get('retry-after') || 'absent'}. No automatic resubmission.`);
  try { return await response.json(); } catch { throw new Error('Lyra returned non-JSON content.'); }
}
async function stage(id, schema, dimensions) {
  const agent = resolveAgentPrompt(id, {});
  const input = renderAgentPrompt(agent.taskTemplate, { question, decisionContext: 'None supplied. Do not invent personal facts. Stop before conducting the context interview.', dimensionsJson: JSON.stringify(dimensions || []) });
  const packet = { model: 'lyra-chatgpt-pro', background: true, reasoning: { effort: 'instant' }, instructions: agent.instructions + '\nReturn only one JSON object matching this schema; no markdown fences. Do not browse or answer the health question.\n' + JSON.stringify(z.toJSONSchema(schema)), input, metadata: { client_job: `epistack-decompose-${id}` } };
  const hash = createHash('sha256').update(JSON.stringify(packet)).digest('hex');
  await save(id + '-request', packet);
  let record;
  try { record = JSON.parse(await readFile(resolve(dir, id + '-job.json'), 'utf8')); } catch {}
  if (record && record.requestHash !== hash) throw new Error('Saved job belongs to a different request. Use a new run directory.');
  if (!record) {
    const created = await call('/v1/responses', packet);
    if (!/^job_[a-zA-Z0-9_-]+$/.test(created.id || '')) throw new Error('Missing or invalid durable response ID.');
    record = { id: created.id, requestHash: hash, submittedAt: new Date().toISOString() };
    await save(id + '-job', record);
    console.log(id + ': submitted ' + record.id);
  }
  const deadline = Date.now() + 20 * 60 * 1000;
  let lastStatus;
  while (Date.now() < deadline) {
    const result = await call('/v1/responses/' + record.id);
    if (result.status !== lastStatus) console.log(id + ': ' + result.status);
    lastStatus = result.status;
    if (result.status === 'completed') {
      const output = (result.output || []).flatMap(o => o.content || []).filter(c => typeof c.text === 'string').map(c => c.text).join('\n');
      await writeFile(resolve(dir, id + '-raw.txt'), output);
      const parsed = schema.parse(JSON.parse(output.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')));
      await save(id + '-result', parsed);
      await save(id + '-receipt', { ...record, completedAt: new Date().toISOString(), status: result.status, controls: result.lyra?.selected_controls ?? null });
      // The same scoped key has a 60-second submission cooldown.
      const remaining = Date.parse(record.submittedAt) + 61000 - Date.now();
      if (remaining > 0) await pause(remaining);
      return parsed;
    }
    if (['failed', 'cancelled', 'incomplete'].includes(result.status)) {
      await save(id + '-failure', { id: record.id, status: result.status, error: result.error });
      throw new Error(id + ': terminal ' + result.status + '; see saved failure.');
    }
    await pause(15000);
  }
  throw new Error('Polling deadline reached; resume this script with the same directory and job IDs.');
}
try {
  const scout = normalizeDimensionScout(await stage('dimension-scout', dimensionScoutSchema));
  const dimensions = scout.dimensions.slice(0, 7);
  const traces = await stage('trace-specialist', traceAgentSchema, dimensions);
  const context = await stage('context-retrieval', contextAgentSchema, dimensions);
  const artifact = decompositionSchema.parse(assembleDecomposition(scout, traces, context, question, ''));
  await save('lyra-decomposition', { provider: 'Lyra scoped public Responses', question, decisionContext: '', status: 'proposal-awaiting-human-review', decomposition: artifact });
  await save('run-status', { status: 'completed', completedAt: new Date().toISOString(), stages: ['dimension-scout', 'trace-specialist', 'context-retrieval'], contextualizationConducted: false, researchStarted: false });
  console.log('Completed and schema-validated all three decomposition contracts.');
} catch (error) {
  await save('run-status', { status: 'blocked', message: error.message, recordedAt: new Date().toISOString() });
  console.error(error.message);
  process.exitCode = 1;
}
