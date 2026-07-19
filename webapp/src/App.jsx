import { useState, useRef, useLayoutEffect, useEffect, useMemo } from 'react'

const prefersReduced =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion:reduce)').matches

const isPunct = (t) => /^[^\sA-Za-z0-9]+$/.test(t)
const tokenize = (q) => q.match(/[A-Za-z0-9']+|[^\sA-Za-z0-9]/g) || []

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
        body: JSON.stringify({ kind: 'resolution', question, dimensionName: cluster.name, dimensionPrompt: cluster.prompt, existing: cluster.resolutions || [] }),
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
    <section className={`section ${active ? 'active' : ''}`} ref={secRef} style={{ '--c': cluster.color }}>
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
              <input className="edit-res" value={r} placeholder="a resolution…" onChange={(e) => onEdit.res(cluster.id, k, e.target.value)} />
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

// evidence weight by confidence; drives the histogram + uncertainty (normalised entropy)
const CONF_W = { high: 3, medium: 2, low: 1 }
function axisStats(axis, findings) {
  const res = axis.resolutions || []
  const wOf = (arr) => arr.reduce((s, f) => s + (CONF_W[norm(f.confidence)] || 1), 0)
  const buckets = res.map((r) => ({ r, w: wOf(findings.filter((f) => matchRes(f.supports, r))) }))
  const unclearW = wOf(findings.filter((f) => !res.some((r) => matchRes(f.supports, r))))
  const segs = unclearW > 0 ? [...buckets, { r: 'unclear', w: unclearW, unclear: true }] : buckets.length ? buckets : [{ r: '—', w: 0 }]
  const total = segs.reduce((s, b) => s + b.w, 0)
  const maxW = Math.max(1, ...segs.map((b) => b.w))
  const k = Math.max(res.length, 2)
  let u = 1 // no evidence → maximum uncertainty (uniform prior over resolutions)
  if (total > 0) {
    const ps = segs.map((b) => b.w / total).filter((p) => p > 0)
    const H = -ps.reduce((s, p) => s + p * Math.log(p), 0)
    u = Math.min(1, H / Math.log(k))
  }
  const top = [...segs].filter((b) => !b.unclear).sort((a, b) => b.w - a.w)[0]
  return { segs, total, maxW, u, evidence: findings.length, top: top && top.w > 0 ? top.r : null }
}
function verdict(s) {
  if (s.evidence === 0) return { key: 'unexamined', label: 'unexamined' }
  if (s.u <= 0.35) return { key: 'converging', label: `converging → ${s.top || '—'}` }
  if (s.u >= 0.72) return { key: 'contested', label: 'genuinely contested' }
  return { key: 'leaning', label: `leaning → ${s.top || '—'}` }
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

// the deep-dive subagent's output — a full provenance card for ONE study
function ProvenanceCard({ p }) {
  const tier = norm(p.journal_tier)
  const tierClass = /top|reputable|high|q1/.test(tier) ? 'good' : /predator|preprint|low|q3|q4|unknown/.test(tier) ? 'warn' : ''
  const tierShort = String(p.journal_tier || '').split(/[—,.;(]/)[0].trim().slice(0, 46)
  const openGood = /yes|public|open|available|github|osf|zenodo|dryad/i.test(String(p.open_data || '')) && !/no\b|not |unclear/i.test(String(p.open_data || ''))
  const critiqued = p.critiques && !/^(none|no known|not )/i.test(String(p.critiques).trim())
  const rows = [
    ['design', p.design],
    ['sample', p.n],
    ['effect size', p.effect],
    ['p-value', p.pvalue],
    ['exposure', p.exposure],
    ['population', p.population],
    ['year', p.year],
    ['journal', p.journal && `${p.journal}${p.journal_tier ? ` — ${p.journal_tier}` : ''}`],
    ['peer-reviewed', typeof p.peer_reviewed === 'boolean' ? (p.peer_reviewed ? 'yes' : 'no') : p.peer_reviewed],
    ['investigators', p.investigators],
    ['funding', p.funding],
    ['conflicts', p.coi],
    ['open data', p.open_data],
    ['critiques / replications', p.critiques],
    ['limitations', p.limitations],
  ].filter(([, v]) => v)
  return (
    <div className="prov">
      <div className="prov-chips">
        {p.journal_tier && <span className={`pchip ${tierClass}`} title={p.journal_tier}>{tierClass === 'good' ? '◆ ' : tierClass === 'warn' ? '△ ' : ''}{tierShort}</span>}
        <span className={`pchip ${openGood ? 'good' : 'warn'}`}>{openGood ? '◆ open data' : '△ data not open'}</span>
        {critiqued && <span className="pchip warn">△ critiqued</span>}
        {p.pvalue && <span className="pchip">p {p.pvalue}</span>}
      </div>
      <div className="prov-grid">
        {rows.map(([k, v]) => (
          <div className={`prov-row${k === 'critiques / replications' && critiqued ? ' hot' : ''}`} key={k}>
            <span className="prov-k">{k}</span>
            <span className="prov-v">{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FindingCard({ f, question, axisName }) {
  const coi = f.coi && !/^none/i.test(String(f.coi))
  const conf = norm(f.confidence)
  const [dd, setDd] = useState(null) // null | 'loading' | result | {error}
  async function deepdive() {
    setDd('loading')
    try {
      const r = await fetch('/api/deepdive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, axis: axisName, claim: f.claim, source: f.source, url: f.url }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setDd(j)
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
        {f.confidence && <span className={`tag t-conf c-${conf}`}>{f.confidence}</span>}
        {coi && <span className="tag t-coi">⚠ {f.coi}</span>}
      </div>
      <div className="finding-foot">
        {f.url && (
          <a className="finding-src" href={f.url} target="_blank" rel="noreferrer">
            {f.source || f.url}
            {f.year ? ` · ${f.year}` : ''} ↗
          </a>
        )}
        <button className="dd-btn" onClick={deepdive} disabled={dd === 'loading'}>
          {dd === 'loading' ? '🔬 subagent digging…' : dd && !dd.error ? '↻ re-dig' : '🔬 deep-dive'}
        </button>
      </div>
      {dd === 'loading' && (
        <div className="dd-working">
          <span className="scan" />
          <span>a subagent is verifying methodology, sample, journal, funding, open-data & critiques…</span>
        </div>
      )}
      {dd && dd !== 'loading' && dd.error && <div className="dd-err">deep-dive failed: {dd.error}</div>}
      {dd && dd !== 'loading' && !dd.error && <ProvenanceCard p={dd} />}
    </div>
  )
}

function ResearchLane({ axis, lane, stats, brief, now, onRun, question }) {
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
            <span className="lane-u">uncertainty {Math.round(stats.u * 100)}%</span>
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
              <FindingCard key={i} f={f} question={question} axisName={axis.name} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Stage 3 top: the caring graph — every axis's evidence histogram + uncertainty, dropping live
function GraphState({ axes, statsById }) {
  const us = axes.map((a) => statsById[a.id].u)
  const agg = us.length ? Math.round((us.reduce((x, y) => x + y, 0) / us.length) * 100) : 100
  const examined = axes.filter((a) => statsById[a.id].evidence > 0).length
  const contested = axes.filter((a) => statsById[a.id].evidence > 0 && statsById[a.id].u >= 0.72).length
  return (
    <div className="graphstate">
      <div className="gs-head">
        <div className="gs-title-wrap">
          <span className="rlabel">the caring graph</span>
          <div className="gs-title">uncertainty across {axes.length} {axes.length === 1 ? 'axis' : 'axes'}</div>
          <div className="gs-note">
            {examined}/{axes.length} examined{contested ? ` · ${contested} genuinely contested` : ''}
          </div>
        </div>
        <div className="gs-meter">
          <div className="gs-pct">
            <b>{agg}</b>%
          </div>
          <div className="gs-track">
            <span className="gs-fill" style={{ width: agg + '%' }} />
          </div>
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
              <span className="gs-u">{Math.round(s.u * 100)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ResearchStage({ question, data, pdata, context }) {
  const axes = useMemo(() => {
    if (pdata) {
      const byId = Object.fromEntries((pdata.clusters || []).map((c) => [c.id, c]))
      const open = (data.clusters || []).filter((c) => (byId[c.id]?.status || 'open') === 'open')
      const news = pdata.newClusters || []
      const picked = [...open, ...news]
      return picked.length ? picked : data.clusters || []
    }
    return data.clusters || []
  }, [data, pdata])

  const [lanes, setLanes] = useState({})
  const [now, setNow] = useState(() => Date.now())
  const [plan, setPlan] = useState(null) // null | 'planning' | result | {error}
  const statsById = useMemo(
    () => Object.fromEntries(axes.map((a) => [a.id, axisStats(a, lanes[a.id]?.findings || [])])),
    [axes, lanes],
  )
  const briefFor = (id) => (plan && plan.agents ? plan.agents.find((a) => a.dimension === id) : null)
  const briefText = (b) => (b ? `${b.focus || ''}${b.crux ? ` — crux: ${b.crux}` : ''}${b.sources ? `; prioritise: ${b.sources}` : ''}`.trim() : '')

  async function planResearch() {
    setPlan('planning')
    try {
      const r = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          context: context || '',
          axes: axes.map((a) => ({ id: a.id, name: a.name, prompt: a.prompt || '', resolutions: a.resolutions || [] })),
        }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`)
      setPlan(j)
    } catch (e) {
      setPlan({ error: String(e.message || e) })
    }
  }

  useEffect(() => {
    if (!Object.values(lanes).some((l) => l && l.status === 'searching')) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [lanes])

  async function research(axis) {
    setLanes((l) => ({ ...l, [axis.id]: { status: 'searching', findings: [], t0: Date.now() } }))
    try {
      const r = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          dimensionName: axis.name,
          dimensionPrompt: axis.prompt || '',
          resolutions: axis.resolutions || [],
          context: context || '',
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
            : `▶ dispatch ${axes.length} ${plan && plan.agents ? 'briefed ' : ''}${axes.length === 1 ? 'agent' : 'agents'}`}
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
        {(!plan || plan === 'planning' || plan.error) && (
          <button className="orch-btn" onClick={planResearch} disabled={plan === 'planning'}>
            {plan === 'planning' ? '◆ orchestrator planning…' : '◆ plan the research with an orchestrator'}
          </button>
        )}
        {plan === 'planning' && <span className="orch-hint">assigning a specialist to each axis…</span>}
        {plan && plan.error && <div className="dd-err">plan failed: {plan.error}</div>}
        {plan && plan !== 'planning' && !plan.error && (
          <div className="plan">
            <div className="plan-strategy">
              <span className="rlabel">orchestrator strategy</span>
              {plan.strategy}
            </div>
            <div className="plan-agents">
              {(plan.agents || []).map((a, i) => {
                const ax = axes.find((x) => x.id === a.dimension)
                return (
                  <div className="plan-agent" key={i} style={{ '--c': ax?.color || 'var(--accent)' }}>
                    <div className="pa-head">
                      <span className="lane-dot" />
                      <b>{a.role}</b>
                      <span className="pa-dim">{ax?.name || a.dimension}</span>
                    </div>
                    {a.focus && <div className="pa-focus">{a.focus}</div>}
                    {a.crux && <div className="pa-crux">crux · {a.crux}</div>}
                  </div>
                )
              })}
            </div>
            <button className="orch-btn re" onClick={planResearch}>↻ re-plan</button>
          </div>
        )}
      </div>

      <GraphState axes={axes} statsById={statsById} />

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
          />
        ))}
      </div>
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

  async function decompose() {
    const q = question.trim()
    if (!q) return
    setEverDecomposed(true)
    const toks = tokenize(q)
    setTokens(toks)
    setErr('')
    setActivated([])
    setPersonalized(false)
    setPdata(null)
    setElicitAns({})
    setCtxText('')
    setCtxSummary('')
    setStep(1)
    const cached = getCache()[q]
    if (cached) {
      setFromCache(true)
      setData(cached)
      setPhase('clustered')
      return
    }
    setFromCache(false)
    setData(null)
    setPhase('loading')
    const t0 = performance.now()
    try {
      const r = await fetch('/api/decompose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, tokens: toks }),
      })
      const j = await r.json()
      if (!r.ok || j.error) {
        setErr(j.error ? `${j.error}${j.detail ? ' — ' + j.detail : ''}` : `HTTP ${r.status}`)
        setPhase('error')
        return
      }
      setDurations(pushDuration(performance.now() - t0))
      setCache(q, j)
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
    try {
      const r = await fetch('/api/personalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
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
  const clusterById = (id) => (data?.clusters || []).find((c) => c.id === id)
  const colorFor = (i) => {
    const id = data?.assignments?.[i]
    if (!id) return null
    return activated.includes(id) ? clusterById(id)?.color || null : null
  }
  const wordIdxsFor = (cid) =>
    tokens.map((t, i) => (data?.assignments && data.assignments[i] === cid ? i : -1)).filter((i) => i >= 0)

  // --- stage-1 editability: every dimension/resolution is a proposal you can override ---
  const updateCluster = (id, patch) =>
    setData((d) => ({ ...d, clusters: d.clusters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  const mapRes = (id, fn) =>
    setData((d) => ({ ...d, clusters: d.clusters.map((c) => (c.id === id ? { ...c, resolutions: fn(c.resolutions || []) } : c)) }))
  const editHandlers = {
    name: (id, name) => updateCluster(id, { name }),
    prompt: (id, prompt) => updateCluster(id, { prompt }),
    res: (id, idx, text) => mapRes(id, (rs) => rs.map((r, i) => (i === idx ? text : r))),
    addRes: (id) => mapRes(id, (rs) => [...rs, '']),
    addResWith: (id, text) => mapRes(id, (rs) => [...rs, text]),
    delRes: (id, idx) => mapRes(id, (rs) => rs.filter((_, i) => i !== idx)),
    delDim: (id) => setData((d) => ({ ...d, clusters: d.clusters.filter((c) => c.id !== id) })),
  }
  function addCluster() {
    const palette = ['#E0574E', '#2E86DE', '#17A398', '#B5179E', '#E8A32B', '#8A72E0']
    const id = 'custom-' + Date.now()
    setData((d) => ({
      ...d,
      clusters: [...(d.clusters || []), { id, name: '', color: palette[(d.clusters?.length || 0) % palette.length], prompt: '', resolutions: [''] }],
    }))
    setActivated((a) => (a.includes(id) ? a : [...a, id]))
  }

  const estMs = median(durations)
  const est = estMs ? Math.round(estMs / 1000) : null
  const eta = est != null ? Math.max(0, est - Math.round(elapsed)) : null
  const docked = phase !== 'landing'

  return (
    <div className={`app ${docked ? 'docked' : 'landing'}`}>
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
              <button className="btn-ghost reset-btn" onClick={reset}>↺ ask another</button>
              {fromCache && <span className="cached-chip">⚡ cached</span>}
              <div className="sentence">
                {tokens.map((t, i) => (
                  <span key={i}>
                    {i > 0 && !isPunct(t) ? ' ' : ''}
                    <span
                      ref={(el) => (wordRefs.current[i] = el)}
                      className={`w${colorFor(i) ? ' lit' : ''}`}
                      style={{ color: colorFor(i) || undefined }}
                    >
                      {t}
                    </span>
                  </span>
                ))}
              </div>
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
            <div className="stepper">
              {[[1, 'expand'], [2, 'contextualize'], [3, 'research']].map(([n, label]) => (
                <button key={n} className={`step-tab${step === n ? ' on' : ''}`} onClick={() => setStep(n)}>
                  <span className="step-n">{n}</span>
                  {label}
                </button>
              ))}
            </div>

            {step === 1 && (
              <>
                <div className="sections">
                  {data.clusters.map((c) => (
                    <ClusterSection
                      key={c.id}
                      cluster={c}
                      wordIdxs={wordIdxsFor(c.id)}
                      tokens={tokens}
                      wordRefs={wordRefs}
                      active={activated.includes(c.id)}
                      onActivate={onActivate}
                      onEdit={editHandlers}
                      question={question}
                    />
                  ))}
                  <button className="add-dim" onClick={addCluster}>＋ add a dimension of your own</button>
                </div>
                <button className="step-next" onClick={() => setStep(2)}>next · make it about you →</button>
              </>
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

            {step === 3 && <ResearchStage question={question} data={data} pdata={pdata} context={ctxSummary} />}
          </>
        )}
      </div>
    </div>
  )
}
