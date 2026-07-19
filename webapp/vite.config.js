import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'

function runClaude(prompt, tools) {
  return new Promise((resolve, reject) => {
    const args = ['-p']
    if (tools) args.push('--allowedTools', tools)
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => reject({ error: 'could not run claude: ' + e.message }))
    child.on('close', () => {
      const cleaned = out
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '')
        .trim()
      try {
        resolve(JSON.parse(cleaned))
      } catch (e) {
        reject({ error: 'claude did not return valid JSON', detail: e.message, raw: out.slice(0, 400), stderr: err.slice(0, 300) })
      }
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

function decomposePrompt(question, tokens) {
  return `You are a question-decomposition engine. Turn a vague question into the SUBSTANTIVE DIMENSIONS that determine its answer — the real sub-questions, considerations and unknowns a careful analyst would pin down. NOT the dictionary senses of words; the actual hidden decisions and cruxes.

Ground each dimension in a ROLE of the sentence (subject · verb/action · object · adjective · frame/modal), then check it against these RECURRING LENSES (use the ones that apply):
frame/values (good/better/worth/should → by what measure & what matters) · what-exactly (which type/variant/scope) · VS-WHAT (the counterfactual & alternatives — ALWAYS include, incl. "do nothing") · who/jurisdiction (for whom, whose decision, what authority) · where/context-of-use (location, environment, market) · when/time-horizon (how long; the trade-off of time itself) · how-much/number (quantity; AND the amount/metric/THRESHOLD at which the answer flips) · feasibility (can it actually be done) · cost-all-in-vs-means (financing + incentives + running cost, vs income) · downside/risk (what if it fails) · world-model/future (the answer rests on a bet about the future) · personal-fit (lifestyle, health, enjoyment).

Hard lessons:
- OPTIONS ARE BUNDLES, not swaps: each branch of a choice is a DIFFERENT real object/scenario — decompose EACH; don't assume they differ on one axis (e.g. "rent vs buy a home" = two different homes, in different neighbourhoods, with different commutes and legal rights; "keep car vs buy EV vs public transport" = three different lives).
- CONSTRAINT CASCADE: one variable (e.g. budget) forces the rest (home → neighbourhood → commute) — trace those chains.
- resolutions must be CONCRETE and QUANTITATIVE where relevant — name the amount/metric/threshold where the answer flips (e.g. "up to ~1 egg/day vs 3+/day", "staying <3 years vs 10+").

Two worked examples — imitate this depth, each dimension grounded in a role:

"Should I learn to play the guitar as an adult?"
- should → Worth it by what measure? [fun · reachable skill · health · social · income · opportunity cost]
- learn → Can an adult realistically learn — how hard? [tractable · needs discipline · steep past an age]
- learn to play → To what level, at what effort? [strum songs → play fluently → perform → master; hrs/wk, months–years]
- the guitar → Which instrument / which guitar? [acoustic · electric · classical · or ukulele/bass/piano]
- I…as an adult → How old, from where? [20s · 30s–40s · 50s+ · prior experience · free time]

"Is it better to rent or buy a home?"  (the two options are DIFFERENT homes)
- budget → What home/market does each option even get you? [rent-budget vs buy-budget → different price points → rent-home area A vs buy-home area B]
- location → Each option's commute & neighbourhood [rent-home commute to office+kids vs buy-home's]
- legal regime → Rights, protections & rules of each [rent: rent-hikes? lock-in? eviction · buy: ownership/squatting rights, property tax, council rules]
- money → Total cost over time, all-in [incl. rent-and-invest-the-difference · property tax · break-even horizon]
- better+time → What you value & how long you'll stay [flexibility vs stability · <3 yrs vs 10+]

Return ONLY a single JSON object. No prose. No fences. Exact shape:
{
  "clusters": [ { "id": "snake_id", "name": "the dimension as a sharp sub-question", "color": "#RRGGBB", "prompt": "one line on what it turns on", "resolutions": ["concrete/quantitative option", "..."] } ],
  "assignments": ["cluster_id or null for EACH token, in order — MOST are null; only map a word that clearly belongs"],
  "elicit": [ { "id": "snake_id", "question": "a short question ABOUT THE ASKER", "why": "which dimension(s) it resolves", "options": ["short", "..."] } ]
}
Rules:
- 4 to 6 dimensions. Cover the applicable lenses; ALWAYS include the counterfactual. Each "name" is a real sub-question a person weighs — NEVER a meta-label like "what 'should' weighs".
- resolutions: 3-6 concrete, mutually distinct, quantitative where relevant.
- assignments EXACTLY as long as TOKENS; most null.
- elicit: 2-4 VOI-ranked asker-facts DERIVED FROM the dimensions (the fact that collapses the most first); "why" names them.
- distinct vivid hex colors legible on light & dark. Valid JSON only.

TOKENS: ${JSON.stringify(tokens)}
QUESTION: ${JSON.stringify(question)}`
}

function personalizePrompt(question, clusters, context) {
  return `You are personalizing a question's decomposition to a specific asker, to make truth-seeking sample-efficient. Given the QUESTION, its AXES, and what the ASKER told us about themselves, decide for EACH axis whether their context RESOLVES it (prune), leaves it genuinely OPEN (worth investigating for them), or makes it IRRELEVANT (drop) — and propose NEW axes their specific situation makes relevant.

Return ONLY a single JSON object. No prose. No fences. Exact shape:

{
  "clusters": [
    { "id": "<existing axis id>", "status": "pinned" | "open" | "dropped", "value": "<if pinned: the resolved value in a few words, else empty>", "reason": "<short why, referencing their context>" }
  ],
  "newClusters": [
    { "id": "new_snake", "name": "Short axis name", "color": "#RRGGBB", "prompt": "the sub-question", "resolutions": ["option", "option"], "reason": "why THIS asker's context makes this newly relevant" }
  ],
  "takeaway": "one sentence: for THIS asker, what the question really comes down to / what's worth investigating"
}

Rules:
- pinned = their context answers it. open = still genuinely uncertain FOR THEM. dropped = not relevant to them.
- Be decisive — the goal is to SHRINK the space to what's worth investigating. Give EVERY input axis a status.
- newClusters: 1-4 axes their context opens up that the generic decomposition missed (distinct vivid hex colors).
- Output valid JSON only.

QUESTION: ${JSON.stringify(question)}
AXES: ${JSON.stringify(clusters)}
ASKER: ${JSON.stringify(context)}`
}

function suggestPrompt(p) {
  if (p.kind === 'resolution') {
    return `Given a QUESTION and one DIMENSION of its decomposition, suggest 4-6 ADDITIONAL resolutions the asker might be thinking about that are NOT already listed — concrete, mutually distinct, quantitative where relevant, and genuinely different angles from the existing ones. Return ONLY JSON, no prose, no fences: {"suggestions": ["...", "..."]}
QUESTION: ${JSON.stringify(p.question || '')}
DIMENSION: ${JSON.stringify(p.dimensionName || '')} — ${JSON.stringify(p.dimensionPrompt || '')}
ALREADY LISTED: ${JSON.stringify(p.existing || [])}`
  }
  if (p.kind === 'dimension') {
    return `Given a QUESTION and its EXISTING dimensions, suggest 2-4 ADDITIONAL dimensions the asker might be missing — real sub-questions grounded in the lenses (counterfactual, context-of-use, time-horizon, cost, feasibility, downside, who), each DISTINCT from the existing ones. Return ONLY JSON, no prose, no fences: {"suggestions": [{"name": "...", "prompt": "...", "resolutions": ["...", "..."]}]}
QUESTION: ${JSON.stringify(p.question || '')}
EXISTING DIMENSIONS: ${JSON.stringify(p.existing || [])}`
  }
  return null
}

// Stage 3 · DEEP RESEARCH — one agent per open axis, web-searching and tagging findings back to it
function researchPrompt(p) {
  const hasCtx = p.context && String(p.context).trim()
  return `You are a research agent enriching a decision graph. Use web search to find REAL, current evidence for ONE axis of a decision, and tag each finding to the candidate resolution it best supports.

QUESTION: ${JSON.stringify(p.question)}
AXIS: ${JSON.stringify(p.dimensionName)} — ${JSON.stringify(p.dimensionPrompt || '')}
CANDIDATE RESOLUTIONS (tag each finding to the closest one, verbatim): ${JSON.stringify(p.resolutions || [])}
${hasCtx ? `THE ASKER — PERSONALIZE TO THEM. Prefer evidence about their specific subgroup/situation, prioritise studies whose population matches them, and for EACH finding say in one line how it applies to THEM:\n${JSON.stringify(p.context)}\n` : ''}
${p.brief ? `ORCHESTRATOR BRIEF — prioritise exactly this: ${JSON.stringify(p.brief)}\n` : ''}Search the web now. Return 3-4 REAL findings — prefer meta-analyses, RCTs, and official guidelines; be quantitative; flag conflicts of interest honestly.${hasCtx ? ' Bias hard toward evidence that applies to THIS asker.' : ''} Return ONLY JSON, no prose, no fences:
{"findings":[{"claim":"one specific, quantitative sentence","supports":"one of the candidate resolutions, verbatim (or 'unclear')","source":"publication or org","url":"a real, working URL","kind":"meta-analysis|RCT|cohort|guideline|observational|expert","n":"sample size or scale, if stated","year":"YYYY","confidence":"high|medium|low","coi":"funding/conflict note, or 'none noted'"${hasCtx ? ',"relevance":"one line: how this applies to THIS asker specifically"' : ''}}]}`
}

// DECIDE — synthesize the whole graph into ONE person's actionable answer (no web; reasons over the evidence)
function decidePrompt(p) {
  return `You are helping ONE person reach an actionable, honest decision from a structured evidence graph. This is a concrete, reversible choice — NOT a theory to settle. Give them: the answer, the real tradeoffs, the single crux it hinges on, an honestly-calibrated confidence, what's missing, and the one test that would resolve it for THEM.

QUESTION: ${JSON.stringify(p.question)}
${p.context ? `THE ASKER: ${JSON.stringify(p.context)}\n` : ''}
EVIDENCE — dimensions, each with its uncertainty and its findings (claim, the stance it supports, and the source's provenance): ${JSON.stringify(p.dimensions || [])}

Be decisive but honest. Explicitly account for: what the evidence genuinely SETTLED vs. merely performed settling; correlated evidence (studies sharing cohorts are not independent votes); claims where rhetoric outweighs evidence; conflicts of interest; and the hard limit that population data cannot tell an individual their own response. Return ONLY JSON, no prose, no fences:
{
  "answer": "the direct recommendation for THIS person, 1-2 plain sentences",
  "stance": "yes | lean-yes | it-depends | lean-no | no",
  "for": ["a concrete reason to do it, grounded in a specific finding"],
  "against": ["a concrete reason not to / a real risk, grounded in a specific finding"],
  "crux": "the single unresolved question the decision most hinges on",
  "decisiveTest": "an n=1 experiment that would most INFORM the crux for THEM (what to measure, for how long) AND an honest note on what it still would NOT resolve (e.g. a biomarker response test does not settle long-term outcomes); if no single test suffices, say so",
  "confidence": "low | medium | high",
  "confidenceNote": "honest calibration: what's genuinely contested, out-of-model risk (funding environment, single-analyst limits), and what population data can't tell this individual",
  "missing": ["an important source, perspective, or data NOT represented in the evidence above"]
}`
}

// CROSS-EXAMINE — structure disparate findings into a CLAIM × SOURCE matrix (agreement/contradiction)
function matrixPrompt(p) {
  return `You are structuring disparate research findings into a CLAIM × SOURCE matrix so a human can see at a glance where the sources AGREE and where they CONTRADICT. First MERGE findings that assert the SAME claim in different forms into one claim. Then, for EACH source, decide its stance on EACH claim: "supports", "disputes", or "silent" (the source did not address that claim).

QUESTION: ${JSON.stringify(p.question)}
DIMENSION: ${JSON.stringify(p.dimensionName)}
CANDIDATE RESOLUTIONS: ${JSON.stringify(p.resolutions || [])}
FINDINGS (each is one claim from one source): ${JSON.stringify(p.findings || [])}

Return ONLY JSON, no prose, no fences:
{
  "sources": [ { "id": "s1", "name": "short source label", "url": "real url", "kind": "study kind", "year": "YYYY" } ],
  "claims": [ { "id": "c1", "text": "the distinct claim in one line", "resolution": "which candidate resolution it maps to (verbatim, or 'other')", "stances": { "s1": "supports|disputes|silent", "s2": "..." } } ]
}
Rules: DEDUPE sources (the same study cited twice = ONE source). MERGE the same claim stated in different forms. A source "supports" a claim only if its finding actually asserts it; "disputes" if it argues against it; otherwise "silent". Every source id referenced in any stances map MUST appear in sources. Valid JSON only.`
}

// The ORCHESTRATOR — plans the research: assigns each open axis its own specialised agent + brief
function orchestratorPrompt(p) {
  return `You are the research ORCHESTRATOR. Given a decision, the axes still open, and who is asking, produce a PLAN that gives EACH axis its own specialised research agent with a focused, personalised brief.

QUESTION: ${JSON.stringify(p.question)}
OPEN AXES: ${JSON.stringify(p.axes || [])}
${p.context ? `THE ASKER (personalise every brief to them): ${JSON.stringify(p.context)}\n` : ''}
Return ONLY JSON, no prose, no fences:
{
  "strategy": "2-3 sentences: the overall approach, what matters most for THIS asker, and what kind of evidence would actually change the decision",
  "agents": [
    { "dimension": "<the axis id, verbatim>", "role": "a short specialist title, e.g. 'CVD epidemiologist'", "focus": "what this agent should specifically hunt for", "sources": "which kinds of sources to prioritise", "crux": "the single finding that would most move this axis" }
  ]
}
Rules: EXACTLY one agent per open axis; "dimension" must equal the given axis id verbatim. Make focus and crux concrete and personalised. Valid JSON only.`
}

// A deep-dive subagent: DECOMPOSE the paper into its distinct RESULTS (a paper is a container, not a datum)
function deepDivePrompt(p) {
  return `You are a result-level extraction subagent. Use web search to find the paper behind a claim and DECOMPOSE it into its distinct RESULTS — a paper is a container, not one unit of evidence. Reason at the result level; keep the paper as context. A subgroup result, a secondary endpoint, or an adjusted-vs-unadjusted estimate is a DIFFERENT result with its OWN scope. Separate MEASURED results from the AUTHOR'S CONCLUSION — the conclusion is itself a claim, often broader than the results support. Give every result an exact passage/table pointer so a human can spot-check it.

DECISION: ${JSON.stringify(p.question)}
AXIS: ${JSON.stringify(p.axis || '')}
CLAIM UNDER EXAMINATION: ${JSON.stringify(p.claim)}
SOURCE: ${JSON.stringify(p.source || '')}
URL: ${JSON.stringify(p.url || '')}

Use "unclear" for anything you cannot verify after searching (do NOT invent numbers or pointers). Return ONLY JSON, no prose, no fences:
{
  "study": {
    "design": "study design / methodology (e.g. double-blind RCT, prospective cohort, meta-analysis of N trials)",
    "year": "publication year",
    "journal": "journal or venue name",
    "journal_tier": "reputation in a few words: top-tier / reputable / low-impact / predatory / preprint",
    "peer_reviewed": true,
    "investigators": "principal investigators / lead authors + institution",
    "funding": "who funded it",
    "coi": "declared conflicts of interest",
    "open_data": "is data/code public? (yes + where / no / unclear)",
    "dataset": "the underlying cohort/dataset identity (e.g. ARIC, NHANES, Framingham) — for detecting shared-data dependence across studies",
    "critiques": "known critiques, letters, failed replications, retraction status — or 'none found'"
  },
  "results": [
    {
      "statement": "the specific MEASURED result, one line including the number",
      "locus": "exact pointer — table/figure/page, or a short quoted passage",
      "population": "population & subgroup for THIS result",
      "exposure": "exposure / dose / comparator for THIS result",
      "outcome": "outcome & time horizon for THIS result",
      "estimate": "effect estimate with 95% CI if reported",
      "model": "statistical model + adjustment set",
      "status": "primary | secondary | subgroup | exploratory | post-hoc",
      "n": "sample size for THIS analysis",
      "relation": "supports | contradicts | qualifies | undercuts-method | bounds | mechanistically-explains | not-informative",
      "relationNote": "one line: how THIS result bears on the claim under examination"
    }
  ],
  "authorConclusion": {
    "text": "the paper's own stated conclusion",
    "assessment": "how it relates to the measured results above — e.g. 'supported by the results', 'broader than the results support', 'underdetermined by results'"
  }
}`
}

function apiPlugin() {
  return {
    name: 'epistack-api',
    configureServer(server) {
      const handle = (buildPrompt, tools) => (req, res) => {
        const json = (code, obj) => {
          res.statusCode = code
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(obj))
        }
        if (req.method !== 'POST') return json(405, { error: 'POST only' })
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', async () => {
          let p
          try {
            p = JSON.parse(body || '{}')
          } catch {
            return json(400, { error: 'bad request json' })
          }
          const prompt = buildPrompt(p)
          if (prompt == null) return json(400, { error: 'missing fields' })
          try {
            json(200, await runClaude(prompt, tools))
          } catch (e) {
            json(502, e)
          }
        })
      }
      server.middlewares.use(
        '/api/decompose',
        handle((p) => (p.question ? decomposePrompt(String(p.question), Array.isArray(p.tokens) ? p.tokens : []) : null)),
      )
      server.middlewares.use(
        '/api/personalize',
        handle((p) => (p.question && p.clusters ? personalizePrompt(String(p.question), p.clusters, String(p.context || '')) : null)),
      )
      server.middlewares.use('/api/suggest', handle((p) => (p.kind && p.question ? suggestPrompt(p) : null)))
      server.middlewares.use(
        '/api/research',
        handle((p) => (p.question && p.dimensionName ? researchPrompt(p) : null), 'WebSearch,WebFetch'),
      )
      server.middlewares.use(
        '/api/deepdive',
        handle((p) => (p.claim ? deepDivePrompt(p) : null), 'WebSearch,WebFetch'),
      )
      server.middlewares.use('/api/plan', handle((p) => (p.question && p.axes ? orchestratorPrompt(p) : null)))
      server.middlewares.use('/api/matrix', handle((p) => (p.dimensionName && p.findings ? matrixPrompt(p) : null)))
      server.middlewares.use('/api/decide', handle((p) => (p.question && p.dimensions ? decidePrompt(p) : null)))
    },
  }
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: { port: 5173, host: true },
})
