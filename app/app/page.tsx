"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { StageNav } from "./components/case-navigation";
import type {
  DecompositionResponse,
  QuestionHighlight,
} from "../lib/decomposition";
import { decompositionSessionKey, interpretationMapStorageKey } from "../lib/decomposition";
import {
  agentPromptStorageKey,
  promptOverridesSignature,
  sanitizeAgentPromptOverrides,
  type AgentPromptOverrides,
} from "../lib/agent-prompts";

const defaultOpenRouterModel = "anthropic/claude-opus-4.8";
const previousDefaultOpenRouterModel = "anthropic/claude-sonnet-4.6";
const brandCharacters = [..."epistack"];
const analysisDurationsKey = "epistack:analysis-durations:v1";
const legacyAnalysisDurationsKey = "epistack_decomp_ms";
const preferencesStorageKey = "epistack:preferences:v1";
const workspaceStorageKey = "epistack:workspace:v1";
const decompositionBrowserCacheKey = "epistack:decomposition-operation-cache:v3";
const decompositionBrowserCacheContract = "question-decomposition-orchestrator-v3";
const provisionalEstimateMs = 90_000;
const loadingSteps = [
  "scouting substantive dimensions",
  "unbundling concrete resolutions",
  "mapping exact language cues",
  "tracing hidden comparators",
  "planning high-value context questions",
  "compiling retrieval requirements",
  "checking construct mismatches",
  "merging specialist contracts",
];

type AnalysisPhase = "idle" | "analyzing" | "eliciting" | "review" | "transitioning" | "error";
type IntroPhase = "typing" | "holding" | "docking" | "ready";
type ConnectionStatus = { state: "idle" | "checking" | "valid" | "invalid"; message: string };
type PersistedPreferences = { apiKey?: string; model?: string };
type PersistedWorkspace = {
  prompt?: string;
  decisionContext?: string;
  result?: DecompositionResponse | null;
  contextAnswers?: Record<string, string>;
  contextSelections?: Record<string, string[]>;
  elicitationIndex?: number;
  phase?: "idle" | "eliciting" | "review";
};
type BrowserDecompositionCache = {
  contract: typeof decompositionBrowserCacheContract;
  prompt: string;
  decisionContext: string;
  model: string;
  promptSignature: string;
  savedAt: string;
  result: DecompositionResponse;
};

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
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function decompositionCacheLabel(result: DecompositionResponse) {
  if (result.cache.status === "browser") return "restored instantly";
  if (result.cache.status === "hit") return "reused · no model call";
  if (result.cache.status === "bypass") return "recomputed live";
  return result.mode === "ai" ? "orchestrated live" : "editable fallback";
}

