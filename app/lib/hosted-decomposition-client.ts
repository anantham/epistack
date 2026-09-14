import type { DecompositionResponse, DecompositionArtifact } from './decomposition';
import type { AgentPromptOverrides } from './agent-prompts';
export type HostedInput = { question: string; decisionContext: string; promptOverrides: AgentPromptOverrides; effort?: string };
export type HostedProgress = { stage: number; status: string; attempts?: number[]; durationsMs?: number[]; rateLimits?: number };
type Receipt = { id: string; token: string };
type CodedError = Error & { code?: string };
type Dependencies = { fetch: typeof fetch; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; sleep: (ms: number) => Promise<void>; now: () => number };
export async function runHostedDecomposition(input: HostedInput, identity: string, refresh: boolean, onProgress: (p: HostedProgress) => void, dependencies?: Dependencies): Promise<DecompositionResponse> {
  const deps = dependencies || { fetch: globalThis.fetch.bind(globalThis), storage: window.localStorage, sleep: (ms: number) => new Promise<void>(r => setTimeout(r, ms)), now: Date.now };
  const storageKey = `epistack:homepage-lyra-job:v1:${identity}`;
  let receipt: Receipt | null = null;
  if (!refresh) {
    try { const saved = JSON.parse(deps.storage.getItem(storageKey) || 'null'); if (typeof saved?.id === 'string' && typeof saved?.token === 'string') receipt = saved; } catch {}
  }
  async function request(body: unknown) {
    const response = await deps.fetch('/api/decompose-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data;
    try { data = await response.json(); } catch { throw new Error('The hosted service returned an unreadable response. Submit again to resume your saved run.'); }
    if (!response.ok) {
      const error = new Error(data.error || `Hosted decomposition returned HTTP ${response.status}.`) as CodedError;
      if (typeof data.code === 'string') error.code = data.code;
      throw error;
    }
    return data;
  }
  if (!receipt) {
    let created;
    try {
      created = await request(input);
    } catch (error) {
      // Local/self-hosted runs without Lyra configured still work through the
      // legacy OpenRouter specialists. The browser or server must hold a key.
      if ((error as CodedError)?.code === 'hosted-not-configured') {
        return runOpenRouterFallback(deps, input, refresh, onProgress);
      }
      throw error;
    }
    if (!created.id || !created.token) throw new Error('The hosted service did not return a saved-run receipt.');
    receipt = { id: created.id, token: created.token };
    // Refuse to submit model work if its recovery receipt cannot be retained.
    deps.storage.setItem(storageKey, JSON.stringify(receipt));
  }
  const deadline = deps.now() + 30 * 60 * 1000;
  while (deps.now() < deadline) {
    const result = await request(receipt);
    if (result.status !== 'busy') onProgress({ stage: result.stage, status: result.status, attempts: result.attempts, durationsMs: result.durationsMs, rateLimits: result.rateLimits });
    if (result.status === 'failed') {
      if (result.code === 'backend-unreachable') {
        // Astra is unreachable and no durable Lyra job was accepted, so it is
        // safe to use the alternate provider. Drop the dead receipt.
        deps.storage.removeItem(storageKey);
        return runOpenRouterFallback(deps, input, refresh, onProgress);
      }
      // Keep the terminal receipt: ordinary retries must not silently consume a new job.
      throw new Error(result.error || 'The saved decomposition failed. Start a fresh run explicitly to retry.');
    }
    if (result.status === 'completed') {
      if (!result.artifact?.clusters?.length) throw new Error('The saved run has no validated decomposition.');
      return {
        caseId: receipt.id,
        mode: 'ai',
        model: result.model || 'Astra/Lyra · requested model not reported · orchestrated specialists',
        provenance: result.provenance,
        warning: null,
        prompt: result.question || input.question, decisionContext: result.decisionContext ?? input.decisionContext,
        decomposition: result.artifact as DecompositionArtifact,
        cache: { status: refresh ? 'bypass' : 'miss', layer: 'd1', createdAt: null, expiresAt: null },
      };
    }
    // 'queued' means the server is ready to make progress: submit the next stage
    // now, or wait until the retry-after instant it reported. Only an in-flight
    // remote job justifies a fixed polling interval.
    if (result.status === 'queued') {
      const waitUntil = typeof result.nextAt === 'number' ? result.nextAt - deps.now() : 0;
      await deps.sleep(Math.min(Math.max(waitUntil, 0) + 250, 60000));
    } else {
      await deps.sleep(15000);
    }
  }
  throw new Error('This run is taking longer than expected. Its receipt is saved; submit the same question again to resume.');
}
async function runOpenRouterFallback(deps: Dependencies, input: HostedInput, refresh: boolean, onProgress: (p: HostedProgress) => void): Promise<DecompositionResponse> {
  onProgress({ stage: 0, status: 'connecting' });
  const response = await deps.fetch('/api/decompose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: input.question,
      decisionContext: input.decisionContext,
      promptOverrides: input.promptOverrides,
      effort: input.effort,
      refresh,
    }),
  });
  if (response.status === 401) {
    throw new Error('This environment has no decomposition backend configured. Set LYRA_PUBLIC_GATEWAY_URL and LYRA_API_KEY, or OPENROUTER_API_KEY, in the server environment.');
  }
  let payload: DecompositionResponse & { error?: string };
  try {
    payload = await response.json();
  } catch {
    throw new Error('The decomposition service returned an unreadable response. Submit again to retry.');
  }
  if (!response.ok) throw new Error(payload.error || `Decomposition returned HTTP ${response.status}.`);
  onProgress({ stage: 2, status: 'completed' });
  return payload;
}
