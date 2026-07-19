"use client";

import { useMemo, useState } from "react";
import type {
  DecompositionCluster,
  DecompositionResponse,
  QuestionHighlight,
} from "../lib/decomposition";
import { decompositionSessionKey } from "../lib/decomposition";
import { CaseHeader } from "./components/case-navigation";

const exampleQuestion =
  "Are eggs good to eat? Bad to eat? Great in moderation? How can we tell? Does it vary across people, and what predicts this? What else should we be paying attention to here?";

type AnalysisPhase = "idle" | "analyzing" | "highlighting" | "clustering" | "review" | "transitioning" | "error";

type TextSegment = {
  text: string;
  highlightIndex: number | null;
};

function locateHighlights(prompt: string, highlights: QuestionHighlight[]): TextSegment[] {
  const locations = highlights
    .map((highlight, highlightIndex) => ({
      start: prompt.indexOf(highlight.quote),
      end: prompt.indexOf(highlight.quote) + highlight.quote.length,
      highlightIndex,
    }))
    .filter((item) => item.start >= 0)
    .sort((a, b) => a.start - b.start);

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const location of locations) {
    if (location.start < cursor) continue;
    if (location.start > cursor) {
      segments.push({ text: prompt.slice(cursor, location.start), highlightIndex: null });
    }
    segments.push({
      text: prompt.slice(location.start, location.end),
      highlightIndex: location.highlightIndex,
    });
    cursor = location.end;
  }
  if (cursor < prompt.length) segments.push({ text: prompt.slice(cursor), highlightIndex: null });
  return segments.length ? segments : [{ text: prompt, highlightIndex: null }];
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function Home() {
  const [prompt, setPrompt] = useState(exampleQuestion);
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [result, setResult] = useState<DecompositionResponse | null>(null);
  const [activeHighlight, setActiveHighlight] = useState(-1);
  const [activeCluster, setActiveCluster] = useState(-1);
  const [error, setError] = useState("");

  const segments = useMemo(
    () => locateHighlights(prompt, result?.decomposition.highlights ?? []),
    [prompt, result],
  );
  const currentHighlight = result?.decomposition.highlights[activeHighlight] ?? null;
  const currentCluster: DecompositionCluster | null = result?.decomposition.clusters[activeCluster] ?? null;
  const currentAxis = result?.decomposition.axes.find((axis) => axis.id === currentCluster?.axisId) ?? null;
  const busy = phase === "analyzing" || phase === "highlighting" || phase === "clustering" || phase === "transitioning";

  async function analyze() {
    if (!prompt.trim() || busy) return;
    setError("");
    setResult(null);
    setActiveHighlight(-1);
    setActiveCluster(-1);
    setPhase("analyzing");

    try {
      const response = await fetch("/api/decompose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const payload = await response.json() as DecompositionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The decomposition could not be generated.");

      setResult(payload);
      setPhase("highlighting");
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const highlightDelay = reducedMotion ? 90 : 850;
      for (let index = 0; index < payload.decomposition.highlights.length; index += 1) {
        setActiveHighlight(index);
        await wait(highlightDelay);
      }

      setPhase("clustering");
      const clusterDelay = reducedMotion ? 90 : 720;
      for (let index = 0; index < payload.decomposition.clusters.length; index += 1) {
        setActiveCluster(index);
        await wait(clusterDelay);
      }

      window.sessionStorage.setItem(decompositionSessionKey, JSON.stringify(payload));
      setActiveCluster(0);
      setPhase("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decomposition could not be generated.");
      setPhase("error");
    }
  }

  async function openMap() {
    if (!result) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.sessionStorage.setItem(decompositionSessionKey, JSON.stringify(result));
    setPhase("transitioning");
    await wait(reducedMotion ? 80 : 800);
    window.location.assign("/map");
  }

  return (
    <main>
      <CaseHeader active="frame" />
      <section className={"analysis-shell " + (phase === "transitioning" ? "leaving" : "")}>
        <div className="analysis-intro">
          <div className="eyebrow">Question compiler · AI-assisted framing</div>
          <h1>Let the AI show you what your question is hiding.</h1>
          <p className="lede">
            Submit any research question or paragraph. Epistack marks the phrases carrying hidden choices before it builds an editable interpretation map.
          </p>
        </div>

        <div className={"analysis-workbench " + (busy ? "is-reading" : "")}>
          <div className="analysis-main">
            <div className="analysis-label-row">
              <span>Starting question</span>
              <span className="analysis-mode">
                {result?.mode === "ai" ? result.model : result?.mode === "local-fallback" ? "Local fallback" : "AI SDK · structured output"}
              </span>
            </div>

            {phase === "idle" || phase === "error" ? (
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={8}
                maxLength={5000}
                aria-label="Starting research question"
              />
            ) : (
              <div className="annotated-question" aria-label="AI analysis of the submitted question">
                {segments.map((segment, index) => {
                  const seen = segment.highlightIndex !== null && segment.highlightIndex <= activeHighlight;
                  const active = segment.highlightIndex === activeHighlight;
                  const highlight = segment.highlightIndex === null
                    ? null
                    : result?.decomposition.highlights[segment.highlightIndex] ?? null;
                  const clusterIndex = highlight
                    ? result?.decomposition.clusters.findIndex((cluster) => cluster.id === highlight.clusterId) ?? -1
                    : -1;
                  return segment.highlightIndex === null ? (
                    <span key={index}>{segment.text}</span>
                  ) : (
                    <mark
                      className={`${active ? "active" : seen ? "seen" : ""} cluster-tone-${Math.max(0, clusterIndex) % 5}`}
                      key={index}
                    >
                      {segment.text}
                    </mark>
                  );
                })}
                {phase === "analyzing" && <span className="reading-caret" aria-hidden="true" />}
              </div>
            )}

            <div className="analysis-actions">
              <button className="primary-button" onClick={analyze} disabled={busy || prompt.trim().length < 12}>
                {phase === "analyzing"
                  ? "Reading the question…"
                  : phase === "highlighting"
                    ? "Mapping hidden choices…"
                    : phase === "clustering"
                      ? "Clustering related cues…"
                    : phase === "transitioning"
                      ? "Opening interpretation map…"
                      : phase === "review"
                        ? "Re-run decomposition"
                        : "Map this question"}
              </button>
              <span>{prompt.length.toLocaleString()} / 5,000 characters</span>
            </div>
            {error && <p className="analysis-error" role="alert">{error}</p>}
          </div>

          <aside className="analysis-narrator" aria-live="polite" aria-atomic="true">
            <div className={"ai-orb " + (busy ? "thinking" : "")} aria-hidden="true"><span /></div>
            <div>
              <span className="narrator-kicker">
                {phase === "idle" || phase === "error"
                  ? "How this works"
                  : phase === "clustering"
                    ? "AI is clustering"
                    : phase === "review"
                      ? "Trace ready"
                      : "AI is reading"}
              </span>
              <h2>
                {phase === "analyzing" && "Finding words that change what evidence would count."}
                {phase === "highlighting" && (currentHighlight?.label || "Making hidden choices visible.")}
                {phase === "clustering" && (currentCluster?.label || "Grouping cues that imply the same variable.")}
                {phase === "review" && "Audit the decomposition before accepting the map."}
                {phase === "transitioning" && "The map is ready. Moving into the editing workspace."}
                {(phase === "idle" || phase === "error") && "First inspect the wording. Then generate the map."}
              </h2>
              <p>
                {phase === "highlighting"
                  ? currentHighlight?.why
                  : phase === "clustering"
                    ? currentCluster?.rationale
                    : phase === "review"
                      ? "Each cluster below shows the exact language, inferred variable, resulting axis, candidate branches, and evidence fields this decision will require."
                  : phase === "analyzing"
                    ? "The model is not answering yet. It is identifying constructs, populations, outcomes, comparators, contexts, and time horizons."
                    : phase === "transitioning"
                      ? "Each highlighted ambiguity is now connected to a reviewable interpretation axis."
                      : "The transition is deliberately paced so you can spot-check why each branch exists before seeing the full graph."}
              </p>
              {result?.warning && <div className="fallback-warning">{result.warning}</div>}
            </div>
            <div className="analysis-progress" aria-hidden="true">
              <span style={{ width: phase === "analyzing"
                ? "18%"
                : phase === "highlighting" && result
                  ? String(((activeHighlight + 1) / result.decomposition.highlights.length) * 42 + 18) + "%"
                  : phase === "clustering" && result
                    ? String(((activeCluster + 1) / result.decomposition.clusters.length) * 35 + 60) + "%"
                    : phase === "review" || phase === "transitioning" ? "100%" : "0%" }} />
            </div>
          </aside>
        </div>

        {result && (phase === "clustering" || phase === "review" || phase === "transitioning") && (
          <section className={`trace-board ${phase === "clustering" ? "building" : ""}`} aria-labelledby="trace-title">
            <div className="trace-heading">
              <div>
                <div className="eyebrow">Review before map generation</div>
                <h2 id="trace-title">Decomposition trace</h2>
                <p>Inspectable methodological rationale—not private model chain-of-thought.</p>
              </div>
              <span>{result.decomposition.clusters.length} semantic clusters</span>
            </div>

            <div className="trace-layout">
              <nav className="cluster-list" aria-label="Semantic clusters">
                {result.decomposition.clusters.map((cluster, index) => (
                  <button
                    className={index === activeCluster ? `active cluster-tone-${index % 5}` : ""}
                    disabled={phase === "clustering" && index > activeCluster}
                    key={cluster.id}
                    onClick={() => setActiveCluster(index)}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{cluster.label}</strong>
                    <small>{cluster.highlightQuotes.map((quote) => `“${quote}”`).join(" + ")}</small>
                  </button>
                ))}
              </nav>

              {currentCluster && currentAxis && (
                <article className="trace-detail" key={currentCluster.id}>
                  <div className="trace-step surface-step">
                    <span><b>01</b> Exact language</span>
                    <div className="cue-chips">
                      {currentCluster.highlightQuotes.map((quote) => <mark key={quote}>“{quote}”</mark>)}
                    </div>
                  </div>
                  <div className="trace-connector" aria-hidden="true">↓ grouped because they imply</div>
                  <div className="trace-step">
                    <span><b>02</b> Hidden variable</span>
                    <h3>{currentCluster.latentVariable}</h3>
                    <p>{currentCluster.rationale}</p>
                  </div>
                  <div className="trace-connector" aria-hidden="true">↓ becomes a reviewable axis</div>
                  <div className="trace-step axis-step">
                    <span><b>03</b> Interpretation axis</span>
                    <h3>{currentAxis.label}</h3>
                    <p>{currentAxis.question}</p>
                    <div className="branch-preview">
                      {currentAxis.branches.map((branch) => <em key={branch.id}>{branch.label}</em>)}
                    </div>
                  </div>
                  <div className="trace-connector" aria-hidden="true">↓ constrains evidence ingestion</div>
                  <div className="trace-step ingestion-step">
                    <span><b>04</b> Evidence contract</span>
                    <div className="ingestion-grid">
                      <div><strong>Required fields</strong><ul>{currentCluster.ingestionRequirements.requiredFields.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      <div><strong>Search concepts</strong><ul>{currentCluster.ingestionRequirements.searchConcepts.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      <div><strong>Mismatch risk</strong><ul>{currentCluster.ingestionRequirements.mismatchRisks.map((item) => <li key={item}>{item}</li>)}</ul></div>
                    </div>
                  </div>
                </article>
              )}
            </div>

            <div className="trace-actions">
              <p>Accepting the map does not accept any branch as true. It accepts this decomposition as the scope for retrieval and review.</p>
              <button className="primary-button" onClick={openMap} disabled={phase === "clustering"}>
                {phase === "clustering" ? "Building trace…" : "Open interpretation map →"}
              </button>
            </div>
          </section>
        )}

        <div className="analysis-principles" aria-label="Decomposition principles">
          <span><b>01</b> Exact phrases are highlighted</span>
          <span><b>02</b> Branches remain human-editable</span>
          <span><b>03</b> No ambiguity is treated as probability mass</span>
        </div>
      </section>
    </main>
  );
}
