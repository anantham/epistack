"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [activeTraceStep, setActiveTraceStep] = useState(0);
  const [assembledClusterCount, setAssembledClusterCount] = useState(0);
  const [error, setError] = useState("");
  const cueRefs = useRef(new Map<number, HTMLButtonElement>());
  const landingRefs = useRef(new Map<number, HTMLSpanElement>());

  const segments = useMemo(
    () => locateHighlights(prompt, result?.decomposition.highlights ?? []),
    [prompt, result],
  );
  const currentHighlight = result?.decomposition.highlights[activeHighlight] ?? null;
  const currentCluster: DecompositionCluster | null = result?.decomposition.clusters[activeCluster] ?? null;
  const busy = phase === "analyzing" || phase === "highlighting" || phase === "clustering" || phase === "transitioning";

  useEffect(() => {
    if (!result || phase !== "review") return;
    const steps = Array.from(document.querySelectorAll<HTMLElement>(".story-step"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !("IntersectionObserver" in window)) {
      steps.forEach((step) => step.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const step = entry.target as HTMLElement;
        step.classList.add("is-visible");
        setActiveCluster(Number(step.dataset.clusterIndex ?? 0));
        setActiveTraceStep(Number(step.dataset.stepIndex ?? 0));
      });
    }, { rootMargin: "-24% 0px -54% 0px", threshold: 0.08 });

    steps.forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, [phase, result]);

  async function animateClusterFlight(payload: DecompositionResponse, clusterIndex: number, reducedMotion: boolean) {
    const cluster = payload.decomposition.clusters[clusterIndex];
    const cues = payload.decomposition.highlights
      .map((highlight, highlightIndex) => ({ highlight, highlightIndex }))
      .filter(({ highlight }) => highlight.clusterId === cluster.id);

    if (reducedMotion) {
      await wait(50);
      return;
    }

    await Promise.all(cues.map(async ({ highlight, highlightIndex }, cueIndex) => {
      const source = cueRefs.current.get(highlightIndex);
      const target = landingRefs.current.get(highlightIndex);
      if (!source || !target) return;

      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const flyingCue = document.createElement("span");
      flyingCue.className = `flying-cue cluster-tone-${clusterIndex % 5}`;
      flyingCue.textContent = highlight.quote;
      flyingCue.setAttribute("aria-hidden", "true");
      Object.assign(flyingCue.style, {
        left: `${sourceRect.left}px`,
        top: `${sourceRect.top}px`,
        width: `${sourceRect.width}px`,
        height: `${sourceRect.height}px`,
      });
      document.body.appendChild(flyingCue);
      source.classList.add("is-departing");

      const deltaX = targetRect.left - sourceRect.left;
      const deltaY = targetRect.top - sourceRect.top;
      const animation = flyingCue.animate([
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
        { opacity: 1, offset: 0.24, transform: `translate3d(${deltaX * 0.16}px, ${Math.min(-26, deltaY * 0.12)}px, 0) scale(1.08)` },
        { opacity: 0.96, transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(0.78)` },
      ], {
        duration: 1050 + cueIndex * 130,
        easing: "cubic-bezier(0.22, 0.72, 0.18, 1)",
        fill: "forwards",
      });

      try {
        await animation.finished;
      } finally {
        flyingCue.remove();
        source.classList.remove("is-departing");
      }
    }));
  }

  async function analyze() {
    if (!prompt.trim() || busy) return;
    setError("");
    setResult(null);
    setActiveHighlight(-1);
    setActiveCluster(-1);
    setActiveTraceStep(0);
    setAssembledClusterCount(0);
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
      const highlightDelay = reducedMotion ? 80 : 720;
      for (let index = 0; index < payload.decomposition.highlights.length; index += 1) {
        setActiveHighlight(index);
        await wait(highlightDelay);
      }

      setPhase("clustering");
      await wait(reducedMotion ? 10 : 220);
      for (let index = 0; index < payload.decomposition.clusters.length; index += 1) {
        setActiveCluster(index);
        await animateClusterFlight(payload, index, reducedMotion);
        setAssembledClusterCount(index + 1);
        await wait(reducedMotion ? 35 : 220);
      }

      window.sessionStorage.setItem(decompositionSessionKey, JSON.stringify(payload));
      setActiveCluster(0);
      setActiveTraceStep(0);
      setPhase("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decomposition could not be generated.");
      setPhase("error");
    }
  }

  function inspectCluster(index: number, moveToTrace = false) {
    if (!result || index < 0 || index >= result.decomposition.clusters.length) return;
    setActiveCluster(index);
    setActiveTraceStep(0);
    if (moveToTrace) {
      window.requestAnimationFrame(() => {
        document.getElementById(`story-cluster-${result.decomposition.clusters[index].id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
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
          <div className={`analysis-main ${result ? "has-result" : ""}`}>
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
                  const linked = clusterIndex === activeCluster && (phase === "clustering" || phase === "review");
                  const deemphasized = activeCluster >= 0 && clusterIndex !== activeCluster && phase === "review";
                  return segment.highlightIndex === null ? (
                    <span key={index}>{segment.text}</span>
                  ) : (
                    <button
                      type="button"
                      className={`question-cue ${active ? "active" : seen ? "seen" : ""} ${linked ? "linked" : ""} ${deemphasized ? "deemphasized" : ""} cluster-tone-${Math.max(0, clusterIndex) % 5}`}
                      key={index}
                      disabled={!seen || clusterIndex < 0}
                      aria-label={highlight ? `Inspect ${highlight.label}: ${segment.text}` : undefined}
                      aria-pressed={linked}
                      onClick={() => inspectCluster(clusterIndex, true)}
                      ref={(node) => {
                        if (node) cueRefs.current.set(segment.highlightIndex as number, node);
                        else cueRefs.current.delete(segment.highlightIndex as number);
                      }}
                    >
                      {segment.text}
                    </button>
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
                      ? "Forming semantic clusters…"
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

          <aside className={`analysis-narrator ${result ? "has-result" : ""}`} aria-live="polite" aria-atomic="true">
            <div className={"ai-orb " + (busy ? "thinking" : "")} aria-hidden="true"><span /></div>
            <div>
              <span className="narrator-kicker">
                {phase === "idle" || phase === "error"
                  ? "How this works"
                  : phase === "clustering"
                    ? "AI is assembling"
                    : phase === "review"
                      ? "Trace ready"
                      : "AI is reading"}
              </span>
              <h2>
                {phase === "analyzing" && "Finding words that change what evidence would count."}
                {phase === "highlighting" && (currentHighlight?.label || "Making hidden choices visible.")}
                {phase === "clustering" && (currentCluster
                  ? `Moving words into “${currentCluster.label}”`
                  : "Grouping cues that imply the same variable.")}
                {phase === "review" && "Audit the decomposition before accepting the map."}
                {phase === "transitioning" && "The map is ready. Moving into the editing workspace."}
                {(phase === "idle" || phase === "error") && "First inspect the wording. Then generate the map."}
              </h2>
              <p>
                {phase === "highlighting"
                  ? currentHighlight?.why
                  : phase === "clustering"
                    ? currentCluster
                      ? `${currentCluster.highlightQuotes.map((quote) => `“${quote}”`).join(" + ")} jointly imply one hidden variable. The source words remain visible so you can audit the move.`
                      : "Related language is being grouped into candidate hidden variables."
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
            {result && phase !== "analyzing" && (
              <div className={`cluster-assembly ${phase === "clustering" ? "is-assembling" : ""}`} id="cluster-assembly" aria-label="Semantic cluster assembly">
                <div className="assembly-heading">
                  <span>{phase === "highlighting" ? "Preparing destinations" : phase === "clustering" ? "Words are forming clusters" : "Semantic clusters formed"}</span>
                  <small>{assembledClusterCount} / {result.decomposition.clusters.length}</small>
                </div>
                <div className="assembly-grid">
                  {result.decomposition.clusters.map((cluster, clusterIndex) => {
                    const clusterCues = result.decomposition.highlights
                      .map((highlight, highlightIndex) => ({ highlight, highlightIndex }))
                      .filter(({ highlight }) => highlight.clusterId === cluster.id);
                    const settled = clusterIndex < assembledClusterCount;
                    return (
                      <button
                        type="button"
                        className={`cluster-drop cluster-tone-${clusterIndex % 5} ${settled ? "settled" : ""} ${clusterIndex === activeCluster ? "active" : ""}`}
                        disabled={phase !== "review"}
                        key={cluster.id}
                        onClick={() => inspectCluster(clusterIndex, true)}
                        aria-label={`Inspect cluster ${cluster.label}`}
                        aria-pressed={phase === "review" && clusterIndex === activeCluster}
                      >
                        <span className="drop-index">{String(clusterIndex + 1).padStart(2, "0")}</span>
                        <strong>{cluster.label}</strong>
                        <span className="drop-cues">
                          {clusterCues.map(({ highlight, highlightIndex }) => (
                            <span
                              className="landing-cue"
                              key={`${cluster.id}-${highlightIndex}`}
                              ref={(node) => {
                                if (node) landingRefs.current.set(highlightIndex, node);
                                else landingRefs.current.delete(highlightIndex);
                              }}
                            >
                              {highlight.quote}
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="analysis-progress" aria-hidden="true">
              <span style={{ width: phase === "analyzing"
                ? "18%"
                : phase === "highlighting" && result
                  ? String(((activeHighlight + 1) / result.decomposition.highlights.length) * 42 + 18) + "%"
                  : phase === "clustering" && result
                    ? String(((assembledClusterCount / result.decomposition.clusters.length) * 35) + 60) + "%"
                    : phase === "review" || phase === "transitioning" ? "100%" : "0%" }} />
            </div>
          </aside>
        </div>

        {result && (phase === "review" || phase === "transitioning") && (
          <section className="story-board" aria-labelledby="trace-title">
            <div className="story-heading">
              <div>
                <div className="eyebrow">Scroll through the derivation</div>
                <h2 id="trace-title">Decomposition trace</h2>
                <p>The clusters are formed. Now follow each one from exact wording to the evidence it permits.</p>
              </div>
              <span>{result.decomposition.clusters.length} semantic clusters</span>
            </div>

            <div className="scroll-invitation" aria-hidden="true">
              <span>Scroll slowly to reveal the inference chain</span>
              <i>↓</i>
            </div>

            <div className="story-layout">
              <aside className="story-index">
                <span>Active thread</span>
                <nav aria-label="Semantic clusters">
                {result.decomposition.clusters.map((cluster, index) => (
                  <button
                    className={index === activeCluster ? `active cluster-tone-${index % 5}` : ""}
                    key={cluster.id}
                    onClick={() => inspectCluster(index, true)}
                    aria-pressed={index === activeCluster}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{cluster.label}</strong>
                    <small>{cluster.highlightQuotes.map((quote) => `“${quote}”`).join(" + ")}</small>
                  </button>
                ))}
                </nav>
                <p>Active step {activeTraceStep + 1} of 4</p>
              </aside>

              <div className="story-stream">
                {result.decomposition.clusters.map((cluster, clusterIndex) => {
                  const axis = result.decomposition.axes.find((item) => item.id === cluster.axisId);
                  if (!axis) return null;
                  return (
                    <article className={`story-chapter cluster-tone-${clusterIndex % 5}`} id={`story-cluster-${cluster.id}`} key={cluster.id}>
                      <header>
                        <span>Cluster {String(clusterIndex + 1).padStart(2, "0")}</span>
                        <h3>{cluster.label}</h3>
                        <div className="chapter-cues">{cluster.highlightQuotes.map((quote) => <mark key={quote}>“{quote}”</mark>)}</div>
                      </header>

                      <div className="story-flow" aria-label={`Inference chain for ${cluster.label}`}>
                        <section className="story-step" data-cluster-index={clusterIndex} data-step-index="0">
                          <span><b>01</b> Exact language</span>
                          <div className="cue-chips cluster-equation">
                            {cluster.highlightQuotes.map((quote, index) => (
                              <span key={quote}>{index > 0 && <i aria-hidden="true">+</i>}<mark>“{quote}”</mark></span>
                            ))}
                          </div>
                          <p>These literal cues license the interpretation. The system preserves them rather than paraphrasing away their origin.</p>
                        </section>
                        <div className="story-connector"><span>grouped because they imply</span><i>↓</i></div>
                        <section className="story-step" data-cluster-index={clusterIndex} data-step-index="1">
                          <span><b>02</b> Hidden variable</span>
                          <h4>{cluster.latentVariable}</h4>
                          <p>{cluster.rationale}</p>
                        </section>
                        <div className="story-connector"><span>made reviewable as</span><i>↓</i></div>
                        <section className="story-step axis-story-step" data-cluster-index={clusterIndex} data-step-index="2">
                          <span><b>03</b> Interpretation axis</span>
                          <h4>{axis.label}</h4>
                          <p>{axis.question}</p>
                          <div className="branch-preview">{axis.branches.map((branch) => <em key={branch.id}>{branch.label}</em>)}</div>
                        </section>
                        <div className="story-connector"><span>constrains what evidence may count</span><i>↓</i></div>
                        <section className="story-step evidence-story-step" data-cluster-index={clusterIndex} data-step-index="3">
                          <span><b>04</b> Evidence contract</span>
                          <div className="ingestion-grid">
                            <div><strong>Required fields</strong><ul>{cluster.ingestionRequirements.requiredFields.map((item) => <li key={item}>{item}</li>)}</ul></div>
                            <div><strong>Search concepts</strong><ul>{cluster.ingestionRequirements.searchConcepts.map((item) => <li key={item}>{item}</li>)}</ul></div>
                            <div><strong>Mismatch risk</strong><ul>{cluster.ingestionRequirements.mismatchRisks.map((item) => <li key={item}>{item}</li>)}</ul></div>
                          </div>
                        </section>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="story-completion">
              <p>Accepting the map does not accept any branch as true. It accepts this decomposition as the scope for retrieval and review.</p>
              <button className="primary-button" onClick={openMap}>
                Open interpretation map →
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
