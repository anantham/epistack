import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'

// tolerant JSON extraction: accept clean JSON, a ```json fenced block, or JSON embedded in prose
function extractJson(text) {
  let s = String(text || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) {
    try { return JSON.parse(fence[1].trim()) } catch {}
  }
  try { return JSON.parse(s) } catch {}
  // fall back to the outer {...} (first "{" to last "}") — kills leading/trailing prose
  const i = s.indexOf('{'), j = s.lastIndexOf('}')
  if (i >= 0 && j > i) {
    try { return JSON.parse(s.slice(i, j + 1)) } catch {}
  }
  return undefined
}

function spawnClaude(prompt, tools, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = ['-p']
    if (tools) args.push('--allowedTools', tools)
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = '', settled = false
    const finish = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v) } }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {}; finish(reject, { error: 'claude timed out', ms: timeoutMs, retryable: true }) }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => finish(reject, { error: 'could not run claude: ' + e.message }))
    child.on('close', () => {
      const parsed = extractJson(out)
      if (parsed !== undefined) finish(resolve, parsed)
      else finish(reject, { error: 'claude did not return valid JSON', raw: out.slice(0, 400), stderr: err.slice(0, 300), retryable: true })
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

// retry on parse-fail / timeout (both retryable); spawn errors don't retry
async function runClaude(prompt, tools) {
  const timeoutMs = tools ? 240000 : 90000
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await spawnClaude(prompt, tools, timeoutMs)
    } catch (e) {
      lastErr = e
      if (!e || !e.retryable) break
    }
  }
  throw lastErr
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
{"findings":[{"claim":"one specific, quantitative sentence","supports":"one of the candidate resolutions, verbatim (or 'unclear')","source":"publication or org","url":"a real, working URL","kind":"meta-analysis|RCT|cohort|guideline|observational|expert","n":"sample size or scale, if stated","year":"YYYY","confidence":"high|medium|low","coi":"funding/conflict note, or 'none noted'","dataset":"the underlying cohort/dataset/registry if identifiable (e.g. ARIC, NHANES, Framingham); for a meta-analysis name the pooled cohorts; 'primary study' for an original trial; else 'unclear' — used to detect shared-data dependence"${hasCtx ? ',"relevance":"one line: how this applies to THIS asker specifically"' : ''}}]}`
}

// DECIDE — synthesize the whole graph into ONE person's actionable answer (no web; reasons over the evidence)
function decidePrompt(p) {
  return `You are helping ONE person reach an actionable, honest decision from a structured evidence graph. This is a concrete, reversible choice — NOT a theory to settle. Give them: the answer, the real tradeoffs, the single crux it hinges on, an honestly-calibrated confidence, what's missing, and the one test that would resolve it for THEM.

QUESTION: ${JSON.stringify(p.question)}
${p.context ? `THE ASKER: ${JSON.stringify(p.context)}\n` : ''}
EVIDENCE — dimensions, each with: its findings (claim + stance + provenance + a "dataset" hint); any RESULT-LEVEL records from deep-dived papers (each result has its own scope, estimate, typed relation, and a "verification" status: source-checked / abstract-only / review-extracted / unverified); and its INDEPENDENT EVIDENCE FAMILIES (sources grouped by shared cohort/data): ${JSON.stringify(p.dimensions || [])}

Be decisive but honest. Explicitly account for: what the evidence genuinely SETTLED vs. merely performed settling; **REASON AT THE RESULT LEVEL where result records exist — a paper is not one vote; a single study can support one scoped claim and undercut another**; **VERIFICATION — prefer source-checked results; down-weight abstract-only and especially unverified ones**; **INDEPENDENCE — count independent evidence FAMILIES, not sources (studies sharing a cohort like Framingham/ARIC are ONE family); say so when apparent agreement is really one dataset counted repeatedly**; claims where rhetoric outweighs evidence; conflicts of interest; and the hard limit that population data cannot tell an individual their own response. Return ONLY JSON, no prose, no fences:
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

// DEPENDENCE GROUPING — cluster findings into INDEPENDENT evidence families (shared cohort/data/team ≠ independent votes)
function dependencePrompt(p) {
  return `You are auditing evidence INDEPENDENCE. Sources that look separate are often NOT independent votes — they can pool the same cohort, reanalyse the same dataset, share a research team, or be a primary study plus the meta-analyses that swallow it. Cluster the findings into INDEPENDENT EVIDENCE FAMILIES: two findings are in the same family if their conclusions rest on substantially the SAME underlying data, cohort, or authors. A genuinely separate dataset/team = a new family.

QUESTION: ${JSON.stringify(p.question)}
DIMENSION: ${JSON.stringify(p.dimensionName)}
FINDINGS (each is one source; note the dataset hint where present): ${JSON.stringify(p.findings || [])}

Return ONLY JSON, no prose, no fences:
{
  "families": [
    { "id": "f1", "label": "short name for this evidence family (e.g. 'Framingham/ARIC pooled cohorts')", "basis": "why these share dependence — shared cohort / shared team / primary+its-meta-analyses / same dataset reanalysed", "members": ["source name", "source name"], "note": "one line on what this family collectively shows" }
  ],
  "independentCount": 3,
  "totalSources": 6,
  "note": "one line: e.g. '6 sources but only 3 independent families — much of the apparent agreement is the Framingham cohort counted repeatedly'"
}
Rules: every source must belong to exactly one family. A family may have one member (genuinely standalone). independentCount = number of families. Be conservative about calling things independent — if two share a major cohort, they are the SAME family. Valid JSON only.`
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

// Deep-dive PHASE 1 — ENUMERATE: find the paper, list the decision-relevant result stubs (shallow, small output)
function deepDiveEnumeratePrompt(p) {
  return `You are a result-level extraction subagent — PHASE 1 of 2 (ENUMERATE). Use web search to find the paper behind a claim and ENUMERATE its distinct results — a paper is a container, not one datum (a subgroup, a secondary endpoint, an adjusted-vs-unadjusted estimate is a DIFFERENT result). Keep this SHALLOW: identify each result but do NOT expand full scope yet. Return only the 4-6 results MOST relevant to the claim under examination — not every result in the paper. Separate the AUTHOR'S CONCLUSION from the measured results.

DECISION: ${JSON.stringify(p.question)}
AXIS: ${JSON.stringify(p.axis || '')}
CLAIM UNDER EXAMINATION: ${JSON.stringify(p.claim)}
SOURCE: ${JSON.stringify(p.source || '')}
URL: ${JSON.stringify(p.url || '')}

Use "unclear" for anything unverifiable (do NOT invent). Return ONLY JSON, no prose, no fences:
{
  "study": { "design":"", "year":"", "journal":"", "journal_tier":"top-tier|reputable|low-impact|predatory|preprint", "peer_reviewed":true, "investigators":"principal investigators + institution", "funding":"", "coi":"", "open_data":"", "dataset":"underlying cohort/dataset identity (for dependence grouping)", "critiques":"known critiques/letters/retraction, or 'none found'" },
  "resultStubs": [ { "statement":"the measured result in one line with its number", "status":"primary|secondary|subgroup|exploratory|post-hoc", "estimate":"effect + CI if reported", "relation":"supports|contradicts|qualifies|undercuts-method|bounds|mechanistically-explains|not-informative", "locus":"table/figure/page pointer if known" } ],
  "authorConclusion": { "text":"the paper's own conclusion", "assessment":"'supported by the results' | 'broader than the results support' | 'underdetermined by results'" }
}`
}

// Deep-dive PHASE 2 — DETAIL: expand each known stub into a full scoped result (small, focused output)
function deepDiveDetailPrompt(p, study, stubs) {
  return `You are a result-level extraction subagent — PHASE 2 of 2 (DETAIL). For each result STUB below, expand its FULL scope. Fetch/read the paper to confirm and mark verification HONESTLY. Return one full result per stub, in the same order.

DECISION: ${JSON.stringify(p.question)}
CLAIM UNDER EXAMINATION: ${JSON.stringify(p.claim)}
PAPER: ${JSON.stringify(p.source || '')} — ${JSON.stringify(p.url || '')}
STUDY: ${JSON.stringify(study || {})}
RESULT STUBS TO DETAIL: ${JSON.stringify(stubs || [])}

Use "unclear" for unverifiable fields. Return ONLY JSON, no prose, no fences:
{ "results": [ {
  "statement":"the measured result, one line with its number",
  "locus":"exact table/figure/page or short quoted passage",
  "population":"population & subgroup for THIS result",
  "exposure":"exposure / dose / comparator",
  "outcome":"outcome & time horizon",
  "estimate":"effect estimate with 95% CI",
  "model":"statistical model + adjustment set",
  "status":"primary|secondary|subgroup|exploratory|post-hoc",
  "n":"sample size for THIS analysis",
  "relation":"supports|contradicts|qualifies|undercuts-method|bounds|mechanistically-explains|not-informative",
  "relationNote":"how THIS result bears on the claim",
  "verification":"source-checked (you read the primary paper's full text/table) | abstract-only | review-extracted | unverified — be honest, don't claim source-checked unless you actually read the primary reporting"
} ] }`
}

// orchestrate the two phases: enumerate (WebSearch) → detail (WebFetch), with graceful fallback to stubs
async function deepDiveRun(p) {
  const meta = await runClaude(deepDiveEnumeratePrompt(p), 'WebSearch,WebFetch')
  const stubs = Array.isArray(meta.resultStubs) ? meta.resultStubs.slice(0, 6) : []
  let results = []
  if (stubs.length) {
    try {
      const detail = await runClaude(deepDiveDetailPrompt(p, meta.study, stubs), 'WebFetch')
      if (Array.isArray(detail.results) && detail.results.length) results = detail.results
    } catch {}
    if (!results.length) {
      // graceful degradation — keep the shallow stubs (flagged unverified) rather than failing outright
      results = stubs.map((s) => ({ statement: s.statement, status: s.status, estimate: s.estimate, relation: s.relation, locus: s.locus, verification: 'unverified' }))
    }
  }
  return { study: meta.study || {}, results, authorConclusion: meta.authorConclusion || {} }
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
      // for multi-call orchestrations (e.g. the two-phase deep-dive)
      const handleCustom = (run) => (req, res) => {
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
          try {
            json(200, await run(p))
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
        handleCustom((p) => (p.claim ? deepDiveRun(p) : Promise.reject({ error: 'missing fields' }))),
      )
      server.middlewares.use('/api/plan', handle((p) => (p.question && p.axes ? orchestratorPrompt(p) : null)))
      server.middlewares.use('/api/matrix', handle((p) => (p.dimensionName && p.findings ? matrixPrompt(p) : null)))
      server.middlewares.use('/api/decide', handle((p) => (p.question && p.dimensions ? decidePrompt(p) : null)))
      server.middlewares.use('/api/dependence', handle((p) => (p.dimensionName && p.findings ? dependencePrompt(p) : null)))
    },
  }
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: { port: 5173, host: true },
})
