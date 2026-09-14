'use client';
import { useEffect, useState } from 'react';
import './hosted.css';
import type { DecompositionArtifact, DecompositionProvenance } from '../../lib/decomposition';
import { runHostedDecomposition } from '../../lib/hosted-decomposition-client';

const example = 'Are eggs good to eat? Bad to eat? Great in moderation? How can we tell? Does it vary across people, and what predicts this? What else should we be paying attention to here?';
type Progress = { status: string; stage: number; question?: string; error?: string; artifact?: DecompositionArtifact; model?: string; warning?: string | null; provenance?: DecompositionProvenance };
const storage = 'epistack:decompose-live-inspector:v2';

export default function HostedDecomposition() {
  const [question, setQuestion] = useState(example);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  async function drive(value: string, refresh = false) {
    setError('');
    setStarting(true);
    setProgress({ status: 'connecting', stage: 0, question: value });
    try {
      const response = await runHostedDecomposition(
        { question: value, decisionContext: '', promptOverrides: {} },
        value,
        refresh,
        (update) => setProgress({ status: update.status, stage: update.stage, question: value }),
      );
      setProgress({ status: 'completed', stage: 3, question: response.prompt, artifact: response.decomposition, model: response.model, warning: response.warning, provenance: response.provenance });
      localStorage.removeItem(storage);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not complete the run.';
      setProgress({ status: 'failed', stage: 0, question: value, error: message });
      setError(message);
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storage) || 'null') as { question?: string; active?: boolean } | null;
      if (saved?.active && typeof saved.question === 'string') {
        setQuestion(saved.question);
        void drive(saved.question);
      }
    } catch {
      // A missing or unreadable receipt means there is nothing to resume.
    }
  }, []);

  function start() {
    localStorage.setItem(storage, JSON.stringify({ question, active: true }));
    void drive(question);
  }
  function download() {
    const blob = new Blob([JSON.stringify({ question: progress?.question, provider: progress?.model, provenance: progress?.provenance, status: 'proposal-awaiting-human-review', decomposition: progress?.artifact, contextualizationConducted: false, researchStarted: false }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'epistack-decomposition.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="hosted-decomposition" style={{ maxWidth: 980, margin: 'auto', padding: '32px 24px', fontSize: 16, lineHeight: 1.65 }}>
    <a href="/">Epistack</a><h1>Decompose a question</h1><p>Inspect the possible meanings before deciding what to research. No API key or local companion is needed for this step.</p>
    <p><a href="/examples/eggs-decomposition.html">Explore the completed eggs example and its audit</a></p>
    {!progress && <><label htmlFor="question">Your question</label><textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} rows={5} maxLength={5000} style={{ width: '100%', padding: 16, font: 'inherit', border: '1px solid #8291a5', borderRadius: 8 }} /><p>This question is processed through the hosted backend configured for this deployment. This preview allows 50 investigations per day across the site.</p><button onClick={start} disabled={starting || question.trim().length < 12}>{starting ? 'Starting…' : 'Decompose question'}</button></>}
    {error && <p role="alert">{error}</p>}
    {progress && !progress.artifact && <section aria-live="polite"><h2>Run progress</h2><p>{progress.question || question}</p><ol>{['Discover dimensions', 'Map exact language to dimensions', 'Specify evidence fields and proposed context questions'].map((name, i) => <li key={name}>{name} — {(progress.stage || 0) > i ? 'complete' : (progress.stage || 0) === i ? progress.status || 'connecting' : 'waiting'}</li>)}</ol><p>Your run is saved. You can reload this browser to resume. Each stage may take a few minutes.</p></section>}
    {progress?.artifact && <section><h2>{progress.artifact.caseTitle}</h2><p>{progress.artifact.summary}</p>{progress.model && <p><strong>Provider/model:</strong> {progress.model}</p>}{progress.warning && <p role="status">{progress.warning}</p>}<p>All branches below are proposals. No personal context or research scope has been approved.</p>{progress.artifact.clusters.map(cluster => { return <details key={cluster.id} open style={{ padding: 20, margin: '16px 0', border: '1px solid #8291a5', borderRadius: 8 }}><summary><strong>{cluster.label}</strong></summary><details><summary>Exact cues and evidence requirements</summary><p>{cluster.highlightQuotes.map(q => `“${q}”`).join(' + ')}</p><p>{cluster.rationale}</p><h3>Record from evidence</h3><ul>{cluster.ingestionRequirements.requiredFields.map(s => <li key={s}>{s}</li>)}</ul><h3>Mismatch risks</h3><ul>{cluster.ingestionRequirements.mismatchRisks.map(s => <li key={s}>{s}</li>)}</ul></details></details>; })}<h2>Before contextualizing</h2><p>Is this a general evidence map, or a decision for a particular person? Review the proposed questions below before supplying personal details.</p>{progress.artifact.clusters.map(c => c.contextQuestion).filter(Boolean).map(q => <details key={q.id}><summary>{q.question}</summary><p>{q.whyItMatters}</p><ul>{q.options.map(o => <li key={o}>{o}</li>)}</ul></details>)}<p>Contextualization and research have not started.</p><button onClick={download}>Download decomposition JSON</button></section>}
    {progress && ['completed', 'failed'].includes(progress.status) && <p><button onClick={() => { localStorage.removeItem(storage); setProgress(null); setError(''); }}>Start another question</button></p>}
  </main>;
}
