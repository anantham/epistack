'use client';
import { useEffect, useState } from 'react';
import './hosted.css';
import type { DecompositionArtifact } from '../../lib/decomposition';
const example = 'Are eggs good to eat? Bad to eat? Great in moderation? How can we tell? Does it vary across people, and what predicts this? What else should we be paying attention to here?';
type Job = { id: string; token: string };
type Progress = { status: string; stage: number; question?: string; error?: string; artifact?: DecompositionArtifact; results?: unknown[] };
const storage = 'epistack:hosted-decomposition-job:v1';
export default function HostedDecomposition() {
  const [question, setQuestion] = useState(example), [job, setJob] = useState<Job | null>(null), [progress, setProgress] = useState<Progress | null>(null), [error, setError] = useState(''), [starting, setStarting] = useState(false);
  useEffect(() => { try { const saved = localStorage.getItem(storage); if (saved) setJob(JSON.parse(saved)); } catch {} }, []);
  useEffect(() => {
    if (!job) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/decompose-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not read the saved run.');
        if (stopped) return;
        if (data.status !== 'busy') setProgress(data);
        if (!['completed', 'failed'].includes(data.status)) timer = setTimeout(poll, 15000);
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : 'Connection interrupted. Reload to resume the saved run.'); }
    }
    poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [job]);
  async function start() {
    setStarting(true); setError('');
    try {
      const response = await fetch('/api/decompose-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not start.');
      const receipt = { id: data.id, token: data.token }; localStorage.setItem(storage, JSON.stringify(receipt)); setProgress(data); setJob(receipt);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start.'); } finally { setStarting(false); }
  }
  function download() {
    const blob = new Blob([JSON.stringify({ question: progress?.question, provider: 'Astra public Responses', status: 'proposal-awaiting-human-review', decomposition: progress?.artifact, stages: progress?.results, contextualizationConducted: false, researchStarted: false }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'epistack-decomposition.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="hosted-decomposition" style={{ maxWidth: 980, margin: 'auto', padding: '32px 24px', fontSize: 16, lineHeight: 1.65 }}>
    <a href="/">Epistack</a><h1>Decompose a question</h1><p>Inspect the possible meanings before deciding what to research. No API key or local companion is needed for this step.</p>
    <p><a href="/examples/eggs-decomposition.html">Explore the completed eggs example and its audit</a></p>
    {!job && <><label htmlFor="question">Your question</label><textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} rows={5} maxLength={5000} style={{ width: '100%', padding: 16, font: 'inherit', border: '1px solid #8291a5', borderRadius: 8 }} /><p>This question is processed through the owner’s Astra service and ChatGPT. This preview allows ten investigations per day across the site.</p><button onClick={start} disabled={starting || question.trim().length < 12}>{starting ? 'Starting…' : 'Decompose question'}</button></>}
    {error && <p role="alert">{error}</p>}
    {job && <section aria-live="polite"><h2>Run progress</h2><p>{progress?.question || question}</p><ol>{['Discover dimensions', 'Map exact language to dimensions', 'Specify evidence fields and proposed context questions'].map((name, i) => <li key={name}>{name} — {(progress?.stage || 0) > i ? 'complete' : (progress?.stage || 0) === i ? progress?.status || 'connecting' : 'waiting'}</li>)}</ol><p>Your run is saved. You can reload this browser to resume. Each stage may take a few minutes.</p>{progress?.error && <p role="alert">{progress.error}</p>}</section>}
    {progress?.artifact && <section><h2>{progress.artifact.caseTitle}</h2><p>{progress.artifact.summary}</p><p>All branches below are proposals. No personal context or research scope has been approved.</p>{progress.artifact.clusters.map(cluster => { return <details key={cluster.id} open style={{ padding: 20, margin: '16px 0', border: '1px solid #8291a5', borderRadius: 8 }}><summary><strong>{cluster.label}</strong></summary><details><summary>Exact cues and evidence requirements</summary><p>{cluster.highlightQuotes.map(q => `“${q}”`).join(' + ')}</p><p>{cluster.rationale}</p><h3>Record from evidence</h3><ul>{cluster.ingestionRequirements.requiredFields.map(s => <li key={s}>{s}</li>)}</ul><h3>Mismatch risks</h3><ul>{cluster.ingestionRequirements.mismatchRisks.map(s => <li key={s}>{s}</li>)}</ul></details></details>; })}<h2>Before contextualizing</h2><p>Is this a general evidence map, or a decision for a particular person? Review the proposed questions below before supplying personal details.</p>{progress.artifact.clusters.map(c => c.contextQuestion).filter(Boolean).map(q => <details key={q.id}><summary>{q.question}</summary><p>{q.whyItMatters}</p><ul>{q.options.map(o => <li key={o}>{o}</li>)}</ul></details>)}<p>Contextualization and research have not started.</p><button onClick={download}>Download decomposition JSON</button></section>}
    {job && ['completed', 'failed'].includes(progress?.status || '') && <p><button onClick={() => { localStorage.removeItem(storage); setJob(null); setProgress(null); setError(''); }}>Start another question</button></p>}
  </main>;
}
