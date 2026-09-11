import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleDecomposition, decompositionSchema } from '../lib/decomposition-server.ts';

const prompt = 'Are eggs good to eat? Bad to eat? Great in moderation? How can we tell? Does it vary across people, and what predicts this? What else should we be paying attention to here?';
const quotes = ['eggs', 'good', 'moderation', 'How can we tell?', 'across people', 'predicts this', 'What else'];
const scout = {
  caseTitle: 'Egg question preservation',
  summary: 'Preserve every bounded dimension and its concrete alternatives before human review.',
  dimensions: quotes.map((_, i) => ({ id: `axis-${i}`, label: `Dimension ${i}`, question: 'Which concrete scope matters?', resolutions: ['less than 1 egg per week', '2–4 eggs per week', 'about 1 egg per day', '2 eggs per day', '3+ eggs per day'] })),
};
const traces = { traces: scout.dimensions.map((d, i) => ({ axisId: d.id, label: d.label, quotes: [quotes[i], 'eat'], latentVariable: 'Decision-relevant scope', rationale: 'The submitted words leave a material choice unresolved.' })) };

test('the fifth scout alternative survives assembly and persistent validation', () => {
  const artifact = assembleDecomposition(scout, traces, null, prompt);
  for (const axis of artifact.axes) assert.deepEqual(axis.branches.map(b => b.value), scout.dimensions[0].resolutions);
  assert.equal(decompositionSchema.safeParse(artifact).success, true);
});

test('the highlight budget preserves a trace for every valid dimension', () => {
  const artifact = assembleDecomposition(scout, traces, null, prompt);
  assert.deepEqual(artifact.clusters.map(c => c.axisId), scout.dimensions.map(d => d.id));
  assert.ok(artifact.highlights.length <= 8);
  assert.ok(artifact.highlights.every(h => prompt.includes(h.quote)));
  assert.equal(decompositionSchema.safeParse(artifact).success, true);
});

test('invalid and duplicate traces cannot starve later dimensions', () => {
  const noisy = { traces: [{ ...traces.traces[0], quotes: ['not in the input'] }, traces.traces[1], ...traces.traces] };
  const artifact = assembleDecomposition(scout, noisy, null, prompt);
  assert.equal(new Set(artifact.clusters.map(c => c.axisId)).size, 7);
  assert.equal(artifact.clusters.length, 7);
  assert.ok(artifact.highlights.every(h => prompt.includes(h.quote)));
});
