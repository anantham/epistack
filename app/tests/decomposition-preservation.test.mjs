import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleDecomposition, decompositionSchema } from '../lib/decomposition-server.ts';

const prompt = 'Are eggs good to eat? Bad to eat? Great in moderation? How can we tell? Does it vary across people, and what predicts this? What else should we be paying attention to here?';
const quotes = ['eggs', 'good', 'moderation', 'How can we tell?', 'across people', 'predicts this', 'What else'];
const scout = {
  caseTitle: 'Egg question preservation',
  summary: 'Preserve every bounded dimension and its concrete alternatives before human review.',
  dimensions: quotes.map((_, i) => ({ id: `axis-${i}`, label: `Dimension ${i}`, question: 'Which concrete scope matters?',  })),
};
const traces = { traces: scout.dimensions.map((d, i) => ({ dimensionId: d.id, label: d.label, quotes: [quotes[i], 'eat'], latentVariable: 'Decision-relevant scope', rationale: 'The submitted words leave a material choice unresolved.' })) };

test('the fifth scout alternative survives assembly and persistent validation', () => {
  const artifact = assembleDecomposition(scout, traces, null, prompt);
    const parsed = decompositionSchema.safeParse(artifact); if(!parsed.success) console.error(parsed.error); assert.equal(parsed.success, true);
});

test('the highlight budget preserves a trace for every valid dimension', () => {
  const artifact = assembleDecomposition(scout, traces, null, prompt);
  assert.deepEqual(artifact.clusters.map(c => c.id), scout.dimensions.map(d => `${d.id}-cues`));
  assert.ok(artifact.highlights.length <= 8);
  assert.ok(artifact.highlights.every(h => prompt.includes(h.quote)));
  const parsed = decompositionSchema.safeParse(artifact); if(!parsed.success) console.error(parsed.error); assert.equal(parsed.success, true);
});

test('invalid and duplicate traces cannot starve later dimensions', () => {
  const noisy = { traces: [{ ...traces.traces[0], quotes: ['not in the input'] }, traces.traces[1], ...traces.traces] };
  const artifact = assembleDecomposition(scout, noisy, null, prompt);
  assert.equal(new Set(artifact.clusters.map(c => c.id)).size, 7);
  assert.equal(artifact.clusters.length, 7);
  assert.ok(artifact.highlights.every(h => prompt.includes(h.quote)));
});

test('a trace failure preserves the context specialist interview', () => {
  const context = {
    enrichments: scout.dimensions.map((dimension, index) => ({
      dimensionId: dimension.id,
      requiredFields: ['current amount', 'duration'],
      searchConcepts: ['egg intake', 'dose response'],
      mismatchRisks: ['Different doses may not transport.'],
      contextQuestion: {
        id: `context-${index}`,
        label: 'Personal intake',
        question: 'How many eggs do you eat in a normal week?',
        whyItMatters: 'Dose changes which evidence applies.',
        effect: 'match',
        options: ['rarely', 'several per week'],
      },
    })),
    claimTemplate: 'For {{axis-0}}, what does {{axis-1}} change?',
    knownUnknowns: ['The exact dose is unknown.', 'The relevant population is unknown.', 'The comparator is unknown.'],
  };
  const artifact = assembleDecomposition(scout, null, context, prompt);
  assert.equal(decompositionSchema.safeParse(artifact).success, true);
  assert.equal(artifact.clusters[0].contextQuestion.question, 'How many eggs do you eat in a normal week?');
  assert.ok(artifact.clusters.every((cluster) => cluster.ingestionRequirements.requiredFields.includes('current amount')));
});

test('food decisions keep activity and geographic feasibility visible in the interview', () => {
  const coverageScout = {
    ...scout,
    dimensions: [
      { id: 'goals', label: 'Goals, Body Composition, and Activity' },
      { id: 'practical', label: 'Practical Constraints and Access' },
    ],
  };
  const context = {
    enrichments: [
      { dimensionId: 'goals', requiredFields: ['goal'], searchConcepts: ['health'], mismatchRisks: ['Different goals change the decision.'], contextQuestion: { id: 'goals-question', label: 'Body goal', question: 'What are you mainly trying to do with your body right now?', whyItMatters: 'Goals change which outcomes matter.', effect: 'match', options: ['lose fat', 'build muscle'] } },
      { dimensionId: 'practical', requiredFields: ['budget'], searchConcepts: ['food access'], mismatchRisks: ['Availability varies by place.'], contextQuestion: { id: 'practical-question', label: 'Practical constraints', question: 'What matters most when you buy eggs?', whyItMatters: 'Feasibility changes the actionable choice.', effect: 'match', options: ['price', 'availability'] } },
    ],
    claimTemplate: 'For {{goals}}, what does {{practical}} change?',
    knownUnknowns: ['The exact goal is unknown.', 'The practical constraint is unknown.', 'The relevant population is unknown.'],
  };
  const coverageContext = {
    ...context,
    enrichments: [
      { ...context.enrichments[0], dimensionId: 'goals', contextQuestion: { ...context.enrichments[0].contextQuestion, question: 'What are you mainly trying to do with your body right now?' } },
      { ...context.enrichments[1], dimensionId: 'practical', contextQuestion: { ...context.enrichments[1].contextQuestion, question: 'What matters most when you buy eggs?' } },
    ],
  };
  const artifact = assembleDecomposition(coverageScout, null, coverageContext, prompt);
  assert.match(artifact.clusters[0].contextQuestion.question, /active|athletic/i);
  assert.match(artifact.clusters[1].contextQuestion.question, /budget|price/i);
  assert.match(artifact.clusters[1].contextQuestion.question, /live|shop/i);
});