function storedAgentPromptOverrides(): AgentPromptOverrides {
  try {
    return sanitizeAgentPromptOverrides(JSON.parse(window.localStorage.getItem(agentPromptStorageKey) || "{}"));
  } catch {
    return {};
  }
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [decisionContext, setDecisionContext] = useState("");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [openRouterModel, setOpenRouterModel] = useState(defaultOpenRouterModel);
  const [introPhase, setIntroPhase] = useState<IntroPhase>("typing");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ state: "idle", message: "Press Enter to validate." });
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [result, setResult] = useState<DecompositionResponse | null>(null);
  const [activeCluster, setActiveCluster] = useState(-1);
  const [activeTraceStep, setActiveTraceStep] = useState(0);
  const [elicitationIndex, setElicitationIndex] = useState(0);
  const [revealedClusters, setRevealedClusters] = useState<number[]>([]);
  const [contextAnswers, setContextAnswers] = useState<Record<string, string>>({});
  const [contextSelections, setContextSelections] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<any>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const [analysisDurations, setAnalysisDurations] = useState<number[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const storyCueRefs = useRef(new Map<number, HTMLButtonElement>());
  const storyLandingRefs = useRef(new Map<number, HTMLElement>());
  const revealedClustersRef = useRef(new Set<number>());

  const segments = useMemo(
    () => locateHighlights(prompt, result?.decomposition.highlights ?? []),
    [prompt, result],
  );
  const currentContextQuestion = null;
  const busy = phase === "analyzing" || phase === "transitioning";
  const empiricalDuration = useMemo(() => median(analysisDurations), [analysisDurations]);
  const expectedDuration = empiricalDuration ?? provisionalEstimateMs;
  const remainingDuration = expectedDuration - analysisElapsed;
  const countdown = formatCountdown(Math.abs(remainingDuration));
  const analysisProgress = Math.min(94, Math.max(3, (analysisElapsed / expectedDuration) * 100));
  const introComplete = introPhase === "ready";
  const brandDocked = introPhase === "docking" || introComplete;

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      const reducedMotionTimer = setTimeout(() => setIntroPhase("ready"), 0);
      return () => window.clearTimeout(reducedMotionTimer);
    }

    const holdTimer = setTimeout(() => setIntroPhase("holding"), 1300);
    const dockTimer = setTimeout(() => setIntroPhase("docking"), 2600);
    const readyTimer = setTimeout(() => setIntroPhase("ready"), 4800);
    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(dockTimer);
      window.clearTimeout(readyTimer);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
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
    const timer = setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("settings") === "1") {
        setSettingsOpen(true);
      }
      try {
        const savedPreferences = JSON.parse(window.localStorage.getItem(preferencesStorageKey) || "{}") as PersistedPreferences;
        if (typeof savedPreferences.apiKey === "string") {
          setOpenRouterKey(savedPreferences.apiKey);
          if (savedPreferences.apiKey.trim()) {
            setConnectionStatus({ state: "idle", message: "Saved in this browser. Press Enter to revalidate." });
          }
        }
        if (typeof savedPreferences.model === "string" && savedPreferences.model.trim()) {
          const savedModel = savedPreferences.model.trim();
          setOpenRouterModel(savedModel === previousDefaultOpenRouterModel ? defaultOpenRouterModel : savedModel);
        }
      } catch {
        // Invalid local preferences should never block the app.
      }

      try {
        const savedWorkspace = JSON.parse(window.localStorage.getItem(workspaceStorageKey) || "{}") as PersistedWorkspace;
        const legacyResult = window.sessionStorage.getItem(decompositionSessionKey);
        const hasSavedResult = Object.prototype.hasOwnProperty.call(savedWorkspace, "result");
        const restoredResult = hasSavedResult
          ? savedWorkspace.result ?? null
          : legacyResult ? JSON.parse(legacyResult) as DecompositionResponse : null;
        if (typeof savedWorkspace.prompt === "string") setPrompt(savedWorkspace.prompt);
        if (typeof savedWorkspace.decisionContext === "string") setDecisionContext(savedWorkspace.decisionContext);
        if (savedWorkspace.contextAnswers && typeof savedWorkspace.contextAnswers === "object") {
          setContextAnswers(savedWorkspace.contextAnswers);
        }
        if (savedWorkspace.contextSelections && typeof savedWorkspace.contextSelections === "object") {
          setContextSelections(savedWorkspace.contextSelections);
        }
        if (typeof savedWorkspace.elicitationIndex === "number") {
          setElicitationIndex(Math.max(0, savedWorkspace.elicitationIndex));
        }
        if (restoredResult?.decomposition) {
          const restoredWithCache: DecompositionResponse = {
            ...restoredResult,
            cache: { status: "browser", layer: "browser", createdAt: new Date().toISOString(), expiresAt: null },
          };
          setResult(restoredWithCache);
          if (!savedWorkspace.prompt) setPrompt(restoredResult.prompt);
          if (!savedWorkspace.decisionContext) setDecisionContext(restoredResult.decisionContext ?? "");
          const canResumeInterview = savedWorkspace.phase === "eliciting" && restoredResult.decomposition.clusters.length > 0;
          setPhase(canResumeInterview ? "eliciting" : "review");
        }
      } catch {
        // A stale investigation cache can be replaced by the next successful run.
      }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const timer = setTimeout(() => {
      try {
        const preferences = JSON.stringify({ apiKey: openRouterKey, model: openRouterModel });
        window.localStorage.setItem(preferencesStorageKey, preferences);
      } catch {
        // Browser persistence is a convenience; requests still work without it.
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [openRouterKey, openRouterModel, storageReady]);

  useEffect(() => {
    if (!storageReady || phase === "analyzing" || phase === "transitioning") return;
    const timer = setTimeout(() => {
      try {
        const persistedPhase = phase === "eliciting" ? "eliciting" : result ? "review" : "idle";
        const workspace = JSON.stringify({
          prompt,
          decisionContext,
          result,
          contextAnswers,
          contextSelections,
          elicitationIndex,
          phase: persistedPhase,
        });
        window.localStorage.setItem(workspaceStorageKey, workspace);
      } catch {
        // Keep the live session usable even if storage is unavailable or full.
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [contextAnswers, contextSelections, decisionContext, elicitationIndex, phase, prompt, result, storageReady]);

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
      setTimeout(() => {
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
      setTimeout(() => {
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

  
  function saveClusterEdit() {
    if (!result || !editDraft) return;
    const newClusters = result.decomposition.clusters.map(c => c.id === editDraft.id ? editDraft : c);
    setResult({
      ...result,
      decomposition: {
        ...result.decomposition,
        clusters: newClusters
      }
    });
    setEditingClusterId(null);
    setEditDraft(null);
  }

  async function analyze(contextOverride?: string, skipElicitation = false, refresh = false) {
    if (!prompt.trim() || busy) return;
    const contextForRequest = typeof contextOverride === "string" ? contextOverride : decisionContext;
    const normalizedPrompt = prompt.trim();
    const normalizedModel = openRouterModel.trim() || defaultOpenRouterModel;
    const promptOverrides = storedAgentPromptOverrides();
    const promptSignature = promptOverridesSignature(promptOverrides);
    setError("");
    setResult(null);
    setActiveCluster(-1);
    setActiveTraceStep(0);
    setElicitationIndex(0);
    setRevealedClusters([]);
    if (!skipElicitation) {
      setContextAnswers({});
      setContextSelections({});
    }
    revealedClustersRef.current.clear();
    setLoadingStep(0);
    setAnalysisElapsed(0);

    if (!refresh) {
      try {
        const cached = JSON.parse(window.localStorage.getItem(decompositionBrowserCacheKey) || "null") as BrowserDecompositionCache | null;
        if (cached
          && cached.contract === decompositionBrowserCacheContract
          && cached.prompt === normalizedPrompt
          && cached.decisionContext === contextForRequest
          && cached.model === normalizedModel
          && cached.promptSignature === promptSignature
          && cached.result?.decomposition) {
          const browserResult: DecompositionResponse = {
            ...cached.result,
            cache: { status: "browser", layer: "browser", createdAt: cached.savedAt, expiresAt: null },
          };
          setResult(browserResult);
          window.sessionStorage.setItem(decompositionSessionKey, JSON.stringify(browserResult));
          setDecisionContext(contextForRequest);
          setPhase(!skipElicitation && !contextForRequest && browserResult.decomposition.clusters.length
            ? "eliciting"
            : "review");
          return;
        }
      } catch {
        window.localStorage.removeItem(decompositionBrowserCacheKey);
      }
    }

    if (!openRouterKey.trim()) {
      setError("No reusable decomposition is cached for this question and model. Add an OpenRouter key in Settings to create one.");
      setSettingsOpen(true);
      setPhase("error");
      return;
    }
    setPhase("analyzing");
    const requestStartedAt = window.performance.now();

    try {
      const response = await fetch("/api/decompose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          decisionContext: contextForRequest,
          openRouterApiKey: openRouterKey.trim() || undefined,
          openRouterModel: normalizedModel,
          promptOverrides,
          refresh,
        }),
      });
      const payload = await response.json() as DecompositionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The decomposition could not be generated.");

      if (payload.cache.status === "miss" || payload.cache.status === "bypass") {
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
      }

      setResult(payload);
      window.sessionStorage.setItem(decompositionSessionKey, JSON.stringify(payload));
      window.localStorage.setItem(decompositionSessionKey, JSON.stringify(payload));
      if (payload.mode === "ai") {
        const browserCache: BrowserDecompositionCache = {
          contract: decompositionBrowserCacheContract,
          prompt: normalizedPrompt,
          decisionContext: contextForRequest,
          model: normalizedModel,
          promptSignature,
          savedAt: new Date().toISOString(),
          result: payload,
        };
        window.localStorage.setItem(decompositionBrowserCacheKey, JSON.stringify(browserCache));
      }
      window.localStorage.removeItem(interpretationMapStorageKey);
      setDecisionContext(contextForRequest);
      setActiveCluster(-1);
      setActiveTraceStep(0);
      setPhase(!skipElicitation && !contextForRequest && payload.decomposition.clusters.length
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

  function forgetSavedSettings() {
    window.localStorage.removeItem(preferencesStorageKey);
    setOpenRouterKey("");
    setOpenRouterModel(defaultOpenRouterModel);
    setConnectionStatus({ state: "idle", message: "Saved key removed from this browser." });
  }

  function toggleContextOption(questionId: string, option: string) {
    setContextSelections((current) => {
      const selected = current[questionId] ?? [];
      const next = selected.includes(option)
        ? selected.filter((item) => item !== option)
        : [...selected, option];
      return { ...current, [questionId]: next };
    });
  }

  async function refineWithContext() {
    if (!result) return;
    const additions = result.decomposition.clusters
      .map((question) => {
        const selected = contextSelections[question.id] ?? [];
        const typed = contextAnswers[question.id]?.trim();
        const answer = Array.from(new Set([...selected, ...(typed ? [typed] : [])])).join("; ");
        return { question, answer };
      })
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
    if (elicitationIndex < result.decomposition.clusters.length - 1) {
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
    window.localStorage.setItem(decompositionSessionKey, JSON.stringify(result));
    setPhase("transitioning");
    await wait(reducedMotion ? 80 : 800);
    window.location.assign("/map");
  }

  return (
    <main className="intro-root">
      <div className={`brand-intro ${brandDocked ? "is-docked" : ""}`} data-phase={introPhase} aria-label="Epistack">
        {brandCharacters.map((character, index) => (
          <span key={`${character}-${index}`} style={{ animationDelay: `${index * 110}ms` }} aria-hidden="true">{character}</span>
        ))}
      </div>

      <div className={`intro-surface ${introComplete ? "is-ready" : ""}`} aria-hidden={!introComplete}>
        <header className="minimal-topbar">
          <StageNav active="decompose" />
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
              <Link className="settings-prompt-link" href="/prompts">
                <span><strong>AI agent prompts</strong><small>Inspect and edit the instructions driving every model call.</small></span>
                <b aria-hidden="true">→</b>
              </Link>
              <div className="settings-footer">
                <p className={`connection-status ${connectionStatus.state}`} role="status">
                  <i aria-hidden="true" />{connectionStatus.message}
                </p>
                <div className="settings-actions">
                  <button type="button" className="settings-info" aria-label="Key privacy" data-tooltip="Saved in this browser only. Never added to the case artifact or hosted environment.">?</button>
                  <button type="button" className="settings-info settings-forget" aria-label="Forget saved key and model" data-tooltip="Forget saved key and model" onClick={forgetSavedSettings}>⌫</button>
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

          {result && (phase === "review" || phase === "transitioning") && (
          <section className="story-board" aria-labelledby="trace-title">
            <button type="button" className="icon-button review-back" aria-label="Edit question" data-tooltip="Edit question" onClick={returnToEditor}>←</button>
            <div className="story-heading">
              <div>
                <h2 id="trace-title">Decomposition</h2>
                {result.warning && <p className="decomposition-warning">{result.warning}</p>}
              </div>
              <div className="story-heading-meta">
                <span title="Computational freshness only; this does not imply evidential confidence.">{decompositionCacheLabel(result)}</span>
                <small>{result.decomposition.clusters.length} semantic clusters</small>
                <button type="button" onClick={() => void analyze(decisionContext, true, true)}>Recompute</button>
              </div>
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
                  return (
                    <article
                      className={`story-chapter cluster-tone-${clusterIndex % 5} ${revealedClusters.includes(clusterIndex) ? "is-revealed" : ""} ${activeCluster === clusterIndex ? "is-active" : ""}`}
                      id={`story-cluster-${cluster.id}`}
                      key={cluster.id}
                      data-cluster-index={clusterIndex}
                    >
                                            <header>
                        <span>Cluster {String(clusterIndex + 1).padStart(2, "0")}</span>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <h3>{cluster.label}</h3>
                          <button type="button" className="icon-button" onClick={() => { setEditingClusterId(cluster.id); setEditDraft(cluster); }}>Edit</button>
                        </div>
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

                                            {editingClusterId === cluster.id ? (
                        <div className="story-flow" style={{ padding: "1rem", background: "var(--background-soft)", borderRadius: "8px" }}>
                          <label>Label</label>
                          <input type="text" value={editDraft.label} onChange={(e) => setEditDraft({...editDraft, label: e.target.value})} style={{ width: "100%", marginBottom: "1rem" }} />
                          <label>Latent Variable</label>
                          <input type="text" value={editDraft.latentVariable} onChange={(e) => setEditDraft({...editDraft, latentVariable: e.target.value})} style={{ width: "100%", marginBottom: "1rem" }} />
                          <label>Rationale</label>
                          <input type="text" value={editDraft.rationale} onChange={(e) => setEditDraft({...editDraft, rationale: e.target.value})} style={{ width: "100%", marginBottom: "1rem" }} />
                          <div style={{ display: "flex", gap: "1rem" }}>
                            <button onClick={saveClusterEdit}>Save</button>
                            <button onClick={() => setEditingClusterId(null)}>Cancel</button>
                            <button onClick={() => {
                               setResult({...result, decomposition: {...result.decomposition, clusters: result.decomposition.clusters.filter(c => c.id !== cluster.id)}});
                               setEditingClusterId(null);
                            }} style={{ color: "red" }}>Delete</button>
                          </div>
                        </div>
                      ) : (
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
                        
                        <div className="story-connector"><span>constrains what evidence may count</span><i>↓</i></div>
                        <section className="story-step evidence-story-step" data-cluster-index={clusterIndex} data-step-index="3">
                          <span><b>03</b> Evidence contract</span>
                          <div className="ingestion-grid">
                            <div><strong>Required fields</strong><ul>{cluster.ingestionRequirements.requiredFields.map((item) => <li key={item}>{item}</li>)}</ul></div>
                            <div><strong>Search concepts</strong><ul>{cluster.ingestionRequirements.searchConcepts.map((item) => <li key={item}>{item}</li>)}</ul></div>
                            <div><strong>Mismatch risk</strong><ul>{cluster.ingestionRequirements.mismatchRisks.map((item) => <li key={item}>{item}</li>)}</ul></div>
                          </div>
                        </section>
                      </div>
                    )}
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="story-completion">
              <p>Accepting the map does not accept any branch as true. It accepts this decomposition as the scope for retrieval and review.</p>
              <button className="primary-button" onClick={openMap}>
                Proceed to Contextualize →
              </button>
            </div>
          </section>
        )}
        </section>
      </div>
    </main>
  );
}
