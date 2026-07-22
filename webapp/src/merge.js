// Pure, DOM-free merge logic for combining two investigators' exported records on one question.
// Kept in its own module so it can be unit-tested without React/localStorage. The store-coupled
// wrapper (ingestInvestigationFile) lives in App.jsx and calls into these.
//
// Contract (per GRAPH-MODEL.md): evidence is the SHARED, attributed, contestable substrate;
// dimensions union by id; personal context/personalization/decision stay the importer's.

// dedup key for a finding: the source URL if any (protocol/trailing-slash insensitive), else source+claim
export const findingKey = (f) => {
  const u = String(f.url || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
  return u || `${f.source || ''}|${String(f.claim || '').slice(0, 80)}`
}

// Merge `incoming` into `mine`. Returns { merged, summary }.
// - lanes: union findings per axis, dedup by findingKey, stamp imported ones _by the contributor
// - ledgers: remap each imported ledger key `axis#i` to the finding's NEW index (so result records
//   follow their findings; my own ledgers keep their indices since my findings stay first)
// - families: keep mine, fill from theirs; any axis whose evidence CHANGED is flagged _stale
// - decision: a prior synthesis reasoned over less evidence -> flagged _stale (never silently kept-as-current)
export function mergeInvestigationRecord(mine, incoming, byId) {
  mine = mine || {}
  const mr = mine.research || {}
  const ir = incoming.research || {}
  // dimensions: keep mine, add any axes they have that I don't
  const mineClusters = mine.data?.clusters || []
  const haveDim = new Set(mineClusters.map((c) => c.id))
  const addedDims = (incoming.data?.clusters || []).filter((c) => c.id && !haveDim.has(c.id))
  const mergedData = mineClusters.length
    ? { ...(mine.data || {}), clusters: [...mineClusters, ...addedDims] }
    : incoming.data || null
  // lanes + ledgers
  const mineLanes = mr.lanes || {}
  const theirLanes = ir.lanes || {}
  const mineLedgers = mr.ledgers || {}
  const theirLedgers = ir.ledgers || {}
  const outLanes = {}
  const outLedgers = { ...mineLedgers }
  let addedFindings = 0
  const touchedAxes = new Set()
  const axisIds = new Set([...Object.keys(mineLanes), ...Object.keys(theirLanes)])
  for (const axis of axisIds) {
    const findings = (mineLanes[axis]?.findings || []).slice()
    const seen = new Set(findings.map(findingKey))
    const startIdx = findings.length
    let k = 0
    ;(theirLanes[axis]?.findings || []).forEach((tf, tIdx) => {
      if (seen.has(findingKey(tf))) return
      seen.add(findingKey(tf))
      findings.push({ ...tf, _by: tf._by || byId })
      const led = theirLedgers[`${axis}#${tIdx}`]
      const newKey = `${axis}#${startIdx + k}`
      if (led && !outLedgers[newKey]) outLedgers[newKey] = { ...led, _by: led._by || byId }
      addedFindings++
      touchedAxes.add(axis)
      k++
    })
    const base = mineLanes[axis] || theirLanes[axis] || {}
    outLanes[axis] = { ...base, findings, status: findings.length ? 'done' : base.status }
  }
  // evidence families: keep mine, fill from theirs; flag touched axes stale (don't silently recompute)
  const outFamilies = { ...(ir.families || {}), ...(mr.families || {}) }
  for (const axis of touchedAxes) if (outFamilies[axis]) outFamilies[axis] = { ...outFamilies[axis], _stale: true }
  // interaction timeline: union, tag theirs, sort, cap
  const mineInter = mine.interactions || []
  const theirInter = (incoming.interactions || incoming.human?.interactions || []).map((x) => ({ ...x, _by: x._by || byId }))
  const mergedInter = [...mineInter, ...theirInter].sort((a, b) => String(a.t).localeCompare(String(b.t))).slice(-1000)
  // a prior synthesis reasoned over LESS evidence -> flag stale rather than display as current
  const priorDecision = mr.decision && mr.decision.answer ? mr.decision : null
  const outDecision = priorDecision && addedFindings > 0 ? { ...priorDecision, _stale: true } : priorDecision
  const merged = {
    ...mine,
    question: mine.question || incoming.question,
    data: mergedData,
    pdata: mine.pdata || null,
    research: { ...mr, lanes: outLanes, ledgers: outLedgers, families: outFamilies, decision: outDecision, brief: mr.brief || ir.brief || null },
    interactions: mergedInter,
  }
  return { merged, summary: { addedFindings, addedDimensions: addedDims.length, axes: [...touchedAxes] } }
}
