"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { StageNav } from "./components/case-navigation";
import { BackendSettings } from "./components/backend-settings";
import type {
  DecompositionResponse,
  QuestionHighlight,
} from "../lib/decomposition";
import { decompositionSessionKey, interpretationMapStorageKey } from "../lib/decomposition";
import { parseCaseWorkflow } from "../lib/case-workflow";
import {
  agentPromptStorageKey,
  promptOverridesSignature,
  sanitizeAgentPromptOverrides,
  type AgentPromptOverrides,
} from "../lib/agent-prompts";
import {
  decompositionBrowserCacheStorageKey,
  decompositionCacheContract,
  decompositionCacheEntryKey,
  decompositionBackendIsPrimary,
  findBrowserDecompositionCacheEntry,
  legacyDecompositionBrowserCacheStorageKey,
  normalizeDecompositionText,
  parseBrowserDecompositionCache,
  upsertBrowserDecompositionCacheEntry,
} from "../lib/decomposition-cache";
import { runHostedDecomposition, type HostedProgress } from "../lib/hosted-decomposition-client";
import {
  appendDecompositionTelemetryRun,
  decompositionTelemetryStorageKey,
  emptyDecompositionTelemetry,
  formatDuration,
  parseDecompositionTelemetry,
  summarizeDecompositionTelemetry,
  type DecompositionPass,
  type DecompositionTelemetry,
} from "../lib/decomposition-telemetry";

const brandCharacters = [..."epistack"];
const preferencesStorageKey = "epistack:preferences:v1";
const workspaceStorageKey = "epistack:workspace:v1";
const canonicalEfforts = ["instant", "medium", "high", "xhigh", "pro"] as const;
type ThinkingEffort = (typeof canonicalEfforts)[number];
const effortAliases: Record<string, ThinkingEffort> = { low: "instant", max: "pro" };
const effortLabels: Record<ThinkingEffort, string> = {
  instant: "Instant",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  pro: "Pro",
};
const defaultEffort: ThinkingEffort = "instant";

function normalizeEffort(value: unknown): ThinkingEffort {
  if (typeof value !== "string") return defaultEffort;
  const trimmed = value.trim().toLowerCase();
  if (trimmed in effortAliases) return effortAliases[trimmed];
  return (canonicalEfforts as readonly string[]).includes(trimmed) ? (trimmed as ThinkingEffort) : defaultEffort;
}

const decompositionStages = [
  { label: "Discovering dimensions", detail: "The dimension scout proposes the axes that could change the answer." },
  { label: "Mapping exact language", detail: "The trace specialist ties your exact words to each dimension." },
  { label: "Preparing evidence requirements", detail: "The context specialist builds the retrieval plan and interview." },
];
const provisionalDecompositionMs = 120_000;

