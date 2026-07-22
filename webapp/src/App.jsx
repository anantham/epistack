import { useState, useRef, useLayoutEffect, useEffect, useMemo } from 'react'
import { mergeInvestigationRecord } from './merge.js'

const prefersReduced =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion:reduce)').matches

const isPunct = (t) => /^[^\sA-Za-z0-9]+$/.test(t)
const tokenize = (q) => q.match(/[A-Za-z0-9']+|[^\sA-Za-z0-9]/g) || []

// map each token to the SET of clusters whose highlightQuotes contain it (many-to-many; word-level match)
function computeTokenMembers(tokens, clusters) {
  const members = tokens.map(() => [])
  const lc = tokens.map((t) => String(t).toLowerCase())
  const words = lc.map((t, i) => (/[a-z0-9']/i.test(t) ? i : -1)).filter((i) => i >= 0) // ignore punctuation-only tokens
  for (const c of clusters || []) {
    for (const quote of c.highlightQuotes || []) {
      const q = tokenize(String(quote))
        .map((t) => t.toLowerCase())
        .filter((t) => /[a-z0-9']/i.test(t))
      if (!q.length) continue
      // slide over the question's WORD tokens; mark every match (handles repeats + overlaps)
      for (let w = 0; w + q.length <= words.length; w++) {
        let ok = true
        for (let j = 0; j < q.length; j++) if (lc[words[w + j]] !== q[j]) { ok = false; break }
        if (ok) for (let j = 0; j < q.length; j++) { const ti = words[w + j]; if (!members[ti].includes(c.id)) members[ti].push(c.id) }
      }
    }
  }
  return members
}

const LOADING_STEPS = [
  'reading the question',
  'coloring the words',
  'finding the axes of ambiguity',
  'naming the clusters',
]

const DUR_KEY = 'epistack_decomp_ms'
const getDurations = () => {
  try {
    return JSON.parse(localStorage.getItem(DUR_KEY) || '[]')
  } catch {
    return []
  }
}
const pushDuration = (ms) => {
  const a = getDurations().concat(Math.round(ms)).slice(-12)
  try {
    localStorage.setItem(DUR_KEY, JSON.stringify(a))
  } catch {}
  return a
}
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

const CACHE_KEY = 'epistack_decomp_cache'
const getCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}
const setCache = (q, data) => {
  try {
    const c = getCache()
    c[q] = data
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {}
}

// --- A.3: persistent investigation store (the whole artifact per question, survives reload + tab-switch) ---
const STORE_KEY = 'epistack_investigations'
const getStore = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
  } catch {
    return {}
  }
}
const loadInvestigation = (q) => getStore()[q] || null
const saveInvestigationPatch = (q, patch) => {
  if (!q) return
  try {
    const s = getStore()
    s[q] = { ...(s[q] || {}), ...patch, question: q, updatedAt: Date.now() }
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {}
}
// record a steering action (edit / prune / add / dispatch / deep-dive / decide …) into the artifact's timeline
const logInteraction = (q, actor, event, detail) => {
  if (!q) return
  try {
    const s = getStore()
    const rec = s[q] || {}
    rec.interactions = [...(rec.interactions || []), { t: new Date().toISOString(), actor, event, ...(detail !== undefined ? { detail } : {}) }].slice(-1000)
    s[q] = { ...rec, question: q, updatedAt: Date.now() }
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {}
}
// model preference for claude -p (global; '' / undefined = the CLI default). Injected into every API call.
const MODEL_KEY = 'epistack_model'
const MODELS = [
  { v: '', label: 'default', note: 'your CLI default' },
  { v: 'opus', label: 'Opus 4.8', note: 'strongest' },
  { v: 'sonnet', label: 'Sonnet 5', note: 'balanced' },
  { v: 'haiku', label: 'Haiku 4.5', note: 'fast · cheap' },
  { v: 'claude-fable-5', label: 'Fable 5', note: 'fast' },
]
const getModel = () => {
  try {
    return localStorage.getItem(MODEL_KEY) || undefined
  } catch {
    return undefined
  }
}
const setModelPref = (m) => {
  try {
    m ? localStorage.setItem(MODEL_KEY, m) : localStorage.removeItem(MODEL_KEY)
  } catch {}
}

const exportInvestigation = (q) => {
  const inv = loadInvestigation(q)
  if (!inv) return
  const r = inv.research || {}
  const payload = {
    schema: 'epistack.investigation/v1',
    question: q,
    exportedAt: new Date().toISOString(),
    model: getModel() || 'default',
    contributor: getMe(), // who collected this — so merged evidence stays attributed

    // everything the HUMAN did — inputs, edits, and the full steering timeline
    human: {
      dimensionsAsShaped: inv.data?.clusters || [], // after your renames / prunes / additions
      elicitAnswers: inv.elicitAns || {},
      contextRant: inv.ctxText || '',
      contextSummary: inv.context || '',
      interactions: inv.interactions || [],
    },
    // everything the AI produced
    ai: {
      wordAssignments: inv.data?.assignments || [],
      elicitationQuestions: inv.data?.elicit || [],
      personalization: inv.pdata || null,
      findings: r.lanes || {},
      resultLedgers: r.ledgers || {},
      evidenceFamilies: r.families || {},
    },
    decision: r.decision || null,
    _record: inv, // the raw store record, so the file round-trips back into the tool
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `epistack-${(q || 'investigation').slice(0, 40).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// --- who am I: a stable per-browser contributor identity, so merged evidence stays attributed ---
const ME_KEY = 'epistack_me'
const getMe = () => {
  try {
    const m = JSON.parse(localStorage.getItem(ME_KEY) || 'null')
    if (m && m.id) return m
  } catch {}
  const me = { id: 'c_' + Math.random().toString(36).slice(2, 9), name: '' }
  try { localStorage.setItem(ME_KEY, JSON.stringify(me)) } catch {}
  return me
}
const setMeName = (name) => {
  const me = getMe()
  const next = { ...me, name: String(name || '').slice(0, 40) }
  try { localStorage.setItem(ME_KEY, JSON.stringify(next)) } catch {}
  return next
}

// read an exported file, merge/adopt it into the store. Returns a summary for the UI.
function ingestInvestigationFile(text, currentQuestion) {
  let file
  try { file = JSON.parse(text) } catch { throw new Error('not valid JSON') }
  if (!file || typeof file !== 'object' || !file.question) throw new Error('not an epistack export (no question)')
  const incoming = file._record || {
    question: file.question,
    data: { clusters: file.human?.dimensionsAsShaped || [], elicit: file.ai?.elicitationQuestions || [], assignments: file.ai?.wordAssignments || [] },
    pdata: file.ai?.personalization || null,
    ctxText: file.human?.contextRant || '',
    context: file.human?.contextSummary || '',
    interactions: file.human?.interactions || [],
    research: { lanes: file.ai?.findings || {}, ledgers: file.ai?.resultLedgers || {}, families: file.ai?.evidenceFamilies || {}, decision: file.decision || null },
  }
  const byId = (file.contributor && file.contributor.id) || 'imported'
  const byName = (file.contributor && file.contributor.name) || ''
  const q = file.question.trim()
  const mine = loadInvestigation(q)
  const sameQuestion = currentQuestion && currentQuestion.trim() === q
  if (mine && (sameQuestion || (mine.research && Object.keys(mine.research.lanes || {}).length))) {
    // merge into an existing investigation of the same question
    const { merged, summary } = mergeInvestigationRecord(mine, incoming, byId)
    saveInvestigationPatch(q, merged)
    return { mode: 'merged', question: q, byName, byId, ...summary }
  }
  // adopt fresh (I have nothing for this question)
  const { merged, summary } = mergeInvestigationRecord({ question: q }, incoming, byId)
  saveInvestigationPatch(q, merged)
  return { mode: 'adopted', question: q, byName, byId, ...summary }
}

// One cluster = one scroll "stage". Activates when scrolled into view:
// its words colour in the sticky question above, then fly down into this card.
function ClusterSection({ cluster, wordIdxs, tokens, wordRefs, active, onActivate, onEdit, question }) {
  const secRef = useRef(null)
  const chipRefs = useRef({})

  useEffect(() => {
    const node = secRef.current
    if (!node) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && onActivate(cluster.id)),
      { threshold: 0.5, rootMargin: '0px 0px -12% 0px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [cluster.id, onActivate])

  // hide the chips until they fly in
  useLayoutEffect(() => {
    if (prefersReduced) return
    Object.values(chipRefs.current).forEach((el) => {
      if (el) el.style.opacity = '0'
    })
  }, [])

  // on activation: colours have applied above; after a beat, fly the words down into this card
  useEffect(() => {
    if (!active) return
    if (prefersReduced) {
      Object.values(chipRefs.current).forEach((el) => el && (el.style.opacity = ''))
      wordIdxs.forEach((i) => wordRefs.current[i]?.classList.add('flew'))
      return
    }
    const t = setTimeout(() => {
      const keys = Object.keys(chipRefs.current)
      keys.forEach((i) => {
        const chip = chipRefs.current[i]
        const src = wordRefs.current[i]
        if (!chip || !src) return
        const to = chip.getBoundingClientRect()
        const from = src.getBoundingClientRect()
        chip.style.transition = 'none'
        chip.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px)`
        chip.style.opacity = '0.25'
        src.classList.add('flew')
      })
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          keys.forEach((i, k) => {
            const chip = chipRefs.current[i]
            if (!chip) return
            chip.style.transition = `transform 1s cubic-bezier(.2,.7,.25,1) ${k * 55}ms, opacity .6s ease ${k * 55}ms`
            chip.style.transform = ''
            chip.style.opacity = ''
          })
        }),
      )
    }, 550)
    return () => clearTimeout(t)
  }, [active])

  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  async function suggestRes() {
    setSuggesting(true)
    try {
      const r = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: getModel(), kind: 'resolution', question, dimensionName: cluster.name, dimensionPrompt: cluster.prompt, existing: cluster.resolutions || [] }),
      })
      const j = await r.json()
      if (r.ok && Array.isArray(j.suggestions)) {
        const have = new Set((cluster.resolutions || []).map((x) => String(x).toLowerCase().trim()))
        setSuggestions(j.suggestions.filter((s) => s && !have.has(String(s).toLowerCase().trim())))
      }
    } catch {}
    setSuggesting(false)
  }

  return (
    <section id={`sec-${cluster.id}`} className={`section ${active ? 'active' : ''}`} ref={secRef} style={{ '--c': cluster.color }}>
      <div className="section-head">
        <span className="dot" style={{ background: cluster.color }} />
        <input
          className="edit-name"
          value={cluster.name}
          placeholder="name this dimension…"
          onChange={(e) => onEdit.name(cluster.id, e.target.value)}
        />
        <button className="del-dim" title="delete this dimension" onClick={() => onEdit.delDim(cluster.id)} aria-label="delete dimension">×</button>
      </div>
      <input
        className="edit-prompt"
        value={cluster.prompt || ''}
        placeholder="one line on what this turns on…"
        onChange={(e) => onEdit.prompt(cluster.id, e.target.value)}
      />
      <div className="section-words">
        {wordIdxs.map((i) => (
          <span key={i} ref={(el) => (chipRefs.current[i] = el)} className="chip-word" style={{ color: cluster.color, borderColor: cluster.color }}>
            {tokens[i]}
          </span>
        ))}
      </div>
      <div className="section-res">
        <span className="rlabel">ways to resolve it</span>
        <ul>
          {(cluster.resolutions || []).map((r, k) => (
            <li className="res-row" key={k}>
              <AutoGrowText className="edit-res" value={r} placeholder="a resolution…" onChange={(e) => onEdit.res(cluster.id, k, e.target.value)} />
              <button className="del-res" title="delete" onClick={() => onEdit.delRes(cluster.id, k)} aria-label="delete resolution">×</button>
            </li>
          ))}
          {suggestions.map((s, i) => (
            <li className="sugg-row" key={'sugg-' + i}>
              <button
                className="sugg-chip"
                onClick={() => {
                  onEdit.addResWith(cluster.id, s)
                  setSuggestions((prev) => prev.filter((_, j) => j !== i))
                }}
              >
                ＋ {s}
              </button>
            </li>
          ))}
          <li className="add-res">
            <button className="sugg-btn" onClick={suggestRes} disabled={suggesting}>
              {suggesting ? '✨ thinking…' : '✨ suggest'}
            </button>
            <button className="blank-btn" onClick={() => onEdit.addRes(cluster.id)}>＋ blank</button>
          </li>
        </ul>
      </div>
      {cluster.prior && String(cluster.prior).trim() && (
        <div className="section-prior">
          <span className="prior-label">AI prior · to be tested, kept out of the research agents</span>
          <span className="prior-text">{cluster.prior}</span>
        </div>
      )}
    </section>
  )
}

