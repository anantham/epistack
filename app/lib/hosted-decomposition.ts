import { z } from 'zod';
import { resolveAgentPrompt, renderAgentPrompt, type AgentPromptOverrides } from './agent-prompts.ts';
import { dimensionScoutSchema, traceAgentSchema, contextAgentSchema, normalizeDimensionScout, assembleDecomposition, decompositionSchema } from './decomposition-server.ts';
import { parseStructured, repairInstruction } from './structured-output.ts';
export const stageNames = ['dimension-scout', 'trace-specialist', 'context-retrieval'] as const;
export const stageSchemas = [dimensionScoutSchema, traceAgentSchema, contextAgentSchema] as const;
export const canonicalEfforts = ['instant', 'medium', 'high', 'xhigh', 'pro'] as const;
export type CanonicalEffort = (typeof canonicalEfforts)[number];
const effortAliases: Record<string, CanonicalEffort> = { low: 'instant', max: 'pro' };
export function normalizeEffort(value: unknown): CanonicalEffort {
  if (typeof value !== 'string') return 'instant';
  const trimmed = value.trim().toLowerCase();
  const alias = effortAliases[trimmed];
  if (alias) return alias;
  return (canonicalEfforts as readonly string[]).includes(trimmed) ? (trimmed as CanonicalEffort) : 'instant';
}
export function stageRequest(stage: number, question: string, results: unknown[], decisionContext = "", promptOverrides: AgentPromptOverrides = {}, effort?: string, repairIssues?: string) {
  const agent = resolveAgentPrompt(stageNames[stage], promptOverrides);
  const dimensions = stage > 0 ? normalizeDimensionScout(dimensionScoutSchema.parse(results[0])).dimensions : [];
  const schema = z.toJSONSchema(stageSchemas[stage]);
  return {
    model: 'lyra-chatgpt-pro', background: true, reasoning: { effort: normalizeEffort(effort) },
    instructions: repairIssues
      ? agent.instructions + repairInstruction(stageSchemas[stage], repairIssues)
      : agent.instructions + '\nReturn only one JSON object matching this schema. No markdown fences. Do not browse or answer the substantive question.\n' + JSON.stringify(schema),
    input: renderAgentPrompt(agent.taskTemplate, { question, decisionContext: decisionContext || 'None supplied. Do not invent personal facts. Stop before conducting the context interview.', dimensionsJson: JSON.stringify(dimensions) }),
    metadata: { client_job: `epistack-hosted-${stageNames[stage]}` },
  };
}
export function parseStage(stage: number, response: { output?: Array<{ content?: Array<{ text?: string }> }> }) {
  const text = (response.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('\n');
  return parseStructured(text, stageSchemas[stage] as z.ZodType<unknown>);
}
export function finishDecomposition(question: string, results: unknown[], decisionContext = "") {
  return decompositionSchema.parse(assembleDecomposition(dimensionScoutSchema.parse(results[0]), traceAgentSchema.parse(results[1]), contextAgentSchema.parse(results[2]), question, decisionContext));
}
