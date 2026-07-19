import { useState, useRef, useLayoutEffect, useEffect } from 'react'

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

  function reset() {
    setPhase('landing')
    setData(null)
    setErr('')
    setActivated([])
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
        )}
      </div>
    </div>
  )
}