// Stage 1 right panel — the active dimension, editable (name/prompt/resolutions/prior + its grounding cues)
// a text field that wraps + grows with its content instead of clipping on one line
function AutoGrowText({ className, value, placeholder, onChange, onKeyDown }) {
  const ref = useRef(null)
  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  useEffect(resize, [value])
  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      rows={1}
      onChange={(e) => onChange(e)}
      onKeyDown={onKeyDown}
    />
  )
}

function ClusterDetail({ cluster, onEdit, question }) {
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  async function suggestRes() {
    setSuggesting(true)
    try {
      const r = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: getModel(), kind: 'resolution', question, dimensionName: cluster.name, dimensionPrompt: cluster.prompt, existing: cluster.resolutions || [] }),
      })
      const j = await r.json()
      if (r.ok && Array.isArray(j.suggestions)) {
        const have = new Set((cluster.resolutions || []).map((x) => String(x).toLowerCase().trim()))
        setSuggestions(j.suggestions.filter((s) => s && !have.has(String(s).toLowerCase().trim())))
      }
    } catch {}
    setSuggesting(false)
  }
  const cues = cluster.highlightQuotes || []
  return (
    <section className="cd" style={{ '--c': cluster.color }}>
      <div className="cd-grounded">
        <span className="cd-grounded-label">grounded in your words</span>
        <div className="cd-cues">
          {cues.length ? cues.map((q, i) => <span key={i} className="cd-cue">“{q}”</span>) : <span className="cd-cue none">—</span>}
        </div>
      </div>
      <div className="section-head">
        <span className="dot" style={{ background: cluster.color }} />
        <AutoGrowText className="edit-name" value={cluster.name} placeholder="name this dimension…" onChange={(e) => onEdit.name(cluster.id, e.target.value)} />
        <button className="del-dim" title="delete this dimension" onClick={() => onEdit.delDim(cluster.id)} aria-label="delete dimension">×</button>
      </div>
      <AutoGrowText className="edit-prompt" value={cluster.prompt || ''} placeholder="one line on what this turns on…" onChange={(e) => onEdit.prompt(cluster.id, e.target.value)} />
      <div className="section-res">
        <span className="rlabel">ways to resolve it</span>
        <ul>
          {(cluster.resolutions || []).map((r, k) => (
            <li className="res-row" key={k}>
              <AutoGrowText className="edit-res" value={r} placeholder="a resolution…" onChange={(e) => onEdit.res(cluster.id, k, e.target.value)} />
              <button className="del-res" title="delete" onClick={() => onEdit.delRes(cluster.id, k)} aria-label="delete resolution">×</button>
            </li>
          ))}
          {suggestions.map((s, i) => (
            <li className="sugg-row" key={'sugg-' + i}>
              <button className="sugg-chip" onClick={() => { onEdit.addResWith(cluster.id, s); setSuggestions((prev) => prev.filter((_, j) => j !== i)) }}>＋ {s}</button>
            </li>
          ))}
          <li className="add-res">
            <button className="sugg-btn" onClick={suggestRes} disabled={suggesting}>{suggesting ? '✨ thinking…' : '✨ suggest'}</button>
            <button className="blank-btn" onClick={() => onEdit.addRes(cluster.id)}>＋ blank</button>
          </li>
        </ul>
      </div>
      {cluster.prior && String(cluster.prior).trim() && (
        <div className="section-prior">
          <span className="prior-label">AI prior · to be tested, kept out of the research agents</span>
          <span className="prior-text">{cluster.prior}</span>
        </div>
      )}
    </section>
  )
}

