import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'] })
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

function apiPlugin() {
  return {
    name: 'epistack-api',
    configureServer(server) {
      const handle = (buildPrompt) => (req, res) => {
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
            json(200, await runClaude(prompt))
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
    },
  }
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: { port: 5173, host: true },
})
