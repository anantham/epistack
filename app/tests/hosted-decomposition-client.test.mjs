import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runHostedDecomposition } from '../lib/hosted-decomposition-client.ts';
const input = { question: 'Are eggs good to eat?', decisionContext: 'A general evidence map, not a personal diet.', promptOverrides: {}, effort: 'high' };
const artifact = { clusters: [{ id: 'dose' }] };
function harness(replies, entries = new Map()) {
 const calls = []; let now = 0;
 return { calls, entries, deps: { storage: { getItem: k => entries.get(k) || null, setItem: (k,v) => entries.set(k,v), removeItem: k => entries.delete(k) }, now: () => now, sleep: async ms => { now += ms; }, fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); const reply = replies.shift(); if (reply instanceof Error) throw reply; return new Response(JSON.stringify(reply), {status:200}); } } };
}
test('homepage submits context once, polls receipts, and returns the existing UI contract', async()=>{
 const h=harness([{id:'run-1',token:'owned'}, {status:'in_progress',stage:0}, {status:'completed',stage:3,artifact,question:input.question,decisionContext:input.decisionContext,model:'Astra/Lyra · lyra-chatgpt-pro · orchestrated specialists',provenance:{path:'hosted-primary',provider:'Astra/Lyra',model:'lyra-chatgpt-pro',stages:[]}}]);
 const progress=[]; const result=await runHostedDecomposition(input,'identity',false,p=>progress.push(p),h.deps);
 assert.ok(h.calls.every(c=>c.url==='/api/decompose-live'));
 assert.deepEqual(h.calls[0].body,input);
 assert.deepEqual(h.calls[1].body,{id:'run-1',token:'owned'});
 assert.equal(result.decisionContext,input.decisionContext); assert.equal(result.caseId,'run-1'); assert.equal(result.mode,'ai');
 assert.equal(result.model,'Astra/Lyra · lyra-chatgpt-pro · orchestrated specialists'); assert.equal(result.provenance.provider,'Astra/Lyra');
 assert.equal(progress.length,2); assert.ok(!JSON.stringify(h.calls).includes('openRouterApiKey'));
});
test('a connection interruption retains the receipt and resumes without another submission',async()=>{
 const h=harness([{id:'run-2',token:'owned'},new Error('offline')]);
 await assert.rejects(runHostedDecomposition(input,'resume',false,()=>{},h.deps),/offline/);
 const resumed=harness([{status:'completed',stage:3,artifact}],h.entries);
 await runHostedDecomposition(input,'resume',false,()=>{},resumed.deps);
 assert.deepEqual(resumed.calls[0].body,{id:'run-2',token:'owned'});
 assert.equal(resumed.calls.length,1);
});
test('terminal failures remain terminal until an explicit fresh run',async()=>{
 const h=harness([{id:'run-3',token:'owned'},{status:'failed',stage:1,error:'Stopped safely'}]);
 await assert.rejects(runHostedDecomposition(input,'failed',false,()=>{},h.deps),/Stopped safely/);
 const retry=harness([{status:'failed',stage:1,error:'Stopped safely'}],h.entries);
 await assert.rejects(runHostedDecomposition(input,'failed',false,()=>{},retry.deps),/Stopped safely/);
 assert.deepEqual(retry.calls[0].body,{id:'run-3',token:'owned'});
});
test('the default browser transport binds fetch so it stays attached to window',async()=>{
 const source=await readFile(new URL('../lib/hosted-decomposition-client.ts',import.meta.url),'utf8');
 assert.match(source,/globalThis\.fetch\.bind\(globalThis\)/);
 assert.doesNotMatch(source,/deps = dependencies \|\| \{ fetch,/);
});
test('an unconfigured Lyra backend falls back to the server-side OpenRouter specialists',async()=>{
 const calls=[];
 const payload={caseId:'or-1',mode:'ai',model:'OpenRouter · anthropic/claude-opus-4.8 · orchestrated specialists',warning:null,prompt:input.question,decisionContext:input.decisionContext,decomposition:artifact,cache:{status:'miss',layer:'d1',createdAt:null,expiresAt:null}};
 const deps={storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},now:()=>0,sleep:async()=>{},fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return url==='/api/decompose-live'?new Response(JSON.stringify({error:'Hosted decomposition is not configured yet.',code:'hosted-not-configured'}),{status:503}):new Response(JSON.stringify(payload),{status:200});}};
 const progress=[];
 const result=await runHostedDecomposition(input,'fallback',false,p=>progress.push(p),deps);
 assert.equal(calls[0].url,'/api/decompose-live');
 assert.equal(calls[1].url,'/api/decompose');
 assert.equal(calls[1].body.prompt,input.question);
 assert.equal(calls[1].body.effort,input.effort);
 assert.equal(calls[1].body.openRouterApiKey,undefined);
 assert.deepEqual(result,payload);
 assert.equal(progress.at(-1).stage,2);
});
test('the fallback never sends a browser-supplied key and explains a missing server key',async()=>{
 const deps={storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},now:()=>0,sleep:async()=>{},fetch:async(url)=>url==='/api/decompose-live'?new Response(JSON.stringify({code:'hosted-not-configured'}),{status:503}):new Response(JSON.stringify({error:'No reusable decomposition is cached for this question and model. Add an OpenRouter key in Settings to create one.'}),{status:401})};
 await assert.rejects(runHostedDecomposition(input,'no-key',false,()=>{},deps),/no decomposition backend configured/);
});
test('only the not-configured signal falls back; other hosted failures surface',async()=>{
 const deps={storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},now:()=>0,sleep:async()=>{},fetch:async()=>new Response(JSON.stringify({error:'The backend job failed. Its receipt is retained.'}),{status:500})};
 await assert.rejects(runHostedDecomposition(input,'no-fallback',true,()=>{},deps),/backend job failed/);
});
test('queued stages advance immediately instead of waiting a fixed interval',async()=>{
 const sleeps=[]; let now=0;
 const replies=[{id:'run-q',token:'owned'},{status:'queued',stage:1,nextAt:0},{status:'queued',stage:2,nextAt:0},{status:'completed',stage:3,artifact}];
 const deps={storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},now:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;},fetch:async()=>new Response(JSON.stringify(replies.shift()),{status:200})};
 await runHostedDecomposition(input,'queued',false,()=>{},deps);
 assert.deepEqual(sleeps,[250,250]);
});
test('a retry-after window reported by the server is honored before advancing',async()=>{
 const sleeps=[]; let now=100000;
 const replies=[{id:'run-r',token:'owned'},{status:'queued',stage:1,nextAt:now+5000},{status:'completed',stage:3,artifact}];
 const deps={storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},now:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;},fetch:async()=>new Response(JSON.stringify(replies.shift()),{status:200})};
 await runHostedDecomposition(input,'retry',false,()=>{},deps);
 assert.deepEqual(sleeps,[5250]);
});
test('the hosted route relies on retry-after rather than a hardcoded cooldown',async()=>{
 const source=await readFile(new URL('../app/api/decompose-live/route.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/61000/);
 assert.match(source,/retry-after/);
});

test('the hosted client uses returned provider provenance instead of a hard-coded model label',async()=>{
 const h=harness([{id:'run-provenance',token:'owned'},{status:'completed',stage:3,artifact,model:'Astra/Lyra · reported-model · orchestrated specialists',provenance:{path:'hosted-primary',provider:'Astra/Lyra',model:'reported-model',stages:[]}}]);
 const result=await runHostedDecomposition(input,'provenance',false,()=>{},h.deps);
 assert.equal(result.model,'Astra/Lyra · reported-model · orchestrated specialists');
 assert.equal(result.provenance.model,'reported-model');
 const source=await readFile(new URL('../lib/hosted-decomposition-client.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/Astra · GPT 6/);
});