// Stage 2 · CONTEXTUALIZE — elicit the asker's situation, then show what it prunes/opens
function ElicitPanel({ elicit, ans, setAns, ctx, setCtx, onGo, busy, err }) {
  return (
    <div className="elicit">
      <div className="elicit-head">
        <h3>make it about you</h3>
        <p>A few facts prune most of this. The questions below come from the axes above — answer what you can, skip the rest.</p>
      </div>
      {(elicit || []).map((q) => (
        <div className="elicit-q" key={q.id}>
          <div className="elicit-qtext">{q.question}</div>
          {q.why && <div className="elicit-why">pins: {q.why}</div>}
          <div className="elicit-opts">
            {(q.options || []).map((o) => (
              <button
                key={o}
                className={`opt${ans[q.id] === o ? ' on' : ''}`}
                onClick={() => setAns((a) => ({ ...a, [q.id]: a[q.id] === o ? undefined : o }))}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
      <textarea
        className="elicit-ctx"
        rows={3}
        placeholder="anything else about you — age, where you live, health, goals, what you already eat…"
        value={ctx}
        onChange={(e) => setCtx(e.target.value)}
      />
      {err && <div className="elicit-err">Couldn't personalize: {err}</div>}
      <button className="btn-decompose elicit-go" onClick={onGo} disabled={busy}>
        {busy ? 'personalizing…' : 'personalize ⚡'}
      </button>
    </div>
  )
}

function PersonalizedMap({ data, pdata, onRedo }) {
  const st = (id) => (pdata.clusters || []).find((c) => c.id === id) || { status: 'open' }
  const orig = (data.clusters || []).map((c) => ({ ...c, ...st(c.id) }))
  const news = (pdata.newClusters || []).map((c) => ({ ...c, status: 'new' }))
  const order = { open: 0, new: 1, pinned: 2, dropped: 3 }
  const all = [...orig, ...news].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
  const label = { pinned: '✓ settled by you', open: '○ worth investigating', dropped: '— skip', new: '＋ new for you' }
  return (
    <div className="pmap">
      {pdata.takeaway && (
        <div className="takeaway">
          <span className="rlabel">for you, it comes down to</span>
          {pdata.takeaway}
        </div>
      )}
      <div className="axis-rows">
        {all.map((a) => (
          <div className={`axis-row st-${a.status}`} key={a.id} style={{ '--c': a.color || 'var(--accent)' }}>
            <span className="st-badge">{label[a.status] || a.status}</span>
            <div className="axis-main">
              <div className="axis-name">{a.name}</div>
              {a.status === 'pinned' && a.value && <div className="axis-val">you: {a.value}</div>}
              {(a.status === 'open' || a.status === 'new') && a.prompt && <div className="axis-prompt">{a.prompt}</div>}
              {(a.status === 'open' || a.status === 'new') && a.resolutions && a.resolutions.length > 0 && (
                <div className="axis-res2">{a.resolutions.join(' · ')}</div>
              )}
              {a.reason && <div className="axis-reason">{a.reason}</div>}
            </div>
          </div>
        ))}
      </div>
      <button className="btn-ghost" onClick={onRedo}>↺ edit context</button>
    </div>
  )
}

// Stage 3 · DEEP RESEARCH — dispatch one web-searching agent per still-open axis;
// each returns findings tagged back to the axis's candidate resolutions (the "filtered graph" filling in).
const norm = (s) => String(s || '').toLowerCase().trim()
const matchRes = (a, b) => {
  const x = norm(a), y = norm(b)
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}

// Honest per-axis descriptive stats. A "finding" is ONE unit — no confidence-weighting,
// no entropy, no derived "uncertainty %". segs = how the RETRIEVED findings distribute across
// resolutions (the histogram); topShare = the fraction on the leading resolution. These describe
// what the agents FOUND, never the probability that a claim is true.
function axisStats(axis, findings) {
  const res = axis.resolutions || []
  const buckets = res.map((r) => ({ r, w: findings.filter((f) => matchRes(f.supports, r)).length }))
  const unclearW = findings.filter((f) => !res.some((r) => matchRes(f.supports, r))).length
  const segs = unclearW > 0 ? [...buckets, { r: 'unclear', w: unclearW, unclear: true }] : buckets.length ? buckets : [{ r: '—', w: 0 }]
  const total = findings.length
  const maxW = Math.max(1, ...segs.map((b) => b.w))
  const top = [...segs].filter((b) => !b.unclear).sort((a, b) => b.w - a.w)[0]
  const topShare = total > 0 && top ? top.w / total : 0
  return { segs, total, maxW, evidence: findings.length, top: top && top.w > 0 ? top.r : null, topShare }
}
// a QUALITATIVE read of the retrieved findings — deliberately not a number. "findings" prefix
// keeps it honest: this is agreement among what was retrieved, not confidence in the truth.
function verdict(s) {
  if (s.evidence === 0) return { key: 'unexamined', label: 'unexamined' }
  if (s.evidence < 2) return { key: 'thin', label: 'thin · 1 finding' }
  if (s.topShare >= 0.8) return { key: 'converging', label: `findings agree → ${s.top || '—'}` }
  if (s.topShare < 0.55) return { key: 'contested', label: 'findings conflict' }
  return { key: 'leaning', label: `findings lean → ${s.top || '—'}` }
}

// one segmented bar = the evidence distribution across an axis's resolutions (the "histogram")
function EvidenceBar({ axis, stats }) {
  const { segs, total, maxW } = stats
  return (
    <div className="ebar" style={{ '--c': axis.color || 'var(--accent)' }} aria-hidden="true">
      {segs.map((s, i) => {
        const pct = total > 0 ? (s.w / total) * 100 : 100 / segs.length
        const op = total === 0 ? 0.14 : s.unclear ? 0.32 : 0.35 + 0.65 * (s.w / maxW)
        return (
          <span
            key={i}
            className={`eseg${s.unclear ? ' unclear' : ''}${total === 0 ? ' empty' : ''}`}
            style={{ width: pct + '%', opacity: op }}
            title={`${s.r}: ${s.w || 0}`}
          />
        )
      })}
    </div>
  )
}

// relation → colour family: green = props up the claim, amber = works against it, grey = neither
const relClass = (r) => {
  const n = norm(r)
  if (/support|mechan/.test(n)) return 'good'
  if (/contradict|undercut|fails|dispute/.test(n)) return 'warn'
  return 'neutral' // qualifies · bounds · not-informative · transports
}
// verification status of an extracted result — how honestly we know it
const verMeta = (v) => {
  const n = norm(v)
  if (/source.?check/.test(n)) return { cls: 'good', label: '✓ source-checked' }
  if (/abstract/.test(n)) return { cls: 'warn', label: '~ abstract-only' }
  if (/review/.test(n)) return { cls: 'warn', label: '~ review-extracted' }
  if (/unverif/.test(n)) return { cls: 'bad', label: '⚠ unverified' }
  return null
}

// the deep-dive subagent's output — a RESULT LEDGER (paper decomposed into its distinct results)
function ResultLedger({ d }) {
  const s = d.study || {}
  const results = Array.isArray(d.results) ? d.results : []
  const tier = norm(s.journal_tier)
  const tierClass = /top|reputable|high|q1/.test(tier) ? 'good' : /predator|preprint|low|q3|q4|unknown/.test(tier) ? 'warn' : ''
  const tierShort = String(s.journal_tier || '').split(/[—,.;(]/)[0].trim().slice(0, 46)
  const openGood = /yes|public|open|available|github|osf|zenodo|dryad/i.test(String(s.open_data || '')) && !/no\b|not |unclear/i.test(String(s.open_data || ''))
  const critiqued = s.critiques && !/^(none|no known|not )/i.test(String(s.critiques).trim())
  const studyRows = [
    ['design', s.design],
    ['journal', s.journal && `${s.journal}${s.journal_tier ? ` — ${s.journal_tier}` : ''}`],
    ['peer-reviewed', typeof s.peer_reviewed === 'boolean' ? (s.peer_reviewed ? 'yes' : 'no') : s.peer_reviewed],
    ['investigators', s.investigators],
    ['funding', s.funding],
    ['conflicts', s.coi],
    ['open data', s.open_data],
    ['dataset', s.dataset],
    ['critiques / replications', s.critiques],
  ].filter(([, v]) => v)
  const ac = d.authorConclusion || {}
  const acBroad = /broad|underdetermin|stronger|overstat|beyond/i.test(String(ac.assessment || ''))
  return (
    <div className="ledger">
      <div className="prov-chips">
        {s.journal_tier && <span className={`pchip ${tierClass}`} title={s.journal_tier}>{tierClass === 'good' ? '◆ ' : tierClass === 'warn' ? '△ ' : ''}{tierShort}</span>}
        <span className={`pchip ${openGood ? 'good' : 'warn'}`}>{openGood ? '◆ open data' : '△ data not open'}</span>
        {critiqued && <span className="pchip warn">△ critiqued</span>}
        {s.dataset && <span className="pchip" title={`dataset: ${s.dataset}`}>dataset: {String(s.dataset).slice(0, 24)}</span>}
      </div>

      <div className="ld-results">
        <div className="ld-label">
          {results.length} result{results.length === 1 ? '' : 's'} in this paper — reasoning at the result level
        </div>
        {results.map((r, i) => (
          <div className={`result rel-${relClass(r.relation)}`} key={i}>
            <div className="rs-top">
              {r.relation && <span className={`rs-rel rel-${relClass(r.relation)}`}>{r.relation}</span>}
              {r.status && <span className="rs-status">{r.status}</span>}
              {verMeta(r.verification) && <span className={`rs-ver v-${verMeta(r.verification).cls}`}>{verMeta(r.verification).label}</span>}
              {r.estimate && <span className="rs-est">{r.estimate}</span>}
            </div>
            <div className="rs-statement">{r.statement}</div>
            {r.relationNote && <div className="rs-note">→ {r.relationNote}</div>}
            <div className="rs-scope">
              {r.population && <span><b>pop</b> {r.population}</span>}
              {r.exposure && <span><b>exposure</b> {r.exposure}</span>}
              {r.outcome && <span><b>outcome</b> {r.outcome}</span>}
              {r.n && <span><b>n</b> {r.n}</span>}
              {r.model && <span><b>model</b> {r.model}</span>}
            </div>
            {r.locus && <div className="rs-locus" title="passage pointer — spot-check here">↳ {r.locus}</div>}
          </div>
        ))}
      </div>

      {ac.text && (
        <div className={`ld-author${acBroad ? ' broad' : ''}`}>
          <span className="rlabel">author's conclusion — a claim, not the data</span>
          <div className="au-text">“{ac.text}”</div>
          {ac.assessment && <div className="au-assess">{acBroad ? '⚠ ' : ''}{ac.assessment}</div>}
        </div>
      )}

      {studyRows.length > 0 && (
        <details className="ld-study">
          <summary>study-level provenance (shared by every result above)</summary>
          <div className="prov-grid">
            {studyRows.map(([k, v]) => (
              <div className={`prov-row${k === 'critiques / replications' && critiqued ? ' hot' : ''}`} key={k}>
                <span className="prov-k">{k}</span>
                <span className="prov-v">{String(v)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function FindingCard({ f, question, axisName, rkey, onLedger, initialLedger }) {
  const coi = f.coi && !/^none/i.test(String(f.coi))
  const conf = norm(f.confidence)
  const [dd, setDd] = useState(initialLedger || null) // null | 'loading' | result | {error}
  async function deepdive() {
    setDd('loading')
    logInteraction(question, 'human', 'deep-dive', { source: f.source, claim: f.claim })
    try {
      const r = await fetch('/api/deepdive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: getModel(), question, axis: axisName, claim: f.claim, source: f.source, url: f.url }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setDd(j)
      onLedger?.(rkey, j) // lift the result records into the shared store for the matrix + decide
    } catch (e) {
      setDd({ error: String(e.message || e) })
    }
  }
  return (
    <div className={`finding conf-${conf}`}>
      <div className="finding-claim">{f.claim}</div>
      {f.relevance && <div className="finding-rel">for you: {f.relevance}</div>}
      <div className="finding-tags">
        {f.supports && <span className="tag t-supports">→ {f.supports}</span>}
        {f.kind && <span className="tag t-kind">{f.kind}</span>}
        {f.n && <span className="tag t-n">n={f.n}</span>}
        {f.dataset && !/^(unclear|primary study|n\/a|none)/i.test(String(f.dataset).trim()) && (
          <span className="tag t-dataset" title="underlying dataset — for dependence grouping">◇ {String(f.dataset).slice(0, 40)}</span>
        )}
        {f.confidence && <span className={`tag t-conf c-${conf}`}>{f.confidence}</span>}
        {coi && <span className="tag t-coi">⚠ {f.coi}</span>}
      </div>
      {f.scope && typeof f.scope === 'object' && (() => {
        const ent = Object.entries(f.scope).filter(([, v]) => v && !/n\/?a|unknown/i.test(String(v)))
        return ent.length ? (
          <div className="scope-chips" title="distance of this evidence from YOUR scope (per the applicability profile)">
            {ent.map(([k, v]) => <span key={k} className={`schip s-${norm(v)}`}>{k} · {v}</span>)}
            {f.scopeNote && <span className="schip snote">{f.scopeNote}</span>}
          </div>
        ) : null
      })()}
      <div className="finding-foot">
        {f.url && (
          <a className="finding-src" href={f.url} target="_blank" rel="noreferrer">
            {f.source || f.url}
            {f.year ? ` · ${f.year}` : ''} ↗
          </a>
        )}
        <button className="dd-btn" onClick={deepdive} disabled={dd === 'loading'}>
          {dd === 'loading' ? '🔬 subagent digging…' : dd && !dd.error ? '↻ re-dig' : '🔬 deep-dive → results'}
        </button>
      </div>
      {dd === 'loading' && (
        <div className="dd-working">
          <span className="scan" />
          <span>a subagent is decomposing the paper into its distinct results, tagging each to the claim…</span>
        </div>
      )}
      {dd && dd !== 'loading' && dd.error && <div className="dd-err">deep-dive failed: {dd.error}</div>}
      {dd && dd !== 'loading' && !dd.error && <ResultLedger d={dd} />}
    </div>
  )
}

// dependence grouping — cluster the axis's sources into independent evidence families
function DependencePanel({ axis, findings, question, onFamilies, initialDep }) {
  const [dep, setDep] = useState(initialDep || null) // null | 'loading' | result | {error}
  // reflect the stored grouping (incl. a merge-set _stale flag) when it changes underneath us
  useEffect(() => { setDep(initialDep || null) }, [initialDep])
  async function run() {
    setDep('loading')
    logInteraction(question, 'human', 'group-evidence-families', { axis: axis.name })
    try {
      const r = await fetch('/api/dependence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: getModel(),
          question,
          dimensionName: axis.name,
          findings: findings.map((f) => ({ claim: f.claim, source: f.source, url: f.url, kind: f.kind, dataset: f.dataset, year: f.year })),
        }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setDep(j)
      onFamilies?.(axis.id, j) // lift the evidence families into the shared store for decide
    } catch (e) {
      setDep({ error: String(e.message || e) })
    }
  }
  const done = dep && dep !== 'loading' && !dep.error
  const total = done ? dep.totalSources || findings.length : findings.length
  const indep = done ? dep.independentCount : null
  const inflated = indep != null && total > indep
  const stale = done && dep._stale
  return (
    <div className="dependence">
      {stale && <div className="stale-note">⟳ evidence changed since this grouping — regroup to re-check independence</div>}
      <div className="dep-bar">
        <button className={`lane-run${stale ? ' stale' : ''}`} onClick={run} disabled={dep === 'loading'}>
          {dep === 'loading' ? 'grouping…' : stale ? '↻ regroup (stale)' : done ? '↻ regroup' : '⚖ group by evidence family'}
        </button>
        {indep != null && (
          <span className={`dep-count${inflated ? ' inflated' : ''}`}>
            <b>{total}</b> sources → <b>{indep}</b> independent {indep === 1 ? 'family' : 'families'}
          </span>
        )}
      </div>
      {dep === 'loading' && (
        <div className="dd-working">
          <span className="scan" />
          <span>checking which sources share a cohort, dataset, or team — correlated evidence is not independent votes…</span>
        </div>
      )}
      {dep && dep.error && <div className="dd-err">{dep.error}</div>}
      {done && (
        <>
          {dep.note && <div className={`dep-note${inflated ? ' inflated' : ''}`}>{dep.note}</div>}
          <div className="dep-families">
            {(dep.families || []).map((fam, i) => {
              const members = fam.members || []
              return (
                <div className={`dep-fam${members.length > 1 ? ' correlated' : ''}`} key={i}>
                  <div className="df-head">
                    <span className="df-name">{fam.label}</span>
                    <span className="df-count">
                      {members.length} {members.length === 1 ? 'source' : 'sources'}
                      {members.length > 1 ? ' · counts once' : ''}
                    </span>
                  </div>
                  {fam.basis && <div className="df-basis">{fam.basis}</div>}
                  {members.length > 0 && <div className="df-members">{members.join(' · ')}</div>}
                  {fam.note && <div className="df-note">{fam.note}</div>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function ResearchLane({ axis, lane, stats, brief, now, onRun, question, onLedger, onFamilies, ledgers, families }) {
  const status = lane?.status || 'idle'
  const elapsed = lane?.t0 ? ((now - lane.t0) / 1000).toFixed(1) : null
  const findings = lane?.findings || []
  const buckets = (axis.resolutions || []).map((r) => ({ r, n: findings.filter((f) => matchRes(f.supports, r)).length }))
  const other = findings.filter((f) => !(axis.resolutions || []).some((r) => matchRes(f.supports, r))).length
  const v = verdict(stats)
  return (
    <div className={`lane st-${status}`} style={{ '--c': axis.color || 'var(--accent)' }}>
      <div className="lane-head">
        <span className="lane-dot" />
        <span className="lane-name">{axis.name}</span>
        {brief?.role && <span className="lane-role">{brief.role}</span>}
        <span className={`agent-badge ab-${status}`}>
          {status === 'idle' && 'agent idle'}
          {status === 'searching' && <>◍ scouring the web · {elapsed}s</>}
          {status === 'done' && <>✓ {findings.length} findings · {(lane.ms / 1000).toFixed(0)}s</>}
          {status === 'error' && '× failed'}
        </span>
        {status !== 'searching' && (
          <button className="lane-run" onClick={onRun}>
            {status === 'idle' ? 'research →' : '↻ redo'}
          </button>
        )}
      </div>
      {axis.prompt && <div className="lane-prompt">{axis.prompt}</div>}

      {status === 'searching' && (
        <div className="lane-working">
          <span className="scan" />
          <span>searching, reading sources, tagging evidence to “{axis.name}”…</span>
        </div>
      )}
      {status === 'error' && <div className="lane-err">{lane.err}</div>}

      {findings.length > 0 && (
        <>
          <EvidenceBar axis={axis} stats={stats} />
          <div className="lane-buckets">
            <span className={`lane-verdict v-${v.key}`}>{v.label}</span>
            {buckets.map((b, i) => (
              <span key={i} className={`bucket${b.n ? ' hit' : ''}`}>
                {b.r} <b>{b.n}</b>
              </span>
            ))}
            {other > 0 && (
              <span className="bucket other">
                unclear <b>{other}</b>
              </span>
            )}
          </div>
          <div className="findings">
            {findings.map((f, i) => (
              <FindingCard
                key={i}
                f={f}
                question={question}
                axisName={axis.name}
                rkey={`${axis.id}#${i}`}
                onLedger={onLedger}
                initialLedger={ledgers?.[`${axis.id}#${i}`]}
              />
            ))}
          </div>
          <DependencePanel axis={axis} findings={findings} question={question} onFamilies={onFamilies} initialDep={families?.[axis.id]} />
        </>
      )}
    </div>
  )
}

// Stage 3 top: the caring graph — honest COUNTS accumulating live (coverage + findings),
// never a derived "uncertainty %". The meter is axes-covered, an actual ratio; per-row shows
// finding count + a qualitative agree/conflict read.
function GraphState({ axes, statsById }) {
  const examined = axes.filter((a) => statsById[a.id].evidence > 0).length
  const conflicting = axes.filter((a) => {
    const s = statsById[a.id]
    return s.evidence >= 2 && s.topShare < 0.55
  }).length
  const totalFindings = axes.reduce((s, a) => s + (statsById[a.id].evidence || 0), 0)
  const coverage = axes.length ? Math.round((examined / axes.length) * 100) : 0
  return (
    <div className="graphstate">
      <div className="gs-head">
        <div className="gs-title-wrap">
          <span className="rlabel">the caring graph</span>
          <div className="gs-title">evidence across {axes.length} {axes.length === 1 ? 'axis' : 'axes'}</div>
          <div className="gs-note">
            {totalFindings} finding{totalFindings === 1 ? '' : 's'} so far{conflicting ? ` · ${conflicting} ax${conflicting === 1 ? 'is' : 'es'} where findings conflict` : ''} · this
            shows what agents RETRIEVED, not the probability any claim is true
          </div>
        </div>
        <div className="gs-meter">
          <div className="gs-pct">
            <b>{examined}</b>/{axes.length}
          </div>
          <div className="gs-track">
            <span className="gs-fill" style={{ width: coverage + '%' }} />
          </div>
          <div className="gs-meter-label">axes covered</div>
        </div>
      </div>
      <div className="gs-rows">
        {axes.map((a) => {
          const s = statsById[a.id]
          const v = verdict(s)
          return (
            <div className="gs-row" key={a.id} style={{ '--c': a.color || 'var(--accent)' }}>
              <span className="gs-name">{a.name}</span>
              <EvidenceBar axis={a} stats={s} />
              <span className={`gs-verdict v-${v.key}`}>{v.label}</span>
              <span className="gs-count" title="findings retrieved for this axis">{s.evidence || 0}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// claim × source matrix — the cross-examined, mergeable structure (dedup sources by url, claims by meaning)
const MX_GLYPH = { supports: '✚', disputes: '✕', qualifies: '≈', mixed: '±' }
const MX_CLS = { supports: 'sup', disputes: 'dis', qualifies: 'qual', mixed: 'mix' }
function MatrixCell({ cell, open, onOpen }) {
  const v = norm(cell?.verdict)
  if (!cell || !MX_GLYPH[v]) return <span className="mcell m-sil">·</span>
  const n = (cell.results || []).length
  return (
    <button className={`mcell m-${MX_CLS[v]}${open ? ' open' : ''}`} onClick={onOpen} title={(cell.results || []).join(' · ') || v}>
      <span className="mc-glyph">{MX_GLYPH[v]}</span>
      {n > 1 && <span className="mc-n">{n}</span>}
    </button>
  )
}

function AxisMatrix({ axis, findings, ledgers, question }) {
  const [m, setM] = useState(null) // null | 'loading' | result | {error}
  const [openCell, setOpenCell] = useState(null) // { c, s }
  const ddCount = findings.filter((f, i) => (ledgers?.[`${axis.id}#${i}`]?.results || []).length > 0).length
  async function build() {
    setM('loading')
    setOpenCell(null)
    logInteraction(question, 'human', 'cross-examine', { axis: axis.name })
    try {
      const sources = findings.map((f, i) => {
        const led = ledgers?.[`${axis.id}#${i}`]
        const results = led && Array.isArray(led.results)
          ? led.results.slice(0, 8).map((r) => ({ statement: r.statement, relation: r.relation, status: r.status, estimate: r.estimate }))
          : undefined
        return { name: f.source, url: f.url, kind: f.kind, year: f.year, supports: f.supports, ...(results ? { results } : {}) }
      })
      const r = await fetch('/api/matrix', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: getModel(), question, dimensionName: axis.name, resolutions: axis.resolutions || [], sources }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setM(j)
    } catch (e) {
      setM({ error: String(e.message || e) })
    }
  }
  const shorten = (s) => {
    const t = String(s || '').replace(/\(.*?\)/g, '').trim()
    return t.length > 24 ? t.slice(0, 22) + '…' : t
  }
  const cellOf = (cid, sid) => (m?.cells || []).find((x) => x.claim === cid && x.source === sid)
  return (
    <div className="axmatrix" style={{ '--c': axis.color || 'var(--accent)' }}>
      <div className="axm-head">
        <span className="lane-dot" />
        <span className="lane-name">{axis.name}</span>
        <button className="lane-run" onClick={build} disabled={m === 'loading'}>
          {m === 'loading' ? 'cross-examining…' : m && !m.error ? '↻ redo' : `⚖ cross-examine ${findings.length}`}
        </button>
      </div>
      {ddCount > 0 && (
        <div className="mx-hint">reading {ddCount} deep-dived source{ddCount > 1 ? 's' : ''} at the result level · the rest source-level (deep-dive more for richer cells)</div>
      )}
      {m === 'loading' && (
        <div className="lane-working">
          <span className="scan" />
          <span>projecting results onto claims — merging same-claim forms, deduping sources, per-cell result verdicts…</span>
        </div>
      )}
      {m && m !== 'loading' && m.error && <div className="dd-err">{m.error}</div>}
      {m && m !== 'loading' && !m.error && (
        <div className="mx-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th className="mx-corner">claim ＼ source</th>
                {(m.sources || []).map((s) => (
                  <th key={s.id} className="mx-src">
                    <a href={s.url} target="_blank" rel="noreferrer" title={s.name}>
                      {shorten(s.name)}
                    </a>
                    {s.deepDived && <span className="mx-src-dd" title="deep-dived to result level">◆</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(m.claims || []).map((c) => {
                const cells = (m.sources || []).map((s) => cellOf(c.id, s.id))
                const sup = cells.filter((x) => norm(x?.verdict) === 'supports').length
                const dis = cells.filter((x) => norm(x?.verdict) === 'disputes').length
                const mix = cells.filter((x) => ['mixed', 'qualifies'].includes(norm(x?.verdict))).length
                return (
                  <tr key={c.id} className={dis > 0 && sup > 0 ? 'mx-conflict' : ''}>
                    <th className="mx-claim">
                      <span className="mx-claim-text">{c.text}</span>
                      <span className="mx-claim-meta">
                        {c.resolution}
                        {sup ? ` · ${sup}✚` : ''}
                        {dis ? ` · ${dis}✕` : ''}
                        {mix ? ` · ${mix}±` : ''}
                      </span>
                    </th>
                    {(m.sources || []).map((s) => {
                      const isOpen = openCell && openCell.c === c.id && openCell.s === s.id
                      return (
                        <td key={s.id}>
                          <MatrixCell cell={cellOf(c.id, s.id)} open={isOpen} onOpen={() => setOpenCell(isOpen ? null : { c: c.id, s: s.id })} />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {openCell &&
            (() => {
              const cell = cellOf(openCell.c, openCell.s)
              const src = (m.sources || []).find((s) => s.id === openCell.s)
              const clm = (m.claims || []).find((c) => c.id === openCell.c)
              if (!cell) return null
              const v = norm(cell.verdict)
              return (
                <div className="mx-detail">
                  <div className="mxd-head">
                    <b>{src?.name}</b> on “{clm?.text}” — <span className={`mxd-v m-${MX_CLS[v] || 'sil'}`}>{cell.verdict}</span>
                  </div>
                  {(cell.results || []).length > 0 ? (
                    <ul>{cell.results.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  ) : (
                    <div className="mxd-empty">source-level stance — this source wasn't deep-dived into results</div>
                  )}
                </div>
              )
            })()}
          <div className="mx-legend">
            ✚ supports · ✕ disputes · ≈ qualifies · ± mixed · · silent — a number = # of results behind the cell. Click a cell to open its results; a row with both ✚ and ✕ is a live contradiction. ◆ = source read at result level.
          </div>
        </div>
      )}
    </div>
  )
}

function MatrixView({ axes, lanes, ledgers, question }) {
  const withFindings = axes.filter((a) => (lanes[a.id]?.findings || []).length > 0)
  if (!withFindings.length)
    return <div className="mx-empty">Dispatch the agents first — then cross-examine their findings into a claim × source matrix.</div>
  return (
    <div className="matrices">
      {withFindings.map((a) => (
        <AxisMatrix key={a.id} axis={a} findings={lanes[a.id].findings} ledgers={ledgers} question={question} />
      ))}
    </div>
  )
}

// Research state + actions LIFTED into App, so Stage 3 (dispatch) and Stage 4
// (the artifact) read ONE live source — the artifact fills in as agents stream in.
function useResearch({ question, data, pdata, context, committed }) {
  const axes = useMemo(() => {
    const clusters = data?.clusters || []
    if (pdata) {
      const byId = Object.fromEntries((pdata.clusters || []).map((c) => [c.id, c]))
      const open = clusters.filter((c) => (byId[c.id]?.status || 'open') === 'open')
      const news = pdata.newClusters || []
      const picked = [...open, ...news]
      return picked.length ? picked : clusters
    }
    return clusters
  }, [data, pdata])

  const [lanes, setLanes] = useState({})
  const [plan, setPlan] = useState(null) // null | 'planning' | result | {error}
  const [decision, setDecision] = useState(null) // null | 'deciding' | result | {error}
  // canonical result store, populated live by deep-dives + dependence passes; matrix & decide read from it
  const [ledgers, setLedgers] = useState({}) // "axisId#idx" -> result ledger {study, results, authorConclusion}
  const [families, setFamilies] = useState({}) // axisId -> dependence {families, independentCount, ...}
  // the compiled RESEARCH BRIEF — claim portfolio + applicability profile + retrieval plans + parked
  const [brief, setBrief] = useState(null) // null | 'compiling' | result | {error}

  // adopt a research slice into memory (used by initial hydrate + explicit re-hydrate after import)
  const hydrate = (saved) => {
    saved = saved || {}
    setLanes(saved.lanes || {})
    setPlan(saved.plan && saved.plan.agents ? saved.plan : null)
    setBrief(saved.brief && saved.brief.claims ? saved.brief : null)
    setLedgers(saved.ledgers || {})
    setFamilies(saved.families || {})
    setDecision(saved.decision && saved.decision.answer ? saved.decision : null)
  }
  // (re)hydrate whenever a DIFFERENT decomposed investigation becomes active — keyed on the
  // committed question, so typing / dimension edits never clobber it
  useEffect(() => {
    hydrate((committed && question?.trim() && loadInvestigation(question)?.research) || {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, committed])

  // structured Stage-2 outputs the compiler consumes (pinned = applicability facts, dropped = parked)
  const nameOf = (id) => (data?.clusters || []).find((x) => x.id === id)?.name || id
  const pinnedAxes = pdata
    ? (pdata.clusters || []).filter((c) => c.status === 'pinned').map((c) => ({ id: c.id, name: nameOf(c.id), value: c.value || '', reason: c.reason || '' }))
    : []
  const droppedAxes = pdata
    ? (pdata.clusters || []).filter((c) => c.status === 'dropped').map((c) => ({ id: c.id, name: nameOf(c.id), reason: c.reason || '' }))
    : []

  // A.3: persist the research slice (only completed lanes / results — drop in-flight state)
  useEffect(() => {
    const q = question?.trim()
    if (!q || !committed || !data) return
    const doneLanes = Object.fromEntries(Object.entries(lanes).filter(([, l]) => l?.status === 'done'))
    saveInvestigationPatch(q, {
      research: {
        lanes: doneLanes,
        plan: plan && plan.agents ? plan : null,
        brief: brief && brief.claims ? brief : null,
        ledgers,
        families,
        decision: decision && decision.answer ? decision : null,
      },
    })
  }, [lanes, plan, brief, ledgers, families, decision, question, committed, data])
  const onLedger = (k, l) => setLedgers((m) => ({ ...m, [k]: l }))
  const onFamilies = (id, fam) => setFamilies((m) => ({ ...m, [id]: fam }))
  const statsById = useMemo(
    () => Object.fromEntries(axes.map((a) => [a.id, axisStats(a, lanes[a.id]?.findings || [])])),
    [axes, lanes],
  )
  const briefFor = (id) => (plan && plan.agents ? plan.agents.find((a) => a.dimension === id) : null)
  const briefText = (b) => (b ? `${b.focus || ''}${b.crux ? ` — crux: ${b.crux}` : ''}${b.sources ? `; prioritise: ${b.sources}` : ''}`.trim() : '')

  async function compileBrief() {
    setBrief('compiling')
    logInteraction(question?.trim(), 'human', 'compile-brief')
    try {
      const r = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: getModel(),
          question,
          context: context || '',
          pinned: pinnedAxes,
          dropped: droppedAxes,
          axes: axes.map((a) => ({ id: a.id, name: a.name, prompt: a.prompt || '', resolutions: a.resolutions || [] })),
        }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setBrief(j)
    } catch (e) {
      setBrief({ error: String(e.message || e) })
    }
  }
  const claimsFor = (id) => (brief && Array.isArray(brief.claims) ? brief.claims.filter((c) => c.axis === id) : [])
  const applicability = brief && Array.isArray(brief.applicability) ? brief.applicability : []

  async function research(axis) {
    setLanes((l) => ({ ...l, [axis.id]: { status: 'searching', findings: [], t0: Date.now() } }))
    logInteraction(question?.trim(), 'human', 'dispatch-agent', { axis: axis.name })
    try {
      const r = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: getModel(),
          question,
          dimensionName: axis.name,
          dimensionPrompt: axis.prompt || '',
          resolutions: axis.resolutions || [],
          context: context || '',
          claims: claimsFor(axis.id),
          applicability,
          brief: briefText(briefFor(axis.id)),
        }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setLanes((l) => ({
        ...l,
        [axis.id]: {
          status: 'done',
          findings: Array.isArray(j.findings) ? j.findings : [],
          ms: Date.now() - (l[axis.id]?.t0 || Date.now()),
        },
      }))
    } catch (e) {
      setLanes((l) => ({ ...l, [axis.id]: { ...(l[axis.id] || {}), status: 'error', err: String(e.message || e) } }))
    }
  }

  function researchAll() {
    axes.forEach((a) => {
      const st = lanes[a.id]?.status
      if (st !== 'searching' && st !== 'done') research(a)
    })
  }

  async function decide() {
    setDecision('deciding')
    logInteraction(question?.trim(), 'human', 'synthesize-decision')
    try {
      const dimensions = axes
        .filter((a) => (lanes[a.id]?.findings || []).length > 0)
        .map((a) => ({
          name: a.name,
          findings: (lanes[a.id].findings || []).map((f, i) => {
            const led = ledgers[`${a.id}#${i}`]
            const results = led && Array.isArray(led.results)
              ? led.results.map((r) => ({
                  statement: r.statement,
                  relation: r.relation,
                  status: r.status,
                  estimate: r.estimate,
                  population: r.population,
                  verification: r.verification,
                }))
              : undefined
            return {
              claim: f.claim,
              supports: f.supports,
              source: f.source,
              kind: f.kind,
              confidence: f.confidence,
              coi: f.coi,
              year: f.year,
              dataset: f.dataset,
              ...(results ? { results, authorConclusion: led.authorConclusion?.assessment } : {}),
            }
          }),
          ...(families[a.id]?.families
            ? {
                evidenceFamilies: families[a.id].families.map((fam) => ({ label: fam.label, members: fam.members })),
                independentFamilyCount: families[a.id].independentCount,
              }
            : {}),
        }))
      const r = await fetch('/api/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: getModel(), question, context: context || '', applicability, dimensions }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setDecision(j)
    } catch (e) {
      setDecision({ error: String(e.message || e) })
    }
  }

  return { axes, lanes, plan, decision, ledgers, families, brief, applicability, nameOf, statsById, briefFor, onLedger, onFamilies, compileBrief, research, researchAll, decide, hydrate }
}

function ResearchStage({ R, question, data, pdata, context }) {
  const { axes, lanes, plan, decision, ledgers, families, brief, applicability, nameOf, statsById, briefFor, onLedger, onFamilies, compileBrief, research, researchAll, decide } = R
  const [view, setView] = useState('lanes') // lanes | matrix
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!Object.values(lanes).some((l) => l && l.status === 'searching')) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [lanes])

  const anyRunning = axes.some((a) => lanes[a.id]?.status === 'searching')
  const allFindings = axes.flatMap((a) => lanes[a.id]?.findings || [])
  const doneCount = axes.filter((a) => lanes[a.id]?.status === 'done').length
  const started = doneCount > 0 || anyRunning
  const coiCount = allFindings.filter((f) => f.coi && !/^none/i.test(String(f.coi))).length
  const strongCount = allFindings.filter((f) => norm(f.confidence) === 'high').length

  return (
    <div className="research">
      <div className="research-top">
        <div className="research-intro">
          <h3>deep research</h3>
          <p>
            {axes.length} {axes.length === 1 ? 'axis' : 'axes'}
            {pdata ? ' your context left open' : ''}. One agent per axis scours the web and tags every finding back to the
            resolution it settles — the filtered graph filling in.
          </p>
        </div>
        <button className="btn-decompose research-go" onClick={researchAll} disabled={anyRunning}>
          {anyRunning
            ? 'agents working…'
            : `▶ dispatch ${axes.length} ${(brief && brief.claims) || (plan && plan.agents) ? 'briefed ' : ''}${axes.length === 1 ? 'agent' : 'agents'}`}
        </button>
      </div>

      <div className={`research-mode${context ? ' on' : ''}`}>
        {context ? (
          <>
            <b>◆ personalized</b> — agents are biased to evidence about you: <span className="rm-ctx">{context.replace(/\n/g, ' · ')}</span>
          </>
        ) : (
          <>
            <b>△ generic</b> — no context yet. Do <b>2 · contextualize</b> first and the agents will filter to your open axes and prefer evidence about your subgroup.
          </>
        )}
      </div>

      <div className="orch">
        {(!brief || brief === 'compiling' || brief.error) && (
          <button className="orch-btn" onClick={compileBrief} disabled={brief === 'compiling'}>
            {brief === 'compiling' ? '◆ compiling the research brief…' : '◆ compile the research brief'}
          </button>
        )}
        {brief === 'compiling' && (
          <span className="orch-hint">projecting your context into scoped claims, an applicability profile + retrieval plans…</span>
        )}
        {brief && brief.error && <div className="dd-err">compile failed: {brief.error}</div>}
        {brief && brief !== 'compiling' && !brief.error && (
          <div className="plan brief">
            {applicability.length > 0 && (
              <div className="brief-appl">
                <span className="rlabel">applicability profile — your actual scope; every finding is scored by its distance from this</span>
                <div className="appl-chips">
                  {applicability.map((a, i) => (
                    <span
                      key={i}
                      className={`appl-chip${a.use === 'judge-transport-only' ? ' transport' : ''}`}
                      title={a.use === 'judge-transport-only'
                        ? 'kept OUT of outbound searches — used only to judge whether evidence transports to you'
                        : 'constrains what the agents search for'}
                    >
                      <b>{a.field}</b> {a.value}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="brief-claims">
              <span className="rlabel">claim portfolio — {(brief.claims || []).length} scoped claims drive the agents</span>
              {(brief.claims || []).slice().sort((x, y) => (x.priority || 9) - (y.priority || 9)).map((c, i) => {
                const ax = axes.find((x) => x.id === c.axis)
                return (
                  <div className="claim-card" key={i} style={{ '--c': ax?.color || 'var(--accent)' }}>
                    <div className="cc-head">
                      <span className="cc-pri">P{c.priority || '?'}</span>
                      {c.kind && <span className="cc-kind">{c.kind}</span>}
                      <span className="cc-axis">{ax?.name || c.axis}</span>
                    </div>
                    <div className="cc-statement">{c.statement}</div>
                    {(c.population || c.intervention || c.comparator || c.outcome) && (
                      <div className="cc-pico">
                        {c.population && <span><b>pop</b> {c.population}</span>}
                        {c.intervention && <span><b>intervention</b> {c.intervention}</span>}
                        {c.comparator && <span><b>vs</b> {c.comparator}</span>}
                        {c.outcome && <span><b>outcome</b> {c.outcome}</span>}
                      </div>
                    )}
                    {c.wouldChange && <div className="cc-would">would change the decision · {c.wouldChange}</div>}
                    {Array.isArray(c.queries) && c.queries.length > 0 && (
                      <div className="cc-queries">{c.queries.map((q, k) => <code key={k}>{q}</code>)}</div>
                    )}
                    {Array.isArray(c.relaxation) && c.relaxation.length > 0 && (
                      <div className="cc-ladder" title="when direct evidence is sparse the agent relaxes ONE constraint at a time, recording the distance">
                        {c.relaxation.join(' → ')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {Array.isArray(brief.parked) && brief.parked.length > 0 && (
              <div className="brief-parked">
                <span className="rlabel">parked — zero research budget, preserved</span>
                {brief.parked.map((pk, i) => (
                  <div className="parked-row" key={i}>
                    <b>{pk.name || nameOf(pk.axis)}</b>
                    {pk.reactivate ? <span> — reopens if: {pk.reactivate}</span> : null}
                  </div>
                ))}
              </div>
            )}
            {brief.privacyNote && <div className="brief-privacy">🔒 {brief.privacyNote}</div>}
            <button className="orch-btn re" onClick={compileBrief}>↻ recompile</button>
          </div>
        )}
      </div>

      <GraphState axes={axes} statsById={statsById} />

      {started && (
        <div className="decide">
          <div className="decide-bar">
            <button className={`btn-decompose${decision && decision._stale ? ' stale' : ''}`} onClick={decide} disabled={decision === 'deciding'}>
              {decision === 'deciding'
                ? 'synthesizing your answer…'
                : decision && decision._stale
                  ? '↻ re-synthesize (new evidence)'
                  : decision && !decision.error
                    ? '↻ re-synthesize'
                    : '▶ synthesize the answer'}
            </button>
            {decision === 'deciding' && <span className="orch-hint">reading the graph, weighing conflicts, calibrating confidence…</span>}
            {decision && decision.error && <span className="dd-err">{decision.error}</span>}
            {(() => {
              const rc = Object.values(ledgers).reduce((s, l) => s + (Array.isArray(l?.results) ? l.results.length : 0), 0)
              const fa = Object.keys(families).length
              return rc > 0 || fa > 0 ? (
                <span className="decide-src">
                  reads {rc} result-level record{rc === 1 ? '' : 's'}
                  {fa > 0 ? ` · ${fa} ${fa === 1 ? 'axis' : 'axes'} grouped into families` : ''}
                </span>
              ) : null
            })()}
          </div>
          {decision && decision !== 'deciding' && !decision.error && (
            <div className={`decision-panel${decision._stale ? ' stale' : ''}`}>
              {decision._stale && (
                <div className="stale-note">⟳ new evidence merged in since this answer — re-synthesize to reflect it</div>
              )}
              <div className="dp-head">
                <span className={`dp-stance st-${norm(decision.stance).replace(/[^a-z]/g, '')}`}>{decision.stance}</span>
                <div className="dp-answer">{decision.answer}</div>
              </div>
              <div className="dp-cols">
                <div className="dp-for">
                  <span className="rlabel">for</span>
                  <ul>{(decision.for || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
                <div className="dp-against">
                  <span className="rlabel">against</span>
                  <ul>{(decision.against || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              </div>
              {decision.crux && (
                <div className="dp-crux">
                  <span className="rlabel">the crux</span>
                  {decision.crux}
                </div>
              )}
              {decision.decisiveTest && (
                <div className="dp-test">
                  <span className="rlabel">an n=1 test that would inform this (may not fully resolve it)</span>
                  {decision.decisiveTest}
                </div>
              )}
              <div className="dp-conf">
                <span className={`dp-conf-chip c-${norm(decision.confidence)}`}>{decision.confidence} confidence</span>
                <span className="dp-conf-note">{decision.confidenceNote}</span>
              </div>
              {(decision.missing || []).length > 0 && (
                <div className="dp-missing">
                  <span className="rlabel">not yet represented — worth collecting</span>
                  <ul>{decision.missing.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {started && (
        <div className="research-summary">
          <span>
            <b>{allFindings.length}</b> findings
          </span>
          <span>
            <b>{new Set(allFindings.map((f) => f.url)).size}</b> sources
          </span>
          <span>
            <b>{strongCount}</b> high-confidence
          </span>
          <span className={coiCount ? 'coi-live' : ''}>
            <b>{coiCount}</b> conflicts flagged
          </span>
          <span className="prog">
            {doneCount}/{axes.length} agents done
          </span>
        </div>
      )}

      {started && (
        <div className="view-toggle">
          <button className={view === 'lanes' ? 'on' : ''} onClick={() => setView('lanes')}>
            lanes
          </button>
          <button className={view === 'matrix' ? 'on' : ''} onClick={() => setView('matrix')}>
            claim × source matrix
          </button>
        </div>
      )}

      {view === 'matrix' ? (
        <MatrixView axes={axes} lanes={lanes} ledgers={ledgers} question={question} />
      ) : (
        <div className="lanes">
          {axes.map((a) => (
            <ResearchLane
              key={a.id}
              axis={a}
              lane={lanes[a.id]}
              stats={statsById[a.id]}
              brief={briefFor(a.id)}
              now={now}
              onRun={() => research(a)}
              question={question}
              onLedger={onLedger}
              onFamilies={onFamilies}
              ledgers={ledgers}
              families={families}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Stage 4 · THE ARTIFACT — a navigable typed graph over the persisted investigation (read-only view)
function Stage4Artifact({ R, question, data, pdata }) {
  // live: reads the SAME research state Stage 3 writes, so the artifact fills in
  // in real time as agents return and deep-dives resolve
  const { axes = [], lanes = {}, ledgers = {}, families = {}, decision: dec } = R || {}
  const decision = dec && dec.answer ? dec : null
  const searching = axes.filter((a) => lanes[a.id]?.status === 'searching')
  const anyRunning = searching.length > 0
  const [openDim, setOpenDim] = useState(null)

  const clusters = data?.clusters || []
  const statusById = Object.fromEntries((pdata?.clusters || []).map((c) => [c.id, c]))
  const dims = [
    ...clusters.map((c) => ({ ...c, status: pdata ? statusById[c.id]?.status || 'open' : 'open', value: statusById[c.id]?.value, reason: statusById[c.id]?.reason })),
    ...(pdata?.newClusters || []).map((c) => ({ ...c, status: 'new' })),
  ]
  const order = { open: 0, new: 1, pinned: 2, dropped: 3 }
  dims.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))

  const statsFor = (d) => axisStats(d, lanes[d.id]?.findings || [])
  const examined = dims.filter((d) => (lanes[d.id]?.findings || []).length > 0)
  const totalFindings = Object.values(lanes).reduce((s, l) => s + (l.findings?.length || 0), 0)
  const totalResults = Object.values(ledgers).reduce((s, l) => s + (l.results?.length || 0), 0)
  const deepDived = Object.keys(ledgers).length // findings taken to result level — the real depth signal
  const label = { pinned: '✓ pinned', open: '○ open', dropped: '— dropped', new: '＋ new' }

  return (
    <div className="artifact">
      {anyRunning && (
        <div className="art-live">
          <span className="art-live-pulse" />
          {searching.length} agent{searching.length === 1 ? '' : 's'} still searching — the graph is filling in live
          <span className="art-live-names">{searching.map((a) => a.name).join(' · ')}</span>
        </div>
      )}
      {decision ? (
        <div className={`art-decision${decision._stale ? ' stale' : ''}`}>
          {decision._stale && (
            <div className="stale-note">⟳ new evidence merged in since this was synthesized — re-synthesize in <b>3 · research</b> for an answer that reflects it</div>
          )}
          <div className="dp-head">
            <span className={`dp-stance st-${norm(decision.stance).replace(/[^a-z]/g, '')}`}>{decision.stance}</span>
            <div className="dp-answer">{decision.answer}</div>
          </div>
          {decision.crux && (
            <div className="dp-crux">
              <span className="rlabel">the crux</span>
              {decision.crux}
            </div>
          )}
          <div className="dp-conf">
            <span className={`dp-conf-chip c-${norm(decision.confidence)}`}>{decision.confidence} confidence</span>
            <span className="dp-conf-note">{decision.confidenceNote}</span>
          </div>
        </div>
      ) : (
        <div className="art-nodecision">
          No synthesis yet — run <b>▶ synthesize the answer</b> in the <b>3 · research</b> tab and it appears here.
        </div>
      )}

      <div className="art-overview">
        <span>
          <b>{dims.length}</b> dimensions
        </span>
        <span>
          <b>{examined.length}</b> examined
        </span>
        <span>
          <b>{totalFindings}</b> findings · <b>{totalResults}</b> result-level records
        </span>
        <span className="art-agg" title="findings taken to result level (source read, results extracted) — shallow findings are agent summaries only">
          <b>{deepDived}</b>/{totalFindings} deep-dived
        </span>
      </div>

      <div className="art-dims">
        {dims.map((d) => {
          const findings = lanes[d.id]?.findings || []
          const st = statsFor(d)
          const v = verdict(st)
          const fam = families[d.id]
          const isOpen = openDim === d.id
          return (
            <div className={`art-dim st-${d.status}`} key={d.id} style={{ '--c': d.color || 'var(--accent)' }}>
              <button className="art-dim-head" onClick={() => setOpenDim(isOpen ? null : d.id)}>
                <span className="art-chev">{isOpen ? '⌃' : '⌄'}</span>
                <span className="art-dot" />
                <span className="art-dim-name">{d.name}</span>
                <span className={`art-status s-${d.status}`}>{label[d.status] || d.status}</span>
                {findings.length > 0 ? (
                  <span className={`art-dim-metrics v-${v.key}`}>
                    {v.label} · {findings.length} findings{fam ? ` · ${fam.independentCount} independent` : ''}
                  </span>
                ) : (
                  <span className="art-dim-metrics unexamined">{d.status === 'pinned' ? 'settled by your context' : 'no evidence collected'}</span>
                )}
              </button>
              {d.status === 'pinned' && d.value && <div className="art-pinned">you: {d.value}</div>}
              {isOpen && (
                <div className="art-dim-body">
                  {findings.length > 0 && <EvidenceBar axis={d} stats={st} />}
                  {(d.resolutions || []).map((r, ri) => {
                    const fs = findings.filter((f) => matchRes(f.supports, r))
                    if (!fs.length) return (
                      <div className="art-res empty" key={ri}>
                        <div className="art-res-head">{r} <span className="art-res-n">0</span></div>
                      </div>
                    )
                    return (
                      <div className="art-res" key={ri}>
                        <div className="art-res-head">
                          {r} <span className="art-res-n">{fs.length}</span>
                        </div>
                        {fs.map((f, fi) => {
                          const idx = findings.indexOf(f)
                          const led = ledgers[`${d.id}#${idx}`]
                          return (
                            <div className="art-ev" key={fi}>
                              <div className="art-ev-claim">{f.claim}</div>
                              <div className="art-ev-meta">
                                {f.source && (
                                  <a href={f.url} target="_blank" rel="noreferrer" className="art-ev-src">
                                    {f.source}
                                    {f.year ? ` ${f.year}` : ''} ↗
                                  </a>
                                )}
                                {f.confidence && <span className={`tag t-conf c-${norm(f.confidence)}`}>{f.confidence}</span>}
                                {led?.results?.length ? <span className="art-ev-dd" title="deep-dived into results">◆ {led.results.length} results</span> : null}
                                {f.coi && !/^none/i.test(String(f.coi)) && <span className="tag t-coi">⚠ COI</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                  {fam?.families?.length ? (
                    <div className="art-families">
                      <span className="rlabel">independent evidence families ({fam.independentCount})</span>
                      <div className="art-fam-list">
                        {fam.families.map((ff, i) => (
                          <span key={i} className={`art-fam${(ff.members || []).length > 1 ? ' corr' : ''}`} title={ff.basis}>
                            {ff.label} <b>({(ff.members || []).length})</b>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {d.reason && <div className="art-reason">{d.reason}</div>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {((decision?.missing || []).length > 0 || dims.some((d) => (d.status === 'open' || d.status === 'new') && !(lanes[d.id]?.findings || []).length)) && (
        <div className="art-missing">
          <span className="rlabel">what's missing / not yet collected</span>
          <ul>
            {(decision?.missing || []).map((mm, i) => <li key={'m' + i}>{mm}</li>)}
            {dims
              .filter((d) => (d.status === 'open' || d.status === 'new') && !(lanes[d.id]?.findings || []).length)
              .map((d, i) => <li key={'u' + i}>“{d.name}” — open but not yet researched</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [phase, setPhase] = useState('landing') // landing | loading | clustered | error
  const [data, setData] = useState(null)
  const [tokens, setTokens] = useState([])
  const [err, setErr] = useState('')
  const [loadStep, setLoadStep] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [durations, setDurations] = useState(() => getDurations())
  const [fromCache, setFromCache] = useState(false)
  const [everDecomposed, setEverDecomposed] = useState(false)
  const [activated, setActivated] = useState([])
  const [charsShown, setCharsShown] = useState(0)
  const [introMoved, setIntroMoved] = useState(false)
  const [boxReady, setBoxReady] = useState(false)
  const [personalized, setPersonalized] = useState(false)
  const [personalizing, setPersonalizing] = useState(false)
  const [pdata, setPdata] = useState(null)
  const [elicitAns, setElicitAns] = useState({})
  const [ctxText, setCtxText] = useState('')
  const [ctxSummary, setCtxSummary] = useState('')
  const [step, setStep] = useState(1)
  const [qOpen, setQOpen] = useState(false) // the question paragraph is collapsed by default once docked
  const [activeDim, setActiveDim] = useState(null) // stage-1: the dimension shown on the right / lit in the question
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modelPref, setModelPrefState] = useState(() => getModel() || '')
  const [meName, setMeNameState] = useState(() => getMe().name || '')
  const [promptsOpen, setPromptsOpen] = useState(false)
  const [prompts, setPrompts] = useState(null)
  // research state lives HERE (not inside a step) so it survives step 3↔4 and the
  // Stage-4 artifact renders live as agents/deep-dives stream in
  const R = useResearch({ question, data, pdata, context: ctxSummary, committed: phase === 'clustered' })
  const importRef = useRef(null)
  const [importMsg, setImportMsg] = useState(null) // {mode, addedFindings, ...} | {error}
  async function handleImportFile(e) {
    const f = e.target.files && e.target.files[0]
    e.target.value = '' // allow re-importing the same file
    if (!f) return
    try {
      const text = await f.text()
      const res = ingestInvestigationFile(text, question)
      const saved = loadInvestigation(res.question)
      if (saved && saved.data) loadInto(res.question, saved) // open (or refresh) the merged investigation
      R.hydrate(saved?.research) // adopt the merged evidence into live state (same render — no stale re-persist)
      setImportMsg(res)
      setTimeout(() => setImportMsg(null), 9000)
    } catch (err) {
      setImportMsg({ error: String(err.message || err) })
      setTimeout(() => setImportMsg(null), 9000)
    }
  }
  async function openPrompts() {
    setSettingsOpen(false)
    setPromptsOpen(true)
    if (!prompts) {
      try {
        const r = await fetch('/api/prompts')
        setPrompts(await r.json())
      } catch {
        setPrompts([])
      }
    }
  }

  const wordRefs = useRef({})
  const taRef = useRef(null)

  // intro: type "epistack" one char at a time, hold 1.4s, then move to the corner
  useEffect(() => {
    if (prefersReduced) {
      setCharsShown(8)
      setIntroMoved(true)
      return
    }
    let c = 0
    let holdT
    const iv = setInterval(() => {
      c += 1
      setCharsShown(c)
      if (c >= 8) {
        clearInterval(iv)
        holdT = setTimeout(() => setIntroMoved(true), 1400)
      }
    }, 145)
    return () => {
      clearInterval(iv)
      clearTimeout(holdT)
    }
  }, [])

  // once epistack has settled in the corner, pause ~0.4s, then reveal the box
  useEffect(() => {
    if (!introMoved) return
    if (prefersReduced) {
      setBoxReady(true)
      return
    }
    const t = setTimeout(() => setBoxReady(true), 1400) // ~1s move + 0.4s pause
    return () => clearTimeout(t)
  }, [introMoved])

  // auto-grow the question box to fit its content
  useLayoutEffect(() => {
    const ta = taRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = ta.scrollHeight + 'px'
    }
  }, [question, introMoved, phase])

  useEffect(() => {
    if (phase !== 'loading') return
    setLoadStep(0)
    setElapsed(0)
    const start = performance.now()
    const stepIv = setInterval(() => setLoadStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 3000)
    const tickIv = setInterval(() => setElapsed((performance.now() - start) / 1000), 200)
    return () => {
      clearInterval(stepIv)
      clearInterval(tickIv)
    }
  }, [phase])

  // A.3: persist the app-slice (context, personalization, step) as it changes
  useEffect(() => {
    if (phase !== 'clustered' || !data) return
    saveInvestigationPatch(question.trim(), { data, tokens, pdata, context: ctxSummary, elicitAns, ctxText, step })
  }, [phase, data, pdata, ctxSummary, elicitAns, ctxText, step, question, tokens])

  // stage 1: keep an active dimension (default the first)
  useEffect(() => {
    if (phase !== 'clustered') return
    const ids = (data?.clusters || []).map((c) => c.id)
    setActiveDim((cur) => (cur && ids.includes(cur) ? cur : ids[0] || null))
  }, [data, phase])

  // hydrate the whole UI from a stored investigation (shared by decompose-restore + import)
  function loadInto(q, saved, atStep) {
    setQuestion(q)
    setEverDecomposed(true)
    const toks = tokenize(q)
    setTokens(saved.tokens && saved.tokens.length ? saved.tokens : toks)
    setData(saved.data)
    setPdata(saved.pdata || null)
    setPersonalized(!!saved.pdata)
    setCtxSummary(saved.context || '')
    setElicitAns(saved.elicitAns || {})
    setCtxText(saved.ctxText || '')
    setStep(atStep || saved.step || 1)
    setFromCache(true)
    setErr('')
    setActivated([])
    setPhase('clustered')
  }

  async function decompose() {
    const q = question.trim()
    if (!q) return
    setEverDecomposed(true)
    const toks = tokenize(q)
    setErr('')
    setActivated([])
    // full restore: a saved investigation brings back context, personalization + research too
    const saved = loadInvestigation(q)
    if (saved && saved.data) {
      loadInto(q, saved)
      return
    }
    setTokens(toks)
    setPersonalized(false)
    setPdata(null)
    setElicitAns({})
    setCtxText('')
    setCtxSummary('')
    setStep(1)
    setFromCache(false)
    setData(null)
    setPhase('loading')
    logInteraction(q, 'human', 'ask-question', { question: q, model: getModel() || 'default' })
    const t0 = performance.now()
    try {
      const r = await fetch('/api/decompose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: getModel(), question: q, tokens: toks }),
      })
      const j = await r.json()
      if (!r.ok || j.error) {
        setErr(j.error ? `${j.error}${j.detail ? ' — ' + j.detail : ''}` : `HTTP ${r.status}`)
        setPhase('error')
        return
      }
      setDurations(pushDuration(performance.now() - t0))
      saveInvestigationPatch(q, { data: j, tokens: toks })
      setData(j)
      setPhase('clustered')
    } catch (e) {
      setErr(String(e.message || e))
      setPhase('error')
    }
  }

  async function handlePersonalize() {
    setPersonalizing(true)
    setErr('')
    const answers = (data?.elicit || []).map((q) => ({ q: q.question, a: elicitAns[q.id] })).filter((x) => x.a)
    const context = [ctxText.trim(), ...answers.map((x) => `${x.q} → ${x.a}`)].filter(Boolean).join('\n')
    if (!context) {
      setPersonalizing(false)
      return
    }
    setCtxSummary(context)
    logInteraction(question.trim(), 'human', 'submit-context', { context })
    try {
      const r = await fetch('/api/personalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: getModel(),
          question: question.trim(),
          clusters: data.clusters.map((c) => ({ id: c.id, name: c.name, resolutions: c.resolutions })),
          context,
        }),
      })
      const j = await r.json()
      if (!r.ok || j.error) {
        setErr(j.error || `HTTP ${r.status}`)
        setPersonalizing(false)
        return
      }
      setPdata(j)
      setPersonalized(true)
    } catch (e) {
      setErr(String(e.message || e))
    }
    setPersonalizing(false)
  }

  function reset() {
    setPhase('landing')
    setData(null)
    setErr('')
    setActivated([])
    setPersonalized(false)
    setPdata(null)
    setElicitAns({})
    setCtxText('')
    setCtxSummary('')
    wordRefs.current = {}
  }

  const onActivate = (id) => setActivated((a) => (a.includes(id) ? a : [...a, id]))
  // per-token cluster memberships (many-to-many) from each dimension's highlightQuotes
  const tokenMembers = useMemo(() => computeTokenMembers(tokens, data?.clusters || []), [tokens, data])
  const clusterById = (id) => (data?.clusters || []).find((c) => c.id === id)
  // click a word in the collapsed header → jump to step 1 with that dimension active
  const scrollToWordCluster = (i) => {
    const id = tokenMembers[i] && tokenMembers[i][0]
    if (!id) return
    setStep(1)
    setActiveDim(id)
  }
  const colorFor = (i) => {
    const m = tokenMembers[i]
    return m && m.length ? clusterById(m[0])?.color || null : null
  }

  // --- stage-1 editability: every dimension/resolution is a proposal you can override ---
  const updateCluster = (id, patch) =>
    setData((d) => ({ ...d, clusters: d.clusters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  const mapRes = (id, fn) =>
    setData((d) => ({ ...d, clusters: d.clusters.map((c) => (c.id === id ? { ...c, resolutions: fn(c.resolutions || []) } : c)) }))
  const iq = () => question.trim()
  const editHandlers = {
    name: (id, name) => { updateCluster(id, { name }); logInteraction(iq(), 'human', 'rename-dimension', { id, to: name }) },
    prompt: (id, prompt) => { updateCluster(id, { prompt }); logInteraction(iq(), 'human', 'edit-dimension-prompt', { id }) },
    res: (id, idx, text) => { mapRes(id, (rs) => rs.map((r, i) => (i === idx ? text : r))); logInteraction(iq(), 'human', 'edit-resolution', { id, idx }) },
    addRes: (id) => { mapRes(id, (rs) => [...rs, '']); logInteraction(iq(), 'human', 'add-resolution', { id }) },
    addResWith: (id, text) => { mapRes(id, (rs) => [...rs, text]); logInteraction(iq(), 'human', 'accept-ai-resolution', { id, text }) },
    delRes: (id, idx) => { mapRes(id, (rs) => rs.filter((_, i) => i !== idx)); logInteraction(iq(), 'human', 'delete-resolution', { id, idx }) },
    delDim: (id) => { setData((d) => ({ ...d, clusters: d.clusters.filter((c) => c.id !== id) })); logInteraction(iq(), 'human', 'prune-dimension', { id }) },
  }
  function addCluster() {
    const palette = ['#E0574E', '#2E86DE', '#17A398', '#B5179E', '#E8A32B', '#8A72E0']
    const id = 'custom-' + Date.now()
    setData((d) => ({
      ...d,
      clusters: [...(d.clusters || []), { id, name: '', color: palette[(d.clusters?.length || 0) % palette.length], prompt: '', resolutions: [''] }],
    }))
    setActivated((a) => (a.includes(id) ? a : [...a, id]))
    setActiveDim(id) // show the new blank dimension on the right so you can fill it in
    logInteraction(iq(), 'human', 'add-dimension', { id })
  }

  const estMs = median(durations)
  const est = estMs ? Math.round(estMs / 1000) : null
  const eta = est != null ? Math.max(0, est - Math.round(elapsed)) : null
  const docked = phase !== 'landing'

  return (
    <div className={`app ${docked ? 'docked' : 'landing'}`}>
      {importMsg && (
        <div className={`import-toast${importMsg.error ? ' err' : ''}`} onClick={() => setImportMsg(null)}>
          {importMsg.error ? (
            <>import failed — {importMsg.error}</>
          ) : (
            <>
              <b>{importMsg.mode === 'merged' ? 'merged in' : 'opened'}{importMsg.byName ? ` ${importMsg.byName}'s` : ' an'} investigation</b>
              {importMsg.mode === 'merged' ? (
                <span>
                  {' '}+{importMsg.addedFindings} new finding{importMsg.addedFindings === 1 ? '' : 's'}
                  {importMsg.addedDimensions ? ` · +${importMsg.addedDimensions} dimension${importMsg.addedDimensions === 1 ? '' : 's'}` : ''}
                  {importMsg.axes.length ? ` across ${importMsg.axes.length} ax${importMsg.axes.length === 1 ? 'is' : 'es'}` : ' (nothing new — already had it all)'}
                </span>
              ) : (
                <span> — {importMsg.addedFindings} finding{importMsg.addedFindings === 1 ? '' : 's'} loaded</span>
              )}
            </>
          )}
        </div>
      )}
      <div className="settings">
        <button className="settings-gear" onClick={() => setSettingsOpen((o) => !o)} title="settings — pick the model" aria-label="settings">
          ⚙{modelPref && <span className="settings-badge">{MODELS.find((m) => m.v === modelPref)?.label || modelPref}</span>}
        </button>
        {settingsOpen && (
          <>
            <div className="settings-scrim" onClick={() => setSettingsOpen(false)} />
            <div className="settings-pop">
              <div className="sp-title">
                model for <code>claude -p</code>
              </div>
              {MODELS.map((m) => (
                <button
                  key={m.v}
                  className={`sp-opt${modelPref === m.v ? ' on' : ''}`}
                  onClick={() => {
                    setModelPref(m.v)
                    setModelPrefState(m.v)
                    logInteraction(question.trim(), 'human', 'set-model', { model: m.v || 'default' })
                  }}
                >
                  <span className="sp-name">{m.label}</span>
                  <span className="sp-note">{m.note}</span>
                </button>
              ))}
              <button className="sp-link" onClick={openPrompts}>⌗ inspect the prompts →</button>
              <div className="sp-name-row">
                <label className="sp-name-label">your name — stamped on evidence you share, so collaborators know who found what</label>
                <input
                  className="sp-name-input"
                  value={meName}
                  placeholder="anonymous"
                  onChange={(e) => { setMeNameState(e.target.value); setMeName(e.target.value) }}
                />
              </div>
              <div className="sp-foot">applies to every AI call, from the next one on</div>
            </div>
          </>
        )}
      </div>

      {promptsOpen && (
        <div className="prompts-overlay">
          <div className="po-head">
            <div>
              <b>the prompts that drive every agent</b>
              <div className="po-sub">rendered with «placeholder» inputs — the exact templates behind each AI call</div>
            </div>
            <button className="po-close" onClick={() => setPromptsOpen(false)}>✕ close</button>
          </div>
          <div className="po-body">
            {!prompts && <div className="po-loading">loading…</div>}
            {prompts && !prompts.length && <div className="po-loading">couldn't load the prompts.</div>}
            {(prompts || []).map((p, i) => (
              <div className="po-item" key={i}>
                <div className="po-item-head">
                  <b>{p.name}</b>
                  <span className="po-route">{p.route}</span>
                  <span className={`po-tools${p.tools !== 'none' ? ' web' : ''}`}>{p.tools === 'none' ? 'no tools' : `⟨${p.tools}⟩`}</span>
                </div>
                <pre className="po-text">{p.text}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`brand ${introMoved ? 'moved' : 'center'}`}>
        <b>{'epistack'.slice(0, charsShown)}</b>
        {charsShown < 8 && !prefersReduced && <span className="caret" aria-hidden="true" />}
      </div>

      <div className={`stage ${docked ? '' : 'centered'}${!everDecomposed ? ' intro' : ''}`}>
        <div className="ask">
          {!docked && boxReady && (
            <div className="ask-row">
              <textarea
                ref={taRef}
                className="question"
                aria-label="Your question"
                placeholder="what is your question?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') decompose()
                }}
                rows={2}
              />
              <button className="btn-icon" onClick={decompose} disabled={!question.trim()} aria-label="Decompose the question">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="4.5" cy="12" r="2.2" />
                  <circle cx="19.5" cy="5" r="2" />
                  <circle cx="19.5" cy="12" r="2" />
                  <circle cx="19.5" cy="19" r="2" />
                  <path d="M6.6 11 L17.4 5.6 M6.7 12 L17.3 12 M6.6 13 L17.4 18.4" />
                </svg>
                <span className="btn-tip">
                  <b>decompose ⌘↵</b>
                  break the question into its hidden axes of ambiguity
                </span>
              </button>
            </div>
          )}

          {docked && (
            <div className="docked-q">
              <div className="dq-head">
                <button className="dq-icon reset-btn" onClick={reset} title="ask another question" aria-label="ask another question">↺</button>
                <button className="dq-toggle" onClick={() => setQOpen((o) => !o)} aria-expanded={qOpen} title={qOpen ? 'collapse the question' : 'expand the question'}>
                  <span className="dq-chev">{qOpen ? '⌃' : '⌄'}</span>
                  {!qOpen && <span className="dq-preview">{question.length > 72 ? question.slice(0, 72) + '…' : question}</span>}
                </button>
                {fromCache && <span className="cached-chip" title="cached">⚡</span>}
                {phase === 'clustered' && data && (
                  <button className="dq-icon dq-export" onClick={() => exportInvestigation(question.trim())} title="Export the whole investigation as JSON — your question, your edits/prunes/context + full interaction timeline (human), and every finding, deep-dive result record, evidence family & the decision (AI). Share it so a collaborator can merge in their evidence." aria-label="export investigation">⤓</button>
                )}
                <button className="dq-icon dq-import" onClick={() => importRef.current?.click()} title="Import a collaborator's exported investigation. Same question → their evidence (findings, result records, families) MERGES into yours, attributed and deduped; your context and decision stay yours. A new question → opens theirs." aria-label="import investigation">⤒</button>
                <input ref={importRef} type="file" accept="application/json,.json" onChange={handleImportFile} style={{ display: 'none' }} />
                {phase === 'clustered' && data && (
                  <div className="stepper">
                    {[[1, 'expand'], [2, 'contextualize'], [3, 'research'], [4, 'artifact']].map(([n, label]) => (
                      <button key={n} className={`step-tab${step === n ? ' on' : ''}`} onClick={() => setStep(n)} title={label}>
                        <span className="step-n">{n}</span>
                        <span className="step-label">{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {qOpen && (
                <div className="sentence">
                  {tokens.map((t, i) => (
                    <span key={i}>
                      {i > 0 && !isPunct(t) ? ' ' : ''}
                      <span
                        ref={(el) => (wordRefs.current[i] = el)}
                        className={`w${colorFor(i) ? ' lit' : ''}${tokenMembers[i]?.length ? ' clickable' : ''}`}
                        style={{ color: colorFor(i) || undefined }}
                        onClick={() => scrollToWordCluster(i)}
                        title={tokenMembers[i]?.length ? 'jump to this dimension' : undefined}
                      >
                        {t}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {phase === 'loading' && (
          <div className="loading">
            <span className="spin" />
            <span className="loadtxt">{LOADING_STEPS[loadStep]}…</span>
            {eta != null ? (
              <span className="loadtimer">{eta > 0 ? `~${eta}s left` : 'any moment…'}</span>
            ) : (
              <span className="loadtimer">{elapsed.toFixed(0)}s</span>
            )}
            <span className="loadsub">
              {est != null ? `ETA from your last ${durations.length} runs (median ~${est}s)` : 'first run — no estimate yet, timing it live'}
            </span>
          </div>
        )}

        {phase === 'error' && (
          <div className="errbox">
            <b>Couldn't decompose.</b> {err}
            <div className="err-actions">
              <button className="btn-ghost" onClick={decompose}>retry</button>
              <button className="btn-ghost" onClick={reset}>edit question</button>
            </div>
          </div>
        )}

        {phase === 'clustered' && data && (
          <>
            {step === 1 && (
              <div className="expand-layout">
                <aside className="q-rail">
                  <div className="q-rail-sentence">
                    {tokens.map((t, i) => {
                      const members = tokenMembers[i] || []
                      const lit = activeDim && members.includes(activeDim)
                      const c = lit ? clusterById(activeDim) : null
                      return (
                        <span key={i}>
                          {i > 0 && !isPunct(t) ? ' ' : ''}
                          <span
                            className={`qw${members.length ? ' live' : ''}${lit ? ' lit' : ''}`}
                            style={lit && c ? { color: c.color, background: c.color + '20' } : undefined}
                            onMouseEnter={() => members.length && setActiveDim(members[0])}
                            onClick={() => members.length && setActiveDim(members[members.indexOf(activeDim) >= 0 ? (members.indexOf(activeDim) + 1) % members.length : 0])}
                            title={members.length ? `grounds: ${members.map((id) => clusterById(id)?.name).filter(Boolean).join(' · ')}${members.length > 1 ? ' (click to cycle)' : ''}` : undefined}
                          >
                            {t}
                          </span>
                        </span>
                      )
                    })}
                  </div>
                  <nav className="q-rail-nav" aria-label="dimensions">
                    {data.clusters.map((c, idx) => (
                      <button
                        key={c.id}
                        className={`qnav${activeDim === c.id ? ' on' : ''}`}
                        style={{ '--c': c.color }}
                        onMouseEnter={() => setActiveDim(c.id)}
                        onClick={() => setActiveDim(c.id)}
                      >
                        <span className="qnav-n">{String(idx + 1).padStart(2, '0')}</span>
                        <span className="qnav-body">
                          <span className="qnav-name">{c.name || 'untitled dimension'}</span>
                          {(c.highlightQuotes || []).length > 0 && (
                            <span className="qnav-cues">{c.highlightQuotes.map((q) => `“${q}”`).join(' · ')}</span>
                          )}
                        </span>
                      </button>
                    ))}
                    <button className="add-dim qnav-add" onClick={addCluster}>＋ add a dimension of your own</button>
                  </nav>
                </aside>
                <div className="cd-panel">
                  {activeDim && clusterById(activeDim) ? (
                    <ClusterDetail cluster={clusterById(activeDim)} onEdit={editHandlers} question={question} />
                  ) : (
                    <div className="cd-empty">pick a dimension on the left</div>
                  )}
                  <button className="step-next" onClick={() => setStep(2)}>next · make it about you →</button>
                </div>
              </div>
            )}

            {step === 2 &&
              (!personalized ? (
                <ElicitPanel
                  elicit={data.elicit}
                  ans={elicitAns}
                  setAns={setElicitAns}
                  ctx={ctxText}
                  setCtx={setCtxText}
                  onGo={handlePersonalize}
                  busy={personalizing}
                  err={err}
                />
              ) : (
                <>
                  <PersonalizedMap data={data} pdata={pdata} onRedo={() => setPersonalized(false)} />
                  <button className="step-next" onClick={() => setStep(3)}>next · research the open axes →</button>
                </>
              ))}

            {step === 3 && (
              <>
                <ResearchStage R={R} question={question} data={data} pdata={pdata} context={ctxSummary} />
                <button className="step-next" onClick={() => setStep(4)}>next · the artifact →</button>
              </>
            )}

            {step === 4 && <Stage4Artifact R={R} question={question} data={data} pdata={pdata} />}
          </>
        )}
      </div>
    </div>
  )
}
