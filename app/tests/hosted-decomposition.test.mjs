import test from 'node:test';
import assert from 'node:assert/strict';
import { stageRequest, parseStage } from '../lib/hosted-decomposition.ts';
const scout = { caseTitle: 'Eggs and their alternatives', summary: 'Identify material choices before reviewing evidence.', dimensions: [0,1,2].map(i => ({id:`axis-${i}`,label:`Axis ${i}`,question:'Which scope matters?',resolutions:['scope one','scope two']})) };
test('hosted transport preserves fixed dimensions between independent stages',()=>{
 const first=stageRequest(0,'Are eggs good to eat?',[]);
 assert.equal(first.model,'lyra-chatgpt-pro'); assert.equal(first.background,true);
 assert.equal(first.max_output_tokens,undefined); assert.equal(first.tools,undefined);
 const next=stageRequest(1,'Are eggs good to eat?',[scout]);
 assert.ok(next.input.includes('axis-2')); assert.ok(next.instructions.includes('TRACE SPECIALIST'));
 const last=stageRequest(2,'Are eggs good to eat?',[scout]); assert.ok(last.instructions.includes('CONTEXT AND RETRIEVAL'));
});
test('provider text is schema-validated, never accepted as an arbitrary artifact',()=>{
 const result={output:[{content:[{text:'```json\n'+JSON.stringify(scout)+'\n```'}]}]};
 assert.deepEqual(parseStage(0,result),scout);
 assert.throws(()=>parseStage(0,{output:[{content:[{text:'{"answer":"Eggs are good"}'}]}]}));
 assert.throws(()=>parseStage(0,{output:[]}));
});
test('context and edited specialist prompts reach Lyra instead of being silently discarded',()=>{
 const request=stageRequest(0,'Are eggs good to eat?',[],'Only a general evidence map; no personal profile.');
 assert.ok(request.input.includes('Only a general evidence map; no personal profile.'));
});
