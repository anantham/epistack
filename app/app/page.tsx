"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  DecompositionResponse,
  QuestionHighlight,
} from "../lib/decomposition";
import { decompositionSessionKey } from "../lib/decomposition";

const defaultOpenRouterModel = "anthropic/claude-sonnet-4.6";
const brandCharacters = [..."epistack"];
const analysisDurationsKey = "epistack:analysis-durations:v1";
const legacyAnalysisDurationsKey = "epistack_decomp_ms";
const provisionalEstimateMs = 90_000;
const loadingSteps = [
  "bisecting the question",
  "isolating load-bearing words",
  "mapping hidden comparators",
  "clustering related ideas",
  "testing dimensions of perturbation",
  "unbundling the options",
  "tracing constraint cascades",
  "probing population mismatches",
  "ranking high-information follow-ups",
  "compiling evidence requirements",
  "stress-testing claim boundaries",
  "checking what the question leaves unsaid",
];

type AnalysisPhase = "idle" | "analyzing" | "eliciting" | "review" | "transitioning" | "error";
type ConnectionStatus = { state: "idle" | "checking" | "valid" | "invalid"; message: string };

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

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [decisionContext, setDecisionContext] = useState("");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [openRouterModel, setOpenRouterModel] = useState(defaultOpenRouterModel);
  const [introComplete, setIntroComplete] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ state: "idle", message: "Press Enter to validate." });
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [result, setResult] = useState<DecompositionResponse | null>(null);
  const [activeCluster, setActiveCluster] = useState(-1);
  const [activeTraceStep, setActiveTraceStep] = useState(0);
  const [elicitationIndex, setElicitationIndex] = useState(0);
  const [revealedClusters, setRevealedClusters] = useState<number[]>([]);
  const [contextAnswers, setContextAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loadingStep, setLoadingStep] = useState(0);
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const [analysisDurations, setAnalysisDurations] = useState<number[]>([]);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const storyCueRefs = useRef(new Map<number, HTMLButtonElement>());
  const storyLandingRefs = useRef(new Map<number, HTMLElement>());
  const revealedClustersRef = useRef(new Set<number>());

  const segments = useMemo(
    () => locateHighlights(prompt, result?.decomposition.highlights ?? []),
    [prompt, result],
  );
  const currentContextQuestion = result?.decomposition.contextQuestions[elicitationIndex] ?? null;
  const busy = phase === "analyzing" || phase === "transitioning";
  const empiricalDuration = useMemo(() => median(analysisDurations), [analysisDurations]);
  const expectedDuration = empiricalDuration ?? provisionalEstimateMs;
  const remainingDuration = expectedDuration - analysisElapsed;
  const countdown = formatCountdown(Math.abs(remainingDuration));
  const analysisProgress = Math.min(94, Math.max(3, (analysisElapsed / expectedDuration) * 100));

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setIntroComplete(true), reducedMotion ? 0 : 3300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const current = window.localStorage.getItem(analysisDurationsKey);
        const legacy = window.localStorage.getItem(legacyAnalysisDurationsKey);
        const saved = JSON.parse(current || legacy || "[]") as unknown;
        if (Array.isArray(saved)) {
          setAnalysisDurations(saved.filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0).slice(-12));
        }
      } catch {
        setAnalysisDurations([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase !== "analyzing") return;
    const startedAt = window.performance.now();
    const stepTimer = window.setInterval(
      () => setLoadingStep((step) => (step + 1) % loadingSteps.length),
      3200,
    );
    const elapsedTimer = window.setInterval(
      () => setAnalysisElapsed(window.performance.now() - startedAt),
      200,
    );
    return () => {
      window.clearInterval(stepTimer);
      window.clearInterval(elapsedTimer);
    };
  }, [phase]);

  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.max(210, input.scrollHeight)}px`;
  }, [prompt, introComplete, phase]);

  async function animateStoryClusterFlight(payload: DecompositionResponse, clusterIndex: number, reducedMotion: boolean) {
    const cluster = payload.decomposition.clusters[clusterIndex];
    const cues = payload.decomposition.highlights
      .map((highlight, highlightIndex) => ({ highlight, highlightIndex }))
      .filter(({ highlight }) => highlight.clusterId === cluster.id);

    if (reducedMotion) {
      await wait(50);
      return;
    }

    await Promise.all(cues.map(async ({ highlight, highlightIndex }, cueIndex) => {
      const source = storyCueRefs.current.get(highlightIndex);
      const target = storyLandingRefs.current.get(highlightIndex);
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

  useEffect(() => {
    if (!result || phase !== "review") return;
    const chapters = Array.from(document.querySelectorAll<HTMLElement>(".story-chapter"));
    const steps = Array.from(document.querySelectorAll<HTMLElement>(".story-step"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!("IntersectionObserver" in window)) {
      steps.forEach((step) => step.classList.add("is-visible"));
      window.setTimeout(() => {
        setRevealedClusters(result.decomposition.clusters.map((_, index) => index));
      }, 0);
      return;
    }

    const chapterObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const clusterIndex = Number((visible.target as HTMLElement).dataset.clusterIndex ?? 0);
      setActiveCluster(clusterIndex);
      if (revealedClustersRef.current.has(clusterIndex)) return;
      revealedClustersRef.current.add(clusterIndex);
      setRevealedClusters(Array.from(revealedClustersRef.current).sort((a, b) => a - b));
      window.setTimeout(() => {
        void animateStoryClusterFlight(result, clusterIndex, reducedMotion);
      }, reducedMotion ? 0 : 180);
    }, { rootMargin: "-18% 0px -52% 0px", threshold: [0.08, 0.2, 0.45] });

    const stepObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const step = entry.target as HTMLElement;
        step.classList.add("is-visible");
        setActiveCluster(Number(step.dataset.clusterIndex ?? 0));
        setActiveTraceStep(Number(step.dataset.stepIndex ?? 0));
      });
    }, { rootMargin: "-24% 0px -54% 0px", threshold: 0.08 });

    chapters.forEach((chapter) => chapterObserver.observe(chapter));
    steps.forEach((step) => stepObserver.observe(step));
    return () => {
      chapterObserver.disconnect();
      stepObserver.disconnect();
    };
  }, [phase, result]);

  async function analyze(contextOverride?: string, skipElicitation = false) {
    if (!prompt.trim() || busy) return;
    if (!openRouterKey.trim()) {
      setError("Add an OpenRouter key in Settings to decompose this question.");
      setSettingsOpen(true);
      setPhase("error");
      return;
    }
    setError("");
    setResult(null);
    setActiveCluster(-1);
    setActiveTraceStep(0);
    setElicitationIndex(0);
    setRevealedClusters([]);
    if (!skipElicitation) setContextAnswers({});
    revealedClustersRef.current.clear();
    setLoadingStep(0);
    setAnalysisElapsed(0);
    setPhase("analyzing");

    const contextForRequest = typeof contextOverride === "string" ? contextOverride : decisionContext;
    const requestStartedAt = window.performance.now();

    try {
      const response = await fetch("/api/decompose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          decisionContext: contextForRequest,
          openRouterApiKey: openRouterKey.trim() || undefined,
          openRouterModel: openRouterModel.trim() || undefined,
        }),
      });
      const payload = await response.json() as DecompositionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The decomposition could not be generated.");

      const duration = window.performance.now() - requestStartedAt;
      setAnalysisDurations((current) => {
        const next = [...current, duration].slice(-12);
        try {
          window.localStorage.setItem(analysisDurationsKey, JSON.stringify(next));
        } catch {
          // Latency history is optional; never block the decomposition.
        }
        return next;
      });

      setResult(payload);
      window.sessionStorage.setItem(decompositionSessionKey, JSON.stringify(payload));
      setDecisionContext(contextForRequest);
      setActiveCluster(-1);
      setActiveTraceStep(0);
      setPhase(!skipElicitation && !contextForRequest && payload.decomposition.contextQuestions.length
        ? "eliciting"
        : "review");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The decomposition could not be generated.";
      setError(message);
      if (/key|OpenRouter|credits|model|provider|endpoint/i.test(message)) setSettingsOpen(true);
      setPhase("error");
    }
  }

  async function validateConnection() {
    if (connectionStatus.state === "checking") return;
    if (!openRouterKey.trim()) {
      setConnectionStatus({ state: "invalid", message: "Enter an API key before validating." });
      return;
    }
    if (!openRouterModel.trim()) {
      setConnectionStatus({ state: "invalid", message: "Enter a model ID in provider/model form." });
      return;
    }

    setConnectionStatus({ state: "checking", message: "Checking key, credits, and model…" });
    try {
      const response = await fetch("/api/openrouter/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          openRouterApiKey: openRouterKey.trim(),
          openRouterModel: openRouterModel.trim(),
        }),
      });
      const payload = await response.json() as { ok?: boolean; message?: string };
      setConnectionStatus({
        state: response.ok && payload.ok ? "valid" : "invalid",
        message: payload.message || "OpenRouter did not return a validation result.",
      });
    } catch {
      setConnectionStatus({ state: "invalid", message: "Could not reach OpenRouter. Check the connection and try again." });
    }
  }

  async function refineWithContext() {
    if (!result) return;
    const additions = result.decomposition.contextQuestions
      .map((question) => ({ question, answer: contextAnswers[question.id]?.trim() }))
      .filter((item) => item.answer)
      .map((item) => `${item.question.label}: ${item.answer}`);
    if (!additions.length) {
      setPhase("review");
      return;
    }
    const nextContext = [decisionContext.trim(), ...additions].filter(Boolean).join("\n");
    setDecisionContext(nextContext);
    window.scrollTo({ top: 0, behavior: "smooth" });
    await analyze(nextContext, true);
  }

  function advanceElicitation() {
    if (!result) return;
    if (elicitationIndex < result.decomposition.contextQuestions.length - 1) {
      setElicitationIndex((index) => index + 1);
      return;
    }
    void refineWithContext();
  }

  function returnToEditor() {
    setResult(null);
    setError("");
    setPhase("idle");
    setActiveCluster(-1);
    setRevealedClusters([]);
    revealedClustersRef.current.clear();
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    <main className="intro-root">
      <div className="brand-intro" aria-label="Epistack">
        {brandCharacters.map((character, index) => (
          <span key={`${character}-${index}`} style={{ animationDelay: `${index * 110}ms` }} aria-hidden="true">{character}</span>
        ))}
        <i aria-hidden="true">.</i>
      </div>

      <div className={`intro-surface ${introComplete ? "is-ready" : ""}`} aria-hidden={!introComplete}>
        <header className="minimal-topbar">
          <button
            type="button"
            className="icon-button settings-trigger"
            aria-label="Settings"
            aria-expanded={settingsOpen}
            data-tooltip="Settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <span aria-hidden="true">⚙︎</span>
          </button>

          {settingsOpen && (
            <form className="settings-panel" role="dialog" aria-label="Model settings" onSubmit={(event) => {
              event.preventDefault();
              void validateConnection();
            }}>
              <div className="settings-heading">
                <strong>Settings</strong>
                <button type="button" className="icon-button" aria-label="Close settings" data-tooltip="Close" onClick={() => setSettingsOpen(false)}>×</button>
              </div>
              <label>
                <span>API key</span>
                <input
                  type="password"
                  value={openRouterKey}
                  onChange={(event) => {
                    setOpenRouterKey(event.target.value);
                    setConnectionStatus({ state: "idle", message: "Press Enter to validate." });
                  }}
                  placeholder="sk-or-v1-…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label>
                <span>Model</span>
                <input
                  type="text"
                  value={openRouterModel}
                  onChange={(event) => {
                    setOpenRouterModel(event.target.value);
                    setConnectionStatus({ state: "idle", message: "Press Enter to validate." });
                  }}
                  placeholder={defaultOpenRouterModel}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div className="settings-footer">
                <p className={`connection-status ${connectionStatus.state}`} role="status">
                  <i aria-hidden="true" />{connectionStatus.message}
                </p>
                <div className="settings-actions">
                  <button type="button" className="settings-info" aria-label="Key privacy" data-tooltip="The key stays in memory for this tab and is never added to the case artifact.">?</button>
                  <button
                    type="submit"
                    className="settings-validate"
                    aria-label="Validate connection"
                    data-tooltip="Validate key and model"
                    disabled={connectionStatus.state === "checking"}
                  >{connectionStatus.state === "checking" ? "…" : "✓"}</button>
                </div>
              </div>
            </form>
          )}
        </header>

        <section className={`analysis-shell clean-shell ${phase === "transitioning" ? "leaving" : ""}`}>
          {(phase === "idle" || phase === "error") && (
            <section className="minimal-composer" aria-label="Question composer">
              <div className="question-composer">
                <textarea
                  ref={composerInputRef}
                  className="composer-input"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={5}
                  maxLength={5000}
                  placeholder="what is your question?"
                  aria-label="Research question"
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void analyze();
                    }
                  }}
                />
                <button
                  type="button"
                  className="composer-submit"
                  aria-label="Decompose question"
                  data-tooltip={prompt.trim().length < 12 ? "Write a fuller question" : "Decompose into testable claims · ⌘↵"}
                  disabled={busy || prompt.trim().length < 12}
                  onClick={() => void analyze()}
                >
                  <span className="decompose-icon" aria-hidden="true"><i /><i /><i /><i /></span>
                </button>
                {error && <p className="composer-error" role="alert">{error}</p>}
              </div>
            </section>
          )}

          {phase === "analyzing" && (
            <section className="phase-screen" aria-live="polite">
              <div className="ai-orb thinking" aria-hidden="true"><span /></div>
              <div className="loading-copy">
                <p className="loading-operation" key={loadingStep}>{loadingSteps[loadingStep]}…</p>
                <div className="loading-eta" aria-label={remainingDuration > 0 ? `${countdown} estimated time remaining` : `${countdown} past the estimate`}>
                  <strong>{remainingDuration > 0 ? countdown : `+${countdown}`}</strong>
                  <span>{remainingDuration > 0 ? "remaining" : "past estimate"}</span>
                </div>
                <div className="loading-rail" aria-hidden="true"><span style={{ width: `${analysisProgress}%` }} /></div>
                <small>
                  {empiricalDuration === null
                    ? "provisional benchmark · this run will recalibrate it"
                    : `empirical ETA · median of ${analysisDurations.length} successful run${analysisDurations.length === 1 ? "" : "s"}`}
                </small>
              </div>
            </section>
          )}

          {phase === "eliciting" && result && currentContextQuestion && (
            <section className="elicitation-screen" aria-label="Context interview">
              <div className="elicitation-card" key={currentContextQuestion.id}>
                <div className="elicitation-meta">
                  <span>{elicitationIndex + 1} / {result.decomposition.contextQuestions.length}</span>
                  <button
                    type="button"
                    className="icon-button context-info"
                    aria-label={`Why this question matters: ${currentContextQuestion.whyItMatters}`}
                    data-tooltip={`${currentContextQuestion.effect}: ${currentContextQuestion.whyItMatters}`}
                  >?</button>
                </div>
                <h1>{currentContextQuestion.question}</h1>
                <div className="context-options" aria-label="Suggested answers">
                  {currentContextQuestion.options.map((option) => (
                    <button
                      type="button"
                      className={(contextAnswers[currentContextQuestion.id] ?? "") === option ? "selected" : ""}
                      key={option}
                      onClick={() => setContextAnswers((current) => ({ ...current, [currentContextQuestion.id]: option }))}
                    >{option}</button>
                  ))}
                </div>
                <input
                  type="text"
                  value={contextAnswers[currentContextQuestion.id] ?? ""}
                  onChange={(event) => setContextAnswers((current) => ({ ...current, [currentContextQuestion.id]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") advanceElicitation();
                  }}
                  placeholder="type your answer…"
                  aria-label={currentContextQuestion.question}
                  autoFocus
                />
                <div className="elicitation-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Previous question"
                    data-tooltip="Previous"
                    disabled={elicitationIndex === 0}
                    onClick={() => setElicitationIndex((index) => Math.max(0, index - 1))}
                  >←</button>
                  <div className="elicitation-dots" aria-hidden="true">
                    {result.decomposition.contextQuestions.map((question, index) => <i className={index === elicitationIndex ? "active" : ""} key={question.id} />)}
                  </div>
                  <button
                    type="button"
                    className="icon-button elicitation-next"
                    aria-label={elicitationIndex === result.decomposition.contextQuestions.length - 1 ? "Refine decomposition" : "Next question"}
                    data-tooltip={elicitationIndex === result.decomposition.contextQuestions.length - 1 ? "Refine decomposition" : "Next"}
                    onClick={advanceElicitation}
                  >→</button>
                </div>
              </div>
            </section>
          )}

          {result && (phase === "review" || phase === "transitioning") && (
          <section className="story-board" aria-labelledby="trace-title">
            <button type="button" className="icon-button review-back" aria-label="Edit question" data-tooltip="Edit question" onClick={returnToEditor}>←</button>
            <div className="story-heading">
              <div>
                <h2 id="trace-title">Decomposition</h2>
              </div>
              <span>{result.decomposition.clusters.length} semantic clusters</span>
            </div>

            <div className="scroll-invitation" aria-hidden="true">
              <span>Scroll slowly to reveal the inference chain</span>
              <i>↓</i>
            </div>

            <div className="story-layout">
              <aside className="story-index story-question-rail">
                <div className="pinned-question" aria-label="Question with scroll-activated semantic clusters">
                  {segments.map((segment, index) => {
                    if (segment.highlightIndex === null) return <span key={index}>{segment.text}</span>;
                    const highlight = result.decomposition.highlights[segment.highlightIndex];
                    const clusterIndex = result.decomposition.clusters.findIndex((cluster) => cluster.id === highlight.clusterId);
                    const revealed = revealedClusters.includes(clusterIndex);
                    const active = clusterIndex === activeCluster;
                    return (
                      <button
                        type="button"
                        className={`pinned-cue cluster-tone-${Math.max(0, clusterIndex) % 5} ${revealed ? "revealed" : ""} ${active ? "active" : ""}`}
                        key={index}
                        disabled={!revealed}
                        onClick={() => inspectCluster(clusterIndex, true)}
                        ref={(node) => {
                          if (node) storyCueRefs.current.set(segment.highlightIndex as number, node);
                          else storyCueRefs.current.delete(segment.highlightIndex as number);
                        }}
                      >
                        {segment.text}
                      </button>
                    );
                  })}
                </div>
                <nav aria-label="Semantic clusters">
                {result.decomposition.clusters.map((cluster, index) => (
                  <button
                    className={`${index === activeCluster ? "active" : ""} ${revealedClusters.includes(index) ? "revealed" : ""} cluster-tone-${index % 5}`}
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
                <p>{activeCluster < 0 ? "Scroll to activate the first cluster" : `Active step ${activeTraceStep + 1} of 4`}</p>
              </aside>

              <div className="story-stream">
                {result.decomposition.clusters.map((cluster, clusterIndex) => {
                  const axis = result.decomposition.axes.find((item) => item.id === cluster.axisId);
                  if (!axis) return null;
                  return (
                    <article
                      className={`story-chapter cluster-tone-${clusterIndex % 5} ${revealedClusters.includes(clusterIndex) ? "is-revealed" : ""} ${activeCluster === clusterIndex ? "is-active" : ""}`}
                      id={`story-cluster-${cluster.id}`}
                      key={cluster.id}
                      data-cluster-index={clusterIndex}
                    >
                      <header>
                        <span>Cluster {String(clusterIndex + 1).padStart(2, "0")}</span>
                        <h3>{cluster.label}</h3>
                        <div className="chapter-cues">{cluster.highlightQuotes.map((quote) => {
                          const highlightIndex = result.decomposition.highlights.findIndex(
                            (highlight) => highlight.clusterId === cluster.id && highlight.quote === quote,
                          );
                          return (
                            <mark
                              key={quote}
                              ref={(node) => {
                                if (node && highlightIndex >= 0) storyLandingRefs.current.set(highlightIndex, node);
                                else if (highlightIndex >= 0) storyLandingRefs.current.delete(highlightIndex);
                              }}
                            >
                              “{quote}”
                            </mark>
                          );
                        })}</div>
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
        </section>
      </div>
    </main>
  );
}
