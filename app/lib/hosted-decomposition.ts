import { z } from 'zod';
import { resolveAgentPrompt, renderAgentPrompt, type AgentPromptOverrides } from './agent-prompts.ts';
import { dimensionScoutSchema, traceAgentSchema, contextAgentSchema, normalizeDimensionScout, assembleDecomposition, decompositionSchema } from './decomposition-server.ts';
export const stageNames = ['dimension-scout', 'trace-specialist', 'context-retrieval'] as const;
export const stageSchemas = [dimensionScoutSchema, traceAgentSchema, contextAgentSchema] as const;
export function stageRequest(stage: number, question: string, results: unknown[], decisionContext = "", promptOverrides: AgentPromptOverrides = {}) {
  const agent = resolveAgentPrompt(stageNames[stage], promptOverrides);
  const dimensions = stage > 0 ? normalizeDimensionScout(dimensionScoutSchema.parse(results[0])).dimensions : [];
  return {
    model: 'lyra-chatgpt-pro', background: true, reasoning: { effort: 'instant' },
    instructions: agent.instructions + '\nReturn only one JSON object matching this schema. No markdown fences. Do not browse or answer the substantive question.\n' + JSON.stringify(z.toJSONSchema(stageSchemas[stage])),
    input: renderAgentPrompt(agent.taskTemplate, { question, decisionContext: decisionContext || 'None supplied. Do not invent personal facts. Stop before conducting the context interview.', dimensionsJson: JSON.stringify(dimensions) }),
    metadata: { client_job: `epistack-hosted-${stageNames[stage]}` },
  };
}
export function parseStage(stage: number, response: { output?: Array<{ content?: Array<{ text?: string }> }> }) {
  const text = (response.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('\n');
  return stageSchemas[stage].parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')));
}
export function finishDecomposition(question: string, results: unknown[], decisionContext = "") {
  return decompositionSchema.parse(assembleDecomposition(dimensionScoutSchema.parse(results[0]), traceAgentSchema.parse(results[1]), contextAgentSchema.parse(results[2]), question, decisionContext));
}
