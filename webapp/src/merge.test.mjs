// Merge-invariant tests — run with `npm test` (node --test, no deps).
// Covers the load-bearing correctness properties of a collaborative merge:
// union, URL-dedup, ledger-key remap, attribution, new-axis carryover, and
// stale-flagging of derived artifacts (decision + families) when evidence changes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findingKey, mergeInvestigationRecord } from './merge.js'

const mine = () => ({
  question: 'Q',
  data: { clusters: [{ id: 'A', name: 'Axis A' }] },
  research: {
    lanes: {
      A: {
        status: 'done',
        findings: [
          { url: 'http://x.com/m0', claim: 'm0', source: 'S0' },
          { url: 'http://x.com/shared', claim: 'm1', source: 'S1' },
        ],
      },
    },
    ledgers: { 'A#1': { results: [{ statement: 'r-from-m1' }] } },
    families: { A: { independentCount: 2, families: [{ label: 'fam' }] } },
    decision: { answer: 'lean-yes, eat them', stance: 'lean-yes' },
  },
})

const collaborator = () => ({
  question: 'Q',
  data: {
    clusters: [
      { id: 'A', name: 'Axis A' },
      { id: 'B', name: 'New Axis B' },
    ],
  },
  research: {
    lanes: {
      A: {
        status: 'done',
        findings: [
          { url: 'https://x.com/shared/', claim: 'dup of m1', source: 'S1' }, // dup (proto+slash insensitive)
          { url: 'http://x.com/t1', claim: 't1', source: 'T1' },
          { url: 'http://x.com/t2', claim: 't2', source: 'T2' },
        ],
      },
      B: { status: 'done', findings: [{ url: 'http://x.com/b0', claim: 'b0', source: 'B0' }] },
    },
    ledgers: { 'A#2': { results: [{ statement: 'r-from-t2' }] } },
  },
})

test('findingKey normalizes protocol and trailing slash', () => {
  assert.equal(findingKey({ url: 'https://x.com/a/' }), findingKey({ url: 'http://x.com/a' }))
  assert.equal(findingKey({ url: '', source: 'S', claim: 'c' }), 'S|c')
})

test('union dedups by URL and preserves order (mine first)', () => {
  const { merged } = mergeInvestigationRecord(mine(), collaborator(), 'collab')
  const A = merged.research.lanes.A.findings
  assert.equal(A.length, 4) // m0, m1, t1, t2 (dup dropped)
  assert.deepEqual(A.map((f) => f.claim), ['m0', 'm1', 't1', 't2'])
})

test('imported ledgers remap to the new finding index; mine keep theirs', () => {
  const { merged } = mergeInvestigationRecord(mine(), collaborator(), 'collab')
  assert.equal(merged.research.ledgers['A#1'].results[0].statement, 'r-from-m1') // mine, index preserved
  assert.equal(merged.research.ledgers['A#3'].results[0].statement, 'r-from-t2') // theirs, A#2 -> A#3
  assert.equal(merged.research.ledgers['A#2'], undefined) // no stale collision
})

test('attribution: imported findings stamped _by; mine stay unattributed', () => {
  const { merged } = mergeInvestigationRecord(mine(), collaborator(), 'collab')
  const A = merged.research.lanes.A.findings
  assert.equal(A[0]._by, undefined)
  assert.equal(A[1]._by, undefined)
  assert.equal(A[2]._by, 'collab')
  assert.equal(A[3]._by, 'collab')
})

test('new axis carries into dimensions and its lane comes over', () => {
  const { merged, summary } = mergeInvestigationRecord(mine(), collaborator(), 'collab')
  assert.ok(merged.data.clusters.some((c) => c.id === 'B'))
  assert.equal(merged.research.lanes.B.findings.length, 1)
  assert.equal(summary.addedFindings, 3)
  assert.equal(summary.addedDimensions, 1)
})

test('derived artifacts flagged stale when evidence changed', () => {
  const { merged } = mergeInvestigationRecord(mine(), collaborator(), 'collab')
  assert.equal(merged.research.decision._stale, true) // prior synthesis reasoned over less evidence
  assert.equal(merged.research.families.A._stale, true) // A gained findings -> regroup
})

test('no stale flag when nothing new was added (idempotent re-merge)', () => {
  const { merged, summary } = mergeInvestigationRecord(mine(), mine(), 'self')
  assert.equal(summary.addedFindings, 0)
  assert.ok(!merged.research.decision._stale) // unchanged evidence -> answer stays current
  assert.ok(!merged.research.families.A._stale)
})

test('adopt into an empty record takes their dimensions wholesale', () => {
  const { merged, summary } = mergeInvestigationRecord({ question: 'Q' }, collaborator(), 'collab')
  assert.ok(merged.data.clusters.some((c) => c.id === 'A'))
  assert.ok(merged.data.clusters.some((c) => c.id === 'B'))
  assert.equal(summary.addedFindings, 4) // all of theirs are new
})