type AnalysisPhase = "idle" | "analyzing" | "eliciting" | "review" | "transitioning" | "error";
type PersistedPreferences = { effort?: string };
type PersistedWorkspace = {
  prompt?: string;
  decisionContext?: string;
  result?: DecompositionResponse | null;
  contextAnswers?: Record<string, string>;
  contextSelections?: Record<string, string[]>;
  elicitationIndex?: number;
  phase?: "idle" | "eliciting" | "review";
};
type LegacyBrowserDecompositionCache = {
  contract: typeof decompositionCacheContract;
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

function EditableStringList({ title, items, onChange }: { title: string; items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className="inline-edit-list">
      <strong>{title}</strong>
      {items.map((item, index) => (
        <div className="inline-edit-row" key={index}>
          <input
            className="inline-edit-input"
            aria-label={`${title}, item ${index + 1}`}
            value={item}
            spellCheck={false}
            onChange={(event) => onChange(items.map((value, i) => (i === index ? event.target.value : value)))}
          />
          <button type="button" className="inline-edit-remove" aria-label={`Remove ${title} item`} onClick={() => onChange(items.filter((_, i) => i !== index))}>×</button>
        </div>
      ))}
      <button type="button" className="inline-edit-add" onClick={() => onChange([...items, ""])}>+ Add</button>
    </div>
  );
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [decisionContext, setDecisionContext] = useState("");
  const [selectedEffort, setSelectedEffort] = useState<ThinkingEffort>(defaultEffort);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [removedDimension, setRemovedDimension] = useState<{ cluster: DecompositionResponse["decomposition"]["clusters"][number]; index: number } | null>(null);
  const [hostedProgress, setHostedProgress] = useState<HostedProgress | null>(null);
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const [analysisPass, setAnalysisPass] = useState<DecompositionPass>("initial");
  const [telemetry, setTelemetry] = useState<DecompositionTelemetry>(emptyDecompositionTelemetry);
  const [storageReady, setStorageReady] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const storyCueRefs = useRef(new Map<number, HTMLButtonElement>());
  const storyLandingRefs = useRef(new Map<number, HTMLElement>());
  const revealedClustersRef = useRef(new Set<number>());
  const analysisInFlightRef = useRef(false);
  const runStartedAtRef = useRef(0);

  const segments = useMemo(
    () => locateHighlights(prompt, result?.decomposition.highlights ?? []),
    [prompt, result],
  );
  const currentContextQuestion = null;
  const busy = requestPending || phase === "analyzing" || phase === "transitioning";
  const showComposerHint = prompt.trim().length > 0 && prompt.trim().length < 12;

  const telemetrySummary = useMemo(() => summarizeDecompositionTelemetry(telemetry), [telemetry]);
  const activeStage = Math.min(Math.max(hostedProgress?.stage ?? 0, 0), decompositionStages.length - 1);
  const effortStats = telemetrySummary.byEffort[selectedEffort];
  const empiricalTotalMs = effortStats?.totalMedianMs ?? telemetrySummary.totalMedianMs;
  const expectedTotalMs = empiricalTotalMs ?? provisionalDecompositionMs;
  const remainingMs = Math.max(0, expectedTotalMs - analysisElapsed);
  const empiricalSamples = effortStats?.samples || telemetrySummary.samples;
  const stageEstimates = decompositionStages.map((_, index) => {
    const medianMs = effortStats?.stageMediansMs?.[index];
    return medianMs ? `~${formatDuration(medianMs)}` : "collecting samples";
  });
  const stageAttempts = hostedProgress?.attempts?.[activeStage] ?? 1;
  const retryNote = stageAttempts > 1
    ? `Stage attempt ${stageAttempts}${hostedProgress?.rateLimits ? ` · ${hostedProgress.rateLimits} rate-limit pause${hostedProgress.rateLimits > 1 ? "s" : ""}` : ""}`
    : "";
  const railProgress = ((activeStage + (hostedProgress?.status === "in_progress" ? 0.55 : 0.12)) / decompositionStages.length) * 100;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setTelemetry(parseDecompositionTelemetry(window.localStorage.getItem(decompositionTelemetryStorageKey)));
      } catch {
        setTelemetry(emptyDecompositionTelemetry);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const explicitlyResuming = window.location.pathname === "/decompose" || searchParams.get("resume") === "1";
      const queryCaseId = searchParams.get("caseId")?.trim() || "";
      if (searchParams.get("settings") === "1") {
        setSettingsOpen(true);
      }
      try {
        const savedPreferences = JSON.parse(window.localStorage.getItem(preferencesStorageKey) || "{}") as PersistedPreferences;
        if (typeof savedPreferences.effort === "string") {
          setSelectedEffort(normalizeEffort(savedPreferences.effort));
        }
      } catch {
        // Invalid local preferences should never block the app.
      }

      // A case-bound URL must load its server snapshot. Falling back to the
      // latest browser workspace could show another question's data.
      if (queryCaseId) {
        void fetch(`/api/cases?caseId=${encodeURIComponent(queryCaseId)}`, { cache: "no-store" })
          .then(async (response) => {
            const payload = await response.json().catch(() => null) as { workflow?: unknown } | null;
            const workflow = parseCaseWorkflow(payload?.workflow);
            if (!response.ok || !workflow || workflow.decomposition.caseId !== queryCaseId) {
              setError("This case does not have a saved decomposition snapshot.");
              return;
            }
            const restoredResult: DecompositionResponse = {
              ...workflow.decomposition,
              cache: { status: "browser", layer: "browser", createdAt: new Date().toISOString(), expiresAt: null },
            };
            setResult(restoredResult);
            setPrompt(restoredResult.prompt);
            setDecisionContext(restoredResult.decisionContext ?? "");
            setPhase("review");
          })
          .catch(() => setError("The saved decomposition could not be loaded. Return to the artifact and try again."))
          .finally(() => setStorageReady(true));
        return;
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
        // The root route is the question composer. The explicit /decompose
        // route (or resume query) restores the saved review instead.
        if (explicitlyResuming && restoredResult?.decomposition) {
          const restoredWithCache: DecompositionResponse = {
            ...restoredResult,
            cache: { status: "browser", layer: "browser", createdAt: new Date().toISOString(), expiresAt: null },
          };
          setResult(restoredWithCache);
          if (!savedWorkspace.prompt) setPrompt(restoredResult.prompt);
          if (!savedWorkspace.decisionContext) setDecisionContext(restoredResult.decisionContext ?? "");
          setPhase("review");
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
        const preferences = JSON.stringify({ effort: selectedEffort });
        window.localStorage.setItem(preferencesStorageKey, preferences);
      } catch {
        // Browser persistence is a convenience; requests still work without it.
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [selectedEffort, storageReady]);

  useEffect(() => {
    if (!storageReady || phase === "analyzing" || phase === "transitioning") return;
    const timer = setTimeout(() => {
      try {
        const persistedPhase = result ? "review" : "idle";
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
    const timer = window.setInterval(() => {
      setAnalysisElapsed(runStartedAtRef.current ? window.performance.now() - runStartedAtRef.current : 0);
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.max(210, input.scrollHeight)}px`;
  }, [prompt, phase]);

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

  function removeCluster(clusterId: string) {
    if (!result) return;
    const index = result.decomposition.clusters.findIndex((cluster) => cluster.id === clusterId);
    if (index < 0) return;
    setRemovedDimension({ cluster: result.decomposition.clusters[index], index });
    setResult({
      ...result,
      decomposition: {
        ...result.decomposition,
        clusters: result.decomposition.clusters.filter((cluster) => cluster.id !== clusterId),
      },
    });
    setEditingClusterId(null);
    setEditDraft(null);
  }

  function undoRemoveCluster() {
    if (!result || !removedDimension) return;
    const clusters = [...result.decomposition.clusters];
    clusters.splice(Math.min(removedDimension.index, clusters.length), 0, removedDimension.cluster);
    setResult({ ...result, decomposition: { ...result.decomposition, clusters } });
    setRemovedDimension(null);
  }

  async function analyze(contextOverride?: string, skipElicitation = false, refresh = false) {
    if (!prompt.trim() || busy || analysisInFlightRef.current) return;
    analysisInFlightRef.current = true;
    setRequestPending(true);
    const contextForRequest = normalizeDecompositionText(
      typeof contextOverride === "string" ? contextOverride : decisionContext,
    );
    const normalizedPrompt = normalizeDecompositionText(prompt);
    const runEffort = selectedEffort;
    const normalizedModel = `lyra-chatgpt-pro:hosted-v2:${runEffort}`;
    const promptOverrides = storedAgentPromptOverrides();
    const promptSignature = promptOverridesSignature(promptOverrides);
    let cacheKey = "";
    try {
      cacheKey = await decompositionCacheEntryKey({
        prompt: normalizedPrompt,
        decisionContext: contextForRequest,
        model: normalizedModel,
        promptSignature,
      });
    } catch {
      analysisInFlightRef.current = false;
      setRequestPending(false);
      setError("The saved-result lookup could not be prepared. Reload and try again.");
      setPhase("error");
      return;
    }
    setPrompt(normalizedPrompt);
    setError("");
    setResult(null);
    setActiveCluster(-1);
    setActiveTraceStep(0);
    setElicitationIndex(0);
    setRevealedClusters([]);
    setRemovedDimension(null);
    setAnalysisPass(skipElicitation && Boolean(contextOverride) ? "refine" : "initial");
    setAnalysisElapsed(0);
    if (!skipElicitation) {
      setContextAnswers({});
      setContextSelections({});
    }
    revealedClustersRef.current.clear();
    setHostedProgress({ stage: 0, status: "connecting" });

    let loadingTimer = 0;
    try {
      if (!refresh) {
        try {
          let browserStore = parseBrowserDecompositionCache(
            window.localStorage.getItem(decompositionBrowserCacheStorageKey),
          );
          let cachedEntry = findBrowserDecompositionCacheEntry(browserStore, cacheKey);
          if (!cachedEntry) {
            try {
              const legacy = JSON.parse(
                window.localStorage.getItem(legacyDecompositionBrowserCacheStorageKey) || "null",
              ) as LegacyBrowserDecompositionCache | null;
              if (legacy?.result?.decomposition && legacy.contract === decompositionCacheContract) {
                const legacyKey = await decompositionCacheEntryKey({
                  prompt: legacy.prompt,
                  decisionContext: legacy.decisionContext,
                  model: legacy.model,
                  promptSignature: legacy.promptSignature,
                });
                if (legacyKey === cacheKey) {
                  const accessedAt = new Date().toISOString();
                  cachedEntry = {
                    key: cacheKey,
                    savedAt: legacy.savedAt,
                    lastAccessedAt: accessedAt,
                    result: legacy.result,
                  };
                  browserStore = upsertBrowserDecompositionCacheEntry(browserStore, cachedEntry);
                  window.localStorage.setItem(decompositionBrowserCacheStorageKey, JSON.stringify(browserStore));
                  window.localStorage.removeItem(legacyDecompositionBrowserCacheStorageKey);
                }
              }
            } catch {
              window.localStorage.removeItem(legacyDecompositionBrowserCacheStorageKey);
            }
          }
          if (cachedEntry) {
            const accessedAt = new Date().toISOString();
            browserStore = upsertBrowserDecompositionCacheEntry(browserStore, {
              ...cachedEntry,
              lastAccessedAt: accessedAt,
            });
            try {
              window.localStorage.setItem(decompositionBrowserCacheStorageKey, JSON.stringify(browserStore));
            } catch {
              // A readable cache hit remains useful even if LRU metadata cannot be refreshed.
            }
            const browserResult: DecompositionResponse = {
              ...cachedEntry.result,
              prompt: normalizedPrompt,
              decisionContext: contextForRequest,
              cache: { status: "browser", layer: "browser", createdAt: cachedEntry.savedAt, expiresAt: null },
            };
            setResult(browserResult);
            try {
              window.sessionStorage.setItem(decompositionSessionKey, JSON.stringify(browserResult));
            } catch {
              // The in-memory result can still continue to contextualization.
            }
            setDecisionContext(contextForRequest);
            setPhase("review");
            return;
          }
        } catch {
          // Browser persistence is an optimization; a shared cache lookup can still proceed.
        }
      }

      loadingTimer = window.setTimeout(() => setPhase("analyzing"), 350);
      runStartedAtRef.current = window.performance.now();
      const stageDurations: number[] = [];
      const payload = await runHostedDecomposition({
        question: normalizedPrompt,
        decisionContext: contextForRequest,
        promptOverrides,
        effort: runEffort,
      }, cacheKey, refresh, (progress) => {
        setHostedProgress(progress);
        if (progress.durationsMs?.length) stageDurations.splice(0, stageDurations.length, ...progress.durationsMs);
      });
      window.clearTimeout(loadingTimer);
      const totalMs = Math.max(0, window.performance.now() - runStartedAtRef.current);
      setTelemetry((current) => {
        const next = appendDecompositionTelemetryRun(current, {
          totalMs,
          stageMs: [...stageDurations],
          pass: skipElicitation && Boolean(contextOverride) ? "refine" : "initial",
          backend: payload.model,
          at: new Date().toISOString(),
          effort: runEffort,
        });
        try {
          window.localStorage.setItem(decompositionTelemetryStorageKey, JSON.stringify(next));
        } catch {
          // Telemetry is an estimate; failing to persist it must never block a run.
        }
        return next;
      });

      setResult(payload);
      try {
        window.sessionStorage.setItem(decompositionSessionKey, JSON.stringify(payload));
        window.localStorage.setItem(decompositionSessionKey, JSON.stringify(payload));
        if (payload.mode === "ai" && decompositionBackendIsPrimary(payload.model)) {
          const savedAt = new Date().toISOString();
          const browserStore = upsertBrowserDecompositionCacheEntry(
            parseBrowserDecompositionCache(window.localStorage.getItem(decompositionBrowserCacheStorageKey)),
            {
              key: cacheKey,
              savedAt,
              lastAccessedAt: savedAt,
              result: payload,
            },
          );
          window.localStorage.setItem(decompositionBrowserCacheStorageKey, JSON.stringify(browserStore));
        }
        window.localStorage.removeItem(interpretationMapStorageKey);
      } catch {
        // A successful shared result remains usable even if browser persistence is unavailable.
      }
      setDecisionContext(contextForRequest);
      setActiveCluster(-1);
      setActiveTraceStep(0);
      setPhase("review");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The decomposition could not be generated.";
      setError(message);
      // Hosted failures stay inline; they never ask visitors for an OpenRouter key.
      setPhase("error");
    } finally {
      window.clearTimeout(loadingTimer);
      analysisInFlightRef.current = false;
      setRequestPending(false);
    }
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
      <div className="brand-intro" role="img" aria-label="Epistack">
        {brandCharacters.map((character, index) => (
          <span key={`${character}-${index}`} style={{ animationDelay: `${index * 110}ms` }} aria-hidden="true">{character}</span>
        ))}
      </div>

      <div className="intro-surface">
        <header className="minimal-topbar">
          <StageNav active="decompose" estimates={stageEstimates} onHome={returnToEditor} />
          <>
            <button
              type="button"
              className="icon-button recompute-trigger"
              aria-label="Recompute decomposition"
              disabled={!result || busy}
              data-tooltip={!result ? "Recompute · enter a question first" : empiricalTotalMs ? `Recompute · ~${formatDuration(empiricalTotalMs)}, n=${empiricalSamples}` : "Recompute · collecting samples"}
              onClick={() => {
                if (window.confirm(`Recompute this decomposition? It takes about ${formatDuration(expectedTotalMs)}.`)) {
                  void analyze(decisionContext, true, true);
                }
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
          </>
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
            <BackendSettings
              effort={selectedEffort}
              onEffortChange={setSelectedEffort}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </header>

        <section className={`analysis-shell clean-shell ${phase === "transitioning" ? "leaving" : ""}`}>
          {(phase === "idle" || phase === "error") && (
            <section className="minimal-composer" aria-labelledby="composer-title">
              <h1 id="composer-title" className="sr-only">Ask a question to decompose</h1>
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
                  aria-describedby={showComposerHint ? "composer-hint" : undefined}
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
                  aria-describedby={showComposerHint ? "composer-hint" : undefined}
                  data-tooltip={prompt.trim().length < 12 ? "Write a fuller question" : "Decompose into testable claims · ⌘↵"}
                  disabled={busy || prompt.trim().length < 12}
                  onClick={() => void analyze()}
                >
                  <span className="decompose-icon" aria-hidden="true"><i /><i /><i /><i /></span>
                </button>
                {error && <p className="composer-error" role="alert">{error}</p>}
                {!error && showComposerHint && (
                  <p id="composer-hint" className="composer-hint">Add a little more detail so the question can be decomposed (at least 12 characters).</p>
                )}
              </div>
            </section>
          )}

          {phase === "analyzing" && (
            <section className="phase-screen" aria-labelledby="loading-title">
              <p className="sr-only" role="status">
                {`${analysisPass === "refine" ? "Refining with your context" : "Decomposing your question"}: ${hostedProgress ? decompositionStages[activeStage].label : "connecting to the research service"}, stage ${activeStage + 1} of ${decompositionStages.length}.`}
              </p>
              <div className="ai-orb thinking" aria-hidden="true"><span /></div>
              <div className="loading-copy">
                <p className="loading-pass" id="loading-title">{analysisPass === "refine" ? "Refining with your context" : "Decomposing your question"}</p>
                <p className="loading-operation">{hostedProgress ? `${decompositionStages[activeStage].label}…` : "Connecting to the research service…"}</p>
                <ol className="loading-stages">
                  {decompositionStages.map((stage, index) => (
                    <li key={stage.label} className={index < activeStage ? "done" : index === activeStage ? "active" : "pending"}>
                      <span className="stage-marker" aria-hidden="true">{index < activeStage ? "✓" : index + 1}</span>
                      <span className="stage-text"><strong><span className="sr-only">{index < activeStage ? "Done: " : index === activeStage ? "In progress: " : "Pending: "}</span>{stage.label}</strong><small>{stage.detail}</small></span>
                    </li>
                  ))}
                </ol>
                <div className="loading-meters">
                  <div><strong>{formatDuration(analysisElapsed)}</strong><span>elapsed</span></div>
                  <div><strong>{formatDuration(remainingMs)}</strong><span>{empiricalSamples ? `est. remaining · ${empiricalSamples} prior run${empiricalSamples > 1 ? "s" : ""}` : "provisional estimate"}</span></div>
                  <div><strong>{activeStage + 1} / {decompositionStages.length}</strong><span>{hostedProgress?.status === "queued" ? "advancing" : "in progress"}</span></div>
                </div>
                <div className="loading-rail" aria-hidden="true"><span style={{ width: `${railProgress}%` }} /></div>
                {retryNote && <small className="loading-retry">{retryNote}</small>}
                <small>Your run is saved. Submitting the same question after a reload resumes it.</small>
              </div>
            </section>
          )}

          {result && (phase === "review" || phase === "transitioning") && (
          <section className="story-board" aria-labelledby="trace-title">
            <div className="story-heading">
              <div className="story-heading-title">
                <h1 id="trace-title">Decomposition</h1>
                {result.warning && <p className="decomposition-warning">{result.warning}</p>}
              </div>
              <div className="story-heading-meta" aria-label="Decomposition provider and model provenance">
                <span>{result.model}</span>
                <small>{decompositionCacheLabel(result)}</small>
                {result.provenance?.stages.map((stage) => (
                  <small key={stage.stage}>
                    {stage.stage.replaceAll("-", " ")} · {stage.provider} · {stage.model} · {stage.status}
                  </small>
                ))}
              </div>
            </div>

            {removedDimension && (
              <div className="dimension-undo" role="status">
                <span>Removed “{removedDimension.cluster.label}”.</span>
                <button type="button" className="quiet-button" onClick={undoRemoveCluster}>Undo</button>
              </div>
            )}

            <div className="scroll-invitation" aria-hidden="true">
              <span>Scroll to follow each dimension from your words to the evidence it needs</span>
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
                <nav aria-label="Dimensions">
                {result.decomposition.clusters.map((cluster, index) => (
                  <button
                    type="button"
                    className={`${index === activeCluster ? "active" : ""} ${revealedClusters.includes(index) ? "revealed" : ""} cluster-tone-${index % 5}`}
                    key={cluster.id}
                    onClick={() => inspectCluster(index, true)}
                    aria-current={index === activeCluster ? "step" : undefined}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{cluster.label}</strong>
                    <small>{cluster.highlightQuotes.map((quote) => `“${quote}”`).join(" + ")}</small>
                  </button>
                ))}
                </nav>
                <p>{activeCluster < 0 ? "Scroll to follow the first dimension" : `Step ${Math.min(activeTraceStep + 1, 3)} of 3`}</p>
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
                        <span>Dimension {String(clusterIndex + 1).padStart(2, "0")}</span>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <h3>{cluster.label}</h3>
                          {editingClusterId !== cluster.id && (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Edit dimension"
                              data-tooltip="Edit dimension"
                              onClick={() => { setEditingClusterId(cluster.id); setEditDraft(cluster); }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                            </button>
                          )}
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
                        <div className="story-flow cluster-edit-flow" aria-label={`Edit ${cluster.label}`}>
                          <section className="story-step" data-step-index="0">
                            <span><b>01</b> Dimension label</span>
                            <textarea className="inline-edit-title" aria-label="Dimension label" rows={2} value={editDraft.label} onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })} />
                          </section>
                          <div className="story-connector"><span>licensed by these literal cues</span><i>↓</i></div>
                          <section className="story-step" data-step-index="1">
                            <span><b>02</b> Exact language</span>
                            <EditableStringList title="Cues (must be exact substrings of the question)" items={editDraft.highlightQuotes} onChange={(highlightQuotes) => setEditDraft({ ...editDraft, highlightQuotes })} />
                          </section>
                          <div className="story-connector"><span>grouped because they imply</span><i>↓</i></div>
                          <section className="story-step" data-step-index="2">
                            <span><b>03</b> Hidden variable</span>
                            <textarea className="inline-edit-h4" aria-label="Hidden variable" rows={2} value={editDraft.latentVariable} onChange={(e) => setEditDraft({ ...editDraft, latentVariable: e.target.value })} />
                            <textarea className="inline-edit-p" aria-label="Why this variable matters" rows={4} value={editDraft.rationale} onChange={(e) => setEditDraft({ ...editDraft, rationale: e.target.value })} />
                          </section>
                          <div className="story-connector"><span>constrains what evidence may count</span><i>↓</i></div>
                          <section className="story-step evidence-story-step" data-step-index="3">
                            <span><b>04</b> Evidence contract</span>
                            <div className="ingestion-grid">
                              <EditableStringList title="Required fields" items={editDraft.ingestionRequirements.requiredFields} onChange={(requiredFields) => setEditDraft({ ...editDraft, ingestionRequirements: { ...editDraft.ingestionRequirements, requiredFields } })} />
                              <EditableStringList title="Search concepts" items={editDraft.ingestionRequirements.searchConcepts} onChange={(searchConcepts) => setEditDraft({ ...editDraft, ingestionRequirements: { ...editDraft.ingestionRequirements, searchConcepts } })} />
                              <EditableStringList title="Mismatch risk" items={editDraft.ingestionRequirements.mismatchRisks} onChange={(mismatchRisks) => setEditDraft({ ...editDraft, ingestionRequirements: { ...editDraft.ingestionRequirements, mismatchRisks } })} />
                            </div>
                          </section>
                          <div className="cluster-edit-actions">
                            <button type="button" className="primary-button" onClick={saveClusterEdit}>Save dimension</button>
                            <button type="button" className="quiet-button" onClick={() => { setEditingClusterId(null); setEditDraft(null); }}>Cancel</button>
                            <button type="button" className="quiet-button danger" onClick={() => removeCluster(cluster.id)}>Remove dimension</button>
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
              <p>These dimensions are the interpretations worth investigating — proposals, not settled truth. Next, <strong>Contextualize</strong> will ground them in your actual situation: your routine, your constraints, and what a good decision would look like for you.</p>
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
