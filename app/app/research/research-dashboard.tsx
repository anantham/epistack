"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  researchCapabilities,
  type ResearchLane,
} from "../../data/eggs-investigation";
import type { DeepDiveResponse } from "../../lib/deep-dive";
import type { DualReviewResponse } from "../../lib/dual-review";
import type { PublicationFilter, PubmedDiscovery, ResearchResponse } from "../../lib/research";
import { agentPromptStorageKey, sanitizeAgentPromptOverrides } from "../../lib/agent-prompts";
import type {
  RecallResponse,
  RecallToolTraceEvent,
} from "../../lib/broad-recall";
import { sourceClassLabels, canPromoteSourceClass, type SourceClass } from "../../lib/source-class";
import type { SourceReviewResponse } from "../../lib/source-adapters";
import {
  researchBriefSchema,
  researchBriefStorageKey,
  researchLanesFromBrief,
  type ResearchBrief,
  type ResearchClaimFrame,
} from "../../lib/research-brief";
import {
  addResearchUsage,
  emptyResearchUsage,
  formatUsd,
  normalizeResearchUsage,
  parseResearchPreferences,
  remainingRunBudgetUsd,
  researchBudgetProfiles,
  researchPreferencesStorageKey,
  researchRunCapUsd,
  runBudgetExhausted,
  type ResearchPreferences,
  type ResearchUsage,
} from "../../lib/research-budget";
import {
  appendResearchTelemetrySample,
  emptyResearchTelemetry,
  parseResearchTelemetry,
  researchStageEstimate,
  researchTelemetryStorageKey,
  type ResearchStage,
} from "../../lib/research-telemetry";
import { formatDuration } from "../../lib/decomposition-telemetry";
import {
  claimSteeringStorageKey,
  fitContext,
  parseBriefSteering,
  recallSteering,
  steeringPlanSummary,
  strongestEffort,
  type BriefSteering,
  type ClaimSteering,
} from "../../lib/claim-steering";
import { ClaimBoard } from "./claim-board";

type LaneRun = {
  status: "ready" | "running" | "complete" | "error";
  response: ResearchResponse | null;
  error: string;
};

type DeepDiveRun = {
  status: "idle" | "acquiring" | "extracting" | "reviewing" | "adjudicating" | "review" | "promoting" | "persisted" | "error";
  payload: DeepDiveResponse | DualReviewResponse | null;
  checked: boolean;
  error: string;
  progress: string;
  fallbackAvailable: boolean;
};

type CompanionHealth = {
  status: "checking" | "online" | "offline" | "hosted";
  models: { primary: string; adversary: string } | null;
  detail: string;
};

type RecallRun = {
  status: "idle" | "running" | "complete" | "error";
  response: RecallResponse | null;
  error: string;
  progress: string;
  liveTrace: RecallToolTraceEvent[];
};

type SourceReviewRun = {
  status: "idle" | "loading" | "complete" | "error";
  response: SourceReviewResponse | null;
  error: string;
};

type PromotionRecord = {
  pmid: string;
  title: string;
  source_url: string;
  result_id: string;
  result_text: string;
  verification_status: string;
  locator: string;
  relation: string;
  scope_match: string;
  rationale: string;
  status: string;
  created_at: string;
  family_label: string;
  family_reason: string;
};

type CachedDashboardState = {
  version: 2;
  briefId: string;
  savedAt: string;
  queries: Record<string, string>;
  filters: PublicationFilter[];
  runs: Record<string, LaneRun>;
  deepDives: Record<string, DeepDiveRun>;
  openLane: string;
  recall?: RecallRun;
};

const dashboardCacheKey = "epistack:research-ui-cache:v2";
const researchRunStorageKey = "epistack:research-run:v1";

type ResearchRunLedger = {
  briefId: string;
  startedAt: string;
  usage: ResearchUsage;
};

function readRunLedger(briefId: string): ResearchRunLedger {
  try {
    const saved = JSON.parse(window.localStorage.getItem(researchRunStorageKey) || "null") as Partial<ResearchRunLedger> | null;
    if (saved && saved.briefId === briefId && typeof saved.startedAt === "string") {
      return { briefId, startedAt: saved.startedAt, usage: normalizeResearchUsage(saved.usage) };
    }
  } catch {
    // A missing or unreadable ledger starts a fresh run.
  }
  return { briefId, startedAt: new Date().toISOString(), usage: emptyResearchUsage };
}

function isDualReviewPayload(payload: DeepDiveResponse | DualReviewResponse): payload is DualReviewResponse {
  return payload.verificationStatus === "ai-cross-checked-full-text";
}

function defaultQueries(lanes: ResearchLane[]) {
  return Object.fromEntries(lanes.map((lane) => [lane.id, lane.defaultQuery])) as Record<string, string>;
}

function freshRuns(lanes: ResearchLane[]) {
  return Object.fromEntries(
    lanes.map((lane) => [lane.id, { status: "ready", response: null, error: "" }]),
  ) as Record<string, LaneRun>;
}

function cacheLabel(cache: ResearchResponse["cache"]) {
  if (cache.status === "browser") return "restored from this browser";
  if (cache.status === "hit") return "reused from operation cache";
  if (cache.status === "bypass") return "refreshed live";
  return "fresh · saved for reuse";
}

function cacheTitle(cache: ResearchResponse["cache"]) {
  if (cache.status === "browser") return "This display was restored instantly from local browser storage. Use Refresh live to contact PubMed again.";
  if (cache.status === "hit") return `This exact operation was reused from the shared cache${cache.expiresAt ? `; it expires ${new Date(cache.expiresAt).toLocaleString()}` : ""}.`;
  if (cache.status === "bypass") return "The cache was deliberately bypassed and replaced by a fresh operation result.";
  return `This operation ran live${cache.expiresAt ? ` and can be reused until ${new Date(cache.expiresAt).toLocaleString()}` : ""}.`;
}

const publicationOptions: Array<{ id: PublicationFilter; label: string }> = [
  { id: "trials", label: "Trials" },
  { id: "reviews", label: "Reviews" },
  { id: "observational", label: "Observational" },
];

const recallLaneLabels: Record<RecallResponse["lanes"][number]["lane"], string> = {
  "broad-recall": "Broad recall",
  applicability: "Applicability",
  context: "Context",
};

const compactSourceClassLabels: Record<SourceClass, [singular: string, plural: string]> = {
  "primary-study": ["primary study", "primary studies"],
  "systematic-review": ["systematic review", "systematic reviews"],
  guideline: ["guideline", "guidelines"],
  standard: ["standard", "standards"],
  "trial-registry": ["registry", "registries"],
  "official-statistics": ["official statistic", "official statistics"],
  preprint: ["preprint", "preprints"],
  reporting: ["report", "reports"],
  anecdote: ["anecdote", "anecdotes"],
};

function recallClassBreakdown(leads: RecallResponse["leads"]) {
  const counts = new Map<SourceClass, number>();
  for (const lead of leads) {
    if (lead.sourceClass) counts.set(lead.sourceClass, (counts.get(lead.sourceClass) ?? 0) + 1);
  }
  return Array.from(counts, ([sourceClass, count]) => {
    const labels = compactSourceClassLabels[sourceClass];
    return `${count} ${count === 1 ? labels[0] : labels[1]}`;
  }).join(", ");
}

function statusLabel(status: LaneRun["status"]) {
  if (status === "running") return "searching live";
  if (status === "complete") return "sweep complete";
  if (status === "error") return "needs retry";
  return "ready for human launch";
}

function boundedUnique(values: Array<string | null | undefined>, maximumLength: number) {
  return Array.from(new Set(values
    .map((value) => value?.trim().slice(0, maximumLength) || "")
    .filter(Boolean))).slice(0, 12);
}

function sourceReviewRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sourceReviewText(value: unknown, fallback = "Not stated") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (values.length > 0) return values.join(" · ");
  }
  return fallback;
}

function sourceReviewItems(payload: unknown, key: string) {
  const value = sourceReviewRecord(payload)[key];
  return Array.isArray(value) ? value.map(sourceReviewRecord) : [];
}

function renderSourceReviewPayload(review: SourceReviewResponse) {
  const payload = sourceReviewRecord(review.payload);

  if (review.role === "normative") {
    return (
      <div className="candidate-results">
        {sourceReviewItems(payload, "recommendations").map((recommendation, index) => {
          const scope = sourceReviewRecord(recommendation.comparisonScope);
          return (
            <article key={`recommendation-${index}`}>
              <div><span className="relation-chip supports">recommendation</span><small>{sourceReviewText(recommendation.strength)}</small></div>
              <strong>{sourceReviewText(recommendation.statement)}</strong>
              <dl className="candidate-study">
                <div><dt>Issuing body</dt><dd>{sourceReviewText(recommendation.issuingBody)}</dd></div>
                <div><dt>Effective date</dt><dd>{sourceReviewText(recommendation.effectiveDate)}</dd></div>
                <div><dt>Topic</dt><dd>{sourceReviewText(scope.topic)}</dd></div>
                <div><dt>Population</dt><dd>{sourceReviewText(scope.population)}</dd></div>
                <div><dt>Jurisdiction</dt><dd>{sourceReviewText(scope.jurisdiction)}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    );
  }

  if (review.role === "descriptive") {
    return (
      <div className="candidate-results">
        {sourceReviewItems(payload, "statistics").map((statistic, index) => {
          const scope = sourceReviewRecord(statistic.comparisonScope);
          return (
            <article key={`statistic-${index}`}>
              <strong>{sourceReviewText(statistic.measure)}</strong>
              <b>{sourceReviewText(statistic.value)}{statistic.unit ? ` ${sourceReviewText(statistic.unit, "")}` : ""}</b>
              <dl className="candidate-study">
                <div><dt>Population</dt><dd>{sourceReviewText(statistic.population)}</dd></div>
                <div><dt>Geography</dt><dd>{sourceReviewText(statistic.geography)}</dd></div>
                <div><dt>Period</dt><dd>{sourceReviewText(statistic.period)}</dd></div>
                <div><dt>Dataset version</dt><dd>{sourceReviewText(statistic.datasetVersion)}</dd></div>
                <div><dt>Comparison topic</dt><dd>{sourceReviewText(scope.topic)}</dd></div>
                <div><dt>Comparison jurisdiction</dt><dd>{sourceReviewText(scope.jurisdiction)}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    );
  }

  if (review.role === "status") {
    const registry = sourceReviewRecord(payload.registry);
    return (
      <dl className="candidate-study">
        <div><dt>Registration ID</dt><dd>{sourceReviewText(registry.registrationId)}</dd></div>
        <div><dt>Title</dt><dd>{sourceReviewText(registry.title)}</dd></div>
        <div><dt>Status</dt><dd>{sourceReviewText(registry.status)}</dd></div>
        <div><dt>Sponsor</dt><dd>{sourceReviewText(registry.sponsor)}</dd></div>
        <div><dt>Start date</dt><dd>{sourceReviewText(registry.startDate)}</dd></div>
        <div><dt>Completion date</dt><dd>{sourceReviewText(registry.completionDate)}</dd></div>
        <div><dt>Conditions</dt><dd>{sourceReviewText(registry.conditions)}</dd></div>
        <div><dt>Interventions</dt><dd>{sourceReviewText(registry.interventions)}</dd></div>
      </dl>
    );
  }

  if (review.role === "context") {
    return (
      <div>
        <p className="extraction-caveat"><strong>Context only — cannot become evidence.</strong> These signals remain hypotheses and do not establish that an intervention causes an effect.</p>
        <div className="candidate-results">
          {sourceReviewItems(payload, "signals").map((signal, index) => (
            <article key={`signal-${index}`}>
              <strong>{sourceReviewText(signal.claim)}</strong>
              <small>{sourceReviewText(signal.signalType)} · {sourceReviewText(signal.sourceType)}</small>
            </article>
          ))}
        </div>
      </div>
    );
  }

  const candidate = sourceReviewRecord(payload.candidate);
  const results = Array.isArray(payload.results)
    ? payload.results.map(sourceReviewRecord)
    : Array.isArray(candidate.results)
      ? candidate.results.map(sourceReviewRecord)
      : [];
  const promotion = sourceReviewRecord(payload.promotion);
  return (
    <div className="candidate-results">
      <header>
        <div><span>Dual-review results</span><strong>{results.length} result{results.length === 1 ? "" : "s"}</strong></div>
        <small>{sourceReviewText(promotion.acceptedCount, "No promotion count returned")} accepted · {sourceReviewText(promotion.rejectedCount, "No rejection count returned")} rejected</small>
      </header>
      {results.map((result, index) => (
        <article key={`causal-result-${index}`}>
          <div><span className={`relation-chip ${sourceReviewText(result.relation, "not-informative")}`}>{sourceReviewText(result.relation, "not-informative")}</span><small>{sourceReviewText(result.claimFrameId)}</small></div>
          <strong>{sourceReviewText(result.resultText, sourceReviewText(result.analysisLabel))}</strong>
          {result.estimate !== undefined && result.estimate !== null && <b>{sourceReviewText(result.estimate)}</b>}
          <p>{sourceReviewText(result.rationale)}</p>
        </article>
      ))}
      {results.length === 0 && <p className="extraction-caveat">No compact causal result summary was returned.</p>}
    </div>
  );
}

export function ResearchDashboard() {
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const activeLanes = useMemo(() => brief ? researchLanesFromBrief(brief) : [], [brief]);
  const [caseId, setCaseId] = useState("");
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<PublicationFilter[]>(["trials", "reviews"]);
  const [runs, setRuns] = useState<Record<string, LaneRun>>({});
  const [deepDives, setDeepDives] = useState<Record<string, DeepDiveRun>>({});
  const [promotionRecords, setPromotionRecords] = useState<PromotionRecord[]>([]);
  const [openLane, setOpenLane] = useState<string>("");
  const [steering, setSteering] = useState<BriefSteering | null>(null);
  const [recall, setRecall] = useState<RecallRun>({
    status: "idle",
    response: null,
    error: "",
    progress: "Choose the claims that deserve broad and applicability-specific recall.",
    liveTrace: [],
  });
  const [sourceReviews, setSourceReviews] = useState<Record<string, SourceReviewRun>>({});
  const [storageReady, setStorageReady] = useState(false);
  const [companion, setCompanion] = useState<CompanionHealth>({ status: "checking", models: null, detail: "Checking the hosted evidence backend…" });
  const [runLedger, setRunLedger] = useState<ResearchRunLedger>({ briefId: "", startedAt: "", usage: emptyResearchUsage });
  const [researchTelemetry, setResearchTelemetry] = useState(emptyResearchTelemetry);
  const [recallStartedAt, setRecallStartedAt] = useState(0);
  const [recallElapsedMs, setRecallElapsedMs] = useState(0);

  const activeCount = useMemo(
    () => Object.values(runs).filter((run) => run.status === "running").length,
    [runs],
  );
  const keptClaimIds = useMemo(
    () => brief && steering ? brief.claims.filter((claim) => !steering.claims[claim.id]?.parked).map((claim) => claim.id) : [],
    [brief, steering],
  );
  // Steering changes the next search, never one in flight.
  const searching = activeCount > 0 || recall.status === "running";

  useEffect(() => {
    if (recall.status !== "running" || !recallStartedAt) return;
    const timer = window.setInterval(() => setRecallElapsedMs(Date.now() - recallStartedAt), 1_000);
    return () => window.clearInterval(timer);
  }, [recall.status, recallStartedAt]);

  function currentCaseId() {
    return caseId || brief?.caseId || "";
  }

  function researchPreferences(): ResearchPreferences {
    try {
      return parseResearchPreferences(window.localStorage.getItem(researchPreferencesStorageKey));
    } catch {
      return parseResearchPreferences(null);
    }
  }

  function runBudgetRemaining() {
    return remainingRunBudgetUsd(runLedger.usage.costUsd);
  }

  function recordResearchCall(stage: ResearchStage, startedAt: number, model: string, usageValue: unknown, effort = researchPreferences().effort) {
    const usage = normalizeResearchUsage(usageValue);
    setRunLedger((current) => {
      const next = { ...current, usage: addResearchUsage(current.usage, usage) };
      try {
        window.localStorage.setItem(researchRunStorageKey, JSON.stringify(next));
      } catch {
        // The in-page ledger still enforces the cap until reload.
      }
      return next;
    });
    setResearchTelemetry((current) => {
      const next = appendResearchTelemetrySample(current, {
        stage,
        effort,
        model,
        totalMs: Date.now() - startedAt,
        costUsd: usage.costUsd,
        at: new Date().toISOString(),
      });
      try {
        window.localStorage.setItem(researchTelemetryStorageKey, JSON.stringify(next));
      } catch {
        // Estimates fall back to provisional timings.
      }
      return next;
    });
  }

  function startNewRun() {
    const next = { briefId: brief?.briefId ?? "", startedAt: new Date().toISOString(), usage: emptyResearchUsage };
    setRunLedger(next);
    try {
      window.localStorage.setItem(researchRunStorageKey, JSON.stringify(next));
    } catch {
      // A fresh in-page ledger still applies.
    }
  }

  function currentWorkspace() {
    if (brief) {
      return {
        prompt: brief.originalQuestion,
        compiledQuestion: brief.compiledQuestion,
        decisionContext: brief.decisionContext,
        result: { caseId: brief.caseId, decisionContext: brief.decisionContext },
      };
    }
    return {};
  }

  async function checkCompanion() {
    // Everything runs on Lyra now. There is no local companion and no loopback
    // fetch from this page — a hosted run keeps the browser off the Local
    // Network Access permission prompt.
    setCompanion({
      status: "hosted",
      models: { primary: "Astra · GPT 6 → OpenRouter fallback", adversary: "Astra · adversarial reviewer → OpenRouter fallback" },
      detail: "Lead discovery, full-text extraction, adversarial review, and synthesis run on hosted backends. The browser never contacts a local companion.",
    });
  }

  async function loadPromotionRegister() {
    const activeCaseId = currentCaseId();
    if (!activeCaseId) {
      setPromotionRecords([]);
      return;
    }
    try {
      const response = await fetch(`/api/promote?caseId=${encodeURIComponent(activeCaseId)}`);
      const payload = await response.json() as { records?: PromotionRecord[] };
      if (response.ok) setPromotionRecords(payload.records ?? []);
    } catch {
      // A missing register must not block fresh discovery.
    }
  }

  useEffect(() => {
    void checkCompanion();
  }, []);

  useEffect(() => {
    try {
      let loadedBrief: ResearchBrief | null = null;
      const queryCaseId = new URLSearchParams(window.location.search).get("caseId")?.trim() || "";
      const rawBrief = window.localStorage.getItem(researchBriefStorageKey);
      if (rawBrief) {
        const parsedBrief = researchBriefSchema.safeParse(JSON.parse(rawBrief));
        if (parsedBrief.success) {
          if (!queryCaseId || parsedBrief.data.caseId === queryCaseId) loadedBrief = parsedBrief.data;
        } else {
          window.localStorage.removeItem(researchBriefStorageKey);
        }
      }
      const lanes = loadedBrief ? researchLanesFromBrief(loadedBrief) : [];
      setCaseId(queryCaseId || loadedBrief?.caseId || "");
      setBrief(loadedBrief);
      setQueries(defaultQueries(lanes));
      setRuns(freshRuns(lanes));
      setOpenLane(lanes[0]?.id ?? "");
      setSteering(loadedBrief ? parseBriefSteering(window.localStorage.getItem(claimSteeringStorageKey), loadedBrief) : null);
      setRunLedger(readRunLedger(loadedBrief?.briefId ?? ""));
      setResearchTelemetry(parseResearchTelemetry(window.localStorage.getItem(researchTelemetryStorageKey)));

      const raw = window.localStorage.getItem(dashboardCacheKey);
      if (!raw) return;
      const cached = JSON.parse(raw) as Partial<CachedDashboardState>;
      const briefId = loadedBrief?.briefId ?? "";
      if (cached.version !== 2 || !cached.savedAt || cached.briefId !== briefId) return;

      const restoredQueries = defaultQueries(lanes);
      for (const lane of lanes) {
        const cachedQuery = cached.queries?.[lane.id];
        if (typeof cachedQuery === "string") restoredQueries[lane.id] = cachedQuery;
      }
      setQueries(restoredQueries);

      if (Array.isArray(cached.filters)) {
        setFilters(cached.filters.filter((filter): filter is PublicationFilter => publicationOptions.some((option) => option.id === filter)));
      }

      const restoredRuns = freshRuns(lanes);
      for (const lane of lanes) {
        const cachedRun = cached.runs?.[lane.id];
        if (cachedRun?.response) {
          restoredRuns[lane.id] = {
            status: "complete",
            response: {
              ...cachedRun.response,
              cache: { status: "browser", layer: "browser", createdAt: cached.savedAt, expiresAt: null },
            },
            error: "",
          };
        }
      }
      setRuns(restoredRuns);

      const restoredDeepDives: Record<string, DeepDiveRun> = {};
      for (const [pmid, dive] of Object.entries(cached.deepDives ?? {})) {
        if (!dive?.payload) continue;
        restoredDeepDives[pmid] = {
          status: dive.status === "persisted" ? "persisted" : "review",
          payload: isDualReviewPayload(dive.payload)
            ? dive.payload
            : { ...dive.payload, cache: { status: "browser", layer: "browser", createdAt: cached.savedAt, expiresAt: null } },
          checked: dive.checked === true,
          error: "",
          progress: "Restored from this browser",
          fallbackAvailable: false,
        };
      }
      setDeepDives(restoredDeepDives);

      if (typeof cached.openLane === "string" && lanes.some((lane) => lane.id === cached.openLane)) setOpenLane(cached.openLane);
      if (cached.recall?.response) {
        setRecall({
          status: "complete",
          response: cached.recall.response,
          error: "",
          progress: "Restored the last lead-only discovery run from this browser.",
          liveTrace: cached.recall.response.toolTrace,
        });
      }
    } catch {
      window.localStorage.removeItem(dashboardCacheKey);
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    void loadPromotionRegister();
    // The register is reloaded when a newly compiled brief changes the case scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief?.caseId, caseId, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    const timer = window.setTimeout(() => {
      const reusableRuns = Object.fromEntries(activeLanes.map((lane) => {
        const run = runs[lane.id];
        return [lane.id, run.response
          ? { status: "complete", response: run.response, error: "" }
          : { status: "ready", response: null, error: "" }];
      })) as Record<string, LaneRun>;
      const reusableDeepDives = Object.fromEntries(
        Object.entries(deepDives)
          .filter(([, dive]) => dive.payload !== null)
          .map(([pmid, dive]) => [pmid, {
            status: dive.status === "persisted" ? "persisted" : "review",
            payload: dive.payload,
            checked: dive.checked,
            error: "",
            progress: dive.progress,
            fallbackAvailable: dive.fallbackAvailable,
          }]),
      ) as Record<string, DeepDiveRun>;
      const cache: CachedDashboardState = {
        version: 2,
        briefId: brief?.briefId ?? "",
        savedAt: new Date().toISOString(),
        queries,
        filters,
        runs: reusableRuns,
        deepDives: reusableDeepDives,
        openLane,
        recall: recall.response ? {
          status: "complete",
          response: recall.response,
          error: "",
          progress: "Restored from this browser.",
          liveTrace: recall.response.toolTrace,
        } : undefined,
      };
      window.localStorage.setItem(dashboardCacheKey, JSON.stringify(cache));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeLanes, brief?.briefId, deepDives, filters, openLane, queries, recall.response, runs, storageReady]);

  useEffect(() => {
    if (!storageReady || !steering) return;
    try {
      window.localStorage.setItem(claimSteeringStorageKey, JSON.stringify(steering));
    } catch {
      // Steering still applies for this page session.
    }
  }, [steering, storageReady]);

  function clearDashboardCache() {
    window.localStorage.removeItem(dashboardCacheKey);
    setQueries(defaultQueries(activeLanes));
    setFilters(["trials", "reviews"]);
    setRuns(freshRuns(activeLanes));
    setDeepDives({});
    setOpenLane(activeLanes[0]?.id ?? "");
    setRecall({
      status: "idle",
      response: null,
      error: "",
      progress: "Choose the claims that deserve broad and applicability-specific recall.",
      liveTrace: [],
    });
  }

  function toggleFilter(filter: PublicationFilter) {
    setFilters((current) => current.includes(filter)
      ? current.filter((candidate) => candidate !== filter)
      : [...current, filter]);
  }

  async function runLane(lane: ResearchLane, refresh = false) {
    setOpenLane(lane.id);
    setRuns((current) => ({
      ...current,
      [lane.id]: { status: "running", response: current[lane.id].response, error: "" },
    }));
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: queries[lane.id],
          filters,
          maxResults: researchBudgetProfiles[steering?.claims[lane.id]?.effort ?? researchPreferences().effort].pubmedMaxResults,
          refresh,
        }),
      });
      const payload = await response.json() as ResearchResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The live discovery sweep failed.");
      setRuns((current) => ({
        ...current,
        [lane.id]: { status: "complete", response: payload, error: "" },
      }));
    } catch (error) {
      setRuns((current) => ({
        ...current,
        [lane.id]: {
          status: "error",
          response: current[lane.id].response,
          error: error instanceof Error ? error.message : "The live discovery sweep failed.",
        },
      }));
    }
  }

  async function runKeptPubmedLanes(refresh = false) {
    // PubMed asks unauthenticated clients to stay below three requests/second.
    // Each lane performs a search and summary request, so run lanes in series.
    for (const lane of activeLanes) {
      if (keptClaimIds.includes(lane.id)) await runLane(lane, refresh);
    }
  }

  async function searchKeptClaims(refresh = false) {
    if (!brief || keptClaimIds.length === 0 || searching) return;
    // One action: web recall fans out per claim internally while PubMed lanes run alongside it.
    await Promise.allSettled([runRecall(refresh), runKeptPubmedLanes(refresh)]);
  }

  function updateClaimSteering(claimId: string, next: ClaimSteering) {
    setSteering((current) => current ? { ...current, claims: { ...current.claims, [claimId]: next } } : current);
  }

  function parkClaim(claimId: string) {
    const current = steering?.claims[claimId];
    if (!current || searching) return;
    updateClaimSteering(claimId, { ...current, parked: true });
  }

  function shareableRecallProfile() {
    if (!brief) {
      return {
        populationTerms: [],
        settingTerms: [],
        actionTerms: [],
        outcomeTerms: [],
        constraints: [],
        knownUnknowns: [],
      };
    }
    const selectedClaims = brief.claims.filter((claim) => keptClaimIds.includes(claim.id));
    const applicabilityAssignments = brief.dimensionAssignments.filter((assignment) =>
      assignment.role === "applicability-only" || assignment.role === "monitored-unknown");
    const settingPattern = /(where|setting|geograph|location|jurisdiction|market)/i;
    return {
      populationTerms: boundedUnique(selectedClaims.map((claim) => claim.population), 120),
      settingTerms: boundedUnique(applicabilityAssignments
        .filter((assignment) => settingPattern.test(`${assignment.label} ${assignment.axisId}`))
        .flatMap((assignment) => assignment.searchConcepts), 120),
      actionTerms: boundedUnique(selectedClaims.flatMap((claim) => [claim.exposure, claim.comparator]), 160),
      outcomeTerms: boundedUnique(selectedClaims.map((claim) => claim.outcome), 120),
      constraints: boundedUnique(selectedClaims.flatMap((claim) => claim.applicabilityFields), 220),
      knownUnknowns: boundedUnique(applicabilityAssignments.flatMap((assignment) => assignment.mismatchRisks), 220),
    };
  }

  async function runRecall(refresh = false) {
    if (!brief || !steering || keptClaimIds.length === 0) {
      setRecall((current) => ({
        ...current,
        status: "error",
        error: brief ? "Keep at least one claim to search." : "Compile a research brief before launching broad recall.",
      }));
      return;
    }
    if (runBudgetExhausted(runLedger.usage.costUsd)) {
      setRecall((current) => ({
        ...current,
        status: "error",
        error: `This run has spent its $${researchRunCapUsd} cap. Start a new run to search again.`,
      }));
      return;
    }
    const preferences = researchPreferences();
    const startedAt = Date.now();
    const claims = brief.claims
      .filter((claim) => keptClaimIds.includes(claim.id))
      .map((claim) => {
        const editedQuery = queries[claim.id]?.trim() ?? "";
        return {
          id: claim.id,
          statement: claim.statement,
          population: claim.population,
          exposure: claim.exposure,
          comparator: claim.comparator,
          outcome: claim.outcome,
          timeHorizon: claim.timeHorizon,
          decisionLeverage: claim.decisionLeverage,
          applicabilityFields: claim.applicabilityFields,
          retrieval: { ...claim.retrieval, searchQuery: editedQuery.length >= 8 ? editedQuery.slice(0, 800) : claim.retrieval.searchQuery },
          steering: recallSteering(steering.claims[claim.id]),
        };
      });
    const effort = strongestEffort(claims.map((claim) => claim.steering.effort));
    setRecall({
      status: "running",
      response: refresh ? recall.response : null,
      error: "",
      progress: "Launching broad-recall and applicability specialists in parallel…",
      liveTrace: [],
    });
    setRecallStartedAt(startedAt);
    setRecallElapsedMs(0);
    try {
      const response = await fetch("/api/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: brief.originalQuestion,
          compiledQuestion: brief.compiledQuestion,
          claims,
          applicabilityProfile: shareableRecallProfile(),
          promptOverrides: promptOverrides(),
          refresh,
          effort,
          models: { search: preferences.models.search },
          budgetRemainingUsd: runBudgetRemaining(),
        }),
      });
      const payload = await response.json() as RecallResponse & { error?: string; usage?: unknown };
      if (!response.ok) throw new Error(payload.error || "The hosted lead-discovery sweep failed.");
      recordResearchCall("recall", startedAt, payload.model, payload.usage, effort);
      setRecall({
        status: "complete",
        response: payload,
        error: "",
        progress: `${payload.leads.length} lead-only records returned across ${payload.lanes.length} search lanes.`,
        liveTrace: payload.toolTrace,
      });
    } catch (error) {
      const offline = error instanceof TypeError && /fetch/i.test(error.message);
      if (offline) {
        setCompanion({ status: "offline", models: null, detail: "Start npm run agents in the app directory, then retry this check." });
      }
      setRecall((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "The broad-recall sweep failed.",
        progress: "Lead discovery stopped.",
      }));
    }
  }

  async function investigateRecallLead(lead: RecallResponse["leads"][number]) {
    const sourceClass = lead.sourceClass;
    if (!sourceClass) return;
    if (runBudgetExhausted(runLedger.usage.costUsd)) {
      setSourceReviews((current) => ({
        ...current,
        [lead.id]: {
          status: "error",
          response: current[lead.id]?.response ?? null,
          error: `This run has spent its $${researchRunCapUsd} cap. Start a new run to read more sources.`,
        },
      }));
      return;
    }
    const preferences = researchPreferences();
    setSourceReviews((current) => ({
      ...current,
      [lead.id]: { status: "loading", response: current[lead.id]?.response ?? null, error: "" },
    }));
    try {
      const response = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: {
            sourceClass,
            url: lead.source.url,
            title: lead.source.title,
          },
          question: brief?.originalQuestion,
          decisionContext: brief?.decisionContext,
          claimFrames: compiledClaimFrames(),
          applicabilityProfile: localApplicabilityProfile(),
          promptOverrides: promptOverrides(),
          effort: preferences.effort,
          models: { reader: preferences.models.reader, reviewer: preferences.models.reviewer },
          budgetRemainingUsd: runBudgetRemaining(),
        }),
      });
      const payload = await response.json() as SourceReviewResponse & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || "The source acquisition and extraction failed.");
      setSourceReviews((current) => ({
        ...current,
        [lead.id]: { status: "complete", response: payload, error: "" },
      }));
    } catch (error) {
      setSourceReviews((current) => ({
        ...current,
        [lead.id]: {
          status: "error",
          response: current[lead.id]?.response ?? null,
          error: error instanceof Error ? error.message : "The source acquisition and extraction failed.",
        },
      }));
    }
  }

  function adoptRecallQuery(lead: RecallResponse["leads"][number]) {
    const claimId = lead.claimIds.find((candidate) => activeLanes.some((lane) => lane.id === candidate));
    if (!claimId || searching) return;
    setQueries((current) => ({ ...current, [claimId]: lead.discovery.reportedQuery }));
    document.getElementById(`claim-card-${claimId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function modelPreferences() {
    try {
      const preferences = JSON.parse(window.localStorage.getItem("epistack:preferences:v1") || "{}") as { apiKey?: string; model?: string };
      return { apiKey: preferences.apiKey?.trim() || "", model: preferences.model?.trim() || "anthropic/claude-opus-4.8" };
    } catch {
      return { apiKey: "", model: "anthropic/claude-opus-4.8" };
    }
  }

  function promptOverrides() {
    try {
      return sanitizeAgentPromptOverrides(JSON.parse(window.localStorage.getItem(agentPromptStorageKey) || "{}"));
    } catch {
      return {};
    }
  }

  function compiledClaimFrames(): ResearchClaimFrame[] {
    return brief?.claims ?? [];
  }

  function outboundApplicabilityProfile() {
    if (!brief) {
      return {
        populationTerms: [],
        settingTerms: [],
        actionTerms: [],
        outcomeTerms: [],
        constraints: [],
        knownUnknowns: [],
      };
    }
    const routedDimensions = brief.dimensionAssignments.filter((assignment) =>
      assignment.role === "applicability-only" || assignment.role === "monitored-unknown");
    const settingPattern = /(where|setting|geograph|location|jurisdiction|market)/i;
    return {
      populationTerms: boundedUnique(brief.claims.map((claim) => claim.population), 120),
      settingTerms: boundedUnique(routedDimensions
        .filter((assignment) => settingPattern.test(`${assignment.label} ${assignment.axisId}`))
        .flatMap((assignment) => assignment.searchConcepts), 120),
      actionTerms: boundedUnique(brief.claims.flatMap((claim) => [claim.exposure, claim.comparator]), 160),
      outcomeTerms: boundedUnique(brief.claims.map((claim) => claim.outcome), 120),
      constraints: boundedUnique(brief.claims.flatMap((claim) => claim.applicabilityFields), 220),
      knownUnknowns: boundedUnique(routedDimensions.flatMap((assignment) => assignment.mismatchRisks), 220),
    };
  }

  function localApplicabilityProfile() {
    if (!brief) return { summary: "No compiled stakeholder profile is available." };
    return {
      stakeholder: brief.stakeholderProfile,
      actionSpace: brief.actionSpace,
      applicabilityDimensions: brief.dimensionAssignments.filter((assignment) => assignment.role === "applicability-only"),
      monitoredUnknowns: brief.dimensionAssignments.filter((assignment) => assignment.role === "monitored-unknown"),
      // Interview answers the person kept for fit (or search); ignored answers are left out.
      answers: brief.claims.flatMap((claim) => {
        const claimSteering = steering?.claims[claim.id];
        return claimSteering ? fitContext(claimSteering).map((fact) => ({ claimId: claim.id, ...fact })) : [];
      }),
      privacy: brief.privacy,
    };
  }

  async function extractAbstractRecord(record: PubmedDiscovery, refresh = false) {
    setDeepDives((current) => ({
      ...current,
      [record.pmid]: { status: "extracting", payload: null, checked: false, error: "", progress: "Extracting the PubMed abstract", fallbackAvailable: false },
    }));
    try {
      const preferences = modelPreferences();
      const response = await fetch("/api/deep-dive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record,
          claimFrames: compiledClaimFrames(),
          applicabilityProfile: outboundApplicabilityProfile(),
          openRouterApiKey: preferences.apiKey,
          openRouterModel: researchPreferences().models.reader || preferences.model,
          promptOverrides: promptOverrides(),
          refresh,
        }),
      });
      const payload = await response.json() as DeepDiveResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The abstract extraction failed.");
      setDeepDives((current) => ({
        ...current,
        [record.pmid]: { status: "review", payload, checked: false, error: "", progress: "Abstract-only proposal ready", fallbackAvailable: false },
      }));
    } catch (error) {
      setDeepDives((current) => ({
        ...current,
        [record.pmid]: { status: "error", payload: null, checked: false, error: error instanceof Error ? error.message : "The abstract extraction failed.", progress: "Abstract fallback failed", fallbackAvailable: true },
      }));
    }
  }

  async function promoteAbstractRecord(record: PubmedDiscovery) {
    const dive = deepDives[record.pmid];
    if (!dive?.payload || isDualReviewPayload(dive.payload) || !dive.checked) return;
    setDeepDives((current) => ({ ...current, [record.pmid]: { ...dive, status: "promoting", error: "" } }));
    try {
      const workspace = currentWorkspace();
      const response = await fetch("/api/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: workspace.result?.caseId,
          originalPrompt: workspace.prompt,
          compiledQuestion: workspace.compiledQuestion,
          source: dive.payload.source,
          candidate: dive.payload.candidate,
          model: dive.payload.model,
          claimFrames: compiledClaimFrames(),
          humanChecked: true,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The checked results could not be promoted.");
      setDeepDives((current) => ({ ...current, [record.pmid]: { ...dive, status: "persisted", error: "" } }));
      await loadPromotionRegister();
    } catch (error) {
      setDeepDives((current) => ({
        ...current,
        [record.pmid]: { ...dive, status: "error", error: error instanceof Error ? error.message : "The checked results could not be promoted." },
      }));
    }
  }

  async function autoPromoteDualReview(record: PubmedDiscovery, payload: DualReviewResponse) {
    if (!payload.promotion.eligible) {
      setDeepDives((current) => ({
        ...current,
        [record.pmid]: {
          status: "review",
          payload,
          checked: false,
          error: payload.promotion.reasons.join(" "),
          progress: "Adversarial review finished without automatic promotion",
          fallbackAvailable: false,
        },
      }));
      return;
    }
    setDeepDives((current) => ({
      ...current,
      [record.pmid]: { status: "promoting", payload, checked: false, error: "", progress: "Writing accepted results and review provenance", fallbackAvailable: false },
    }));
    const workspace = currentWorkspace();
    const response = await fetch("/api/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: workspace.result?.caseId,
        originalPrompt: workspace.prompt,
        compiledQuestion: workspace.compiledQuestion,
        source: payload.source,
        candidate: payload.candidate,
        model: payload.models.primary,
        claimFrames: compiledClaimFrames(),
        humanChecked: false,
        reviewMode: "adversarial-auto",
        verificationStatus: payload.verificationStatus,
        artifact: payload.artifact,
        adversarialReview: {
          policyId: payload.promotion.policyId,
          models: payload.models,
          review: payload.review,
          decisions: payload.decisions,
        },
      }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "The dual-reviewed results could not be auto-promoted.");
    setDeepDives((current) => ({
      ...current,
      [record.pmid]: { status: "persisted", payload, checked: false, error: "", progress: "Accepted results persisted with adversarial provenance", fallbackAvailable: false },
    }));
    await loadPromotionRegister();
  }

  async function investigateFullText(record: PubmedDiscovery, refresh = false) {
    if (runBudgetExhausted(runLedger.usage.costUsd)) {
      setDeepDives((current) => ({
        ...current,
        [record.pmid]: {
          status: "error",
          payload: current[record.pmid]?.payload ?? null,
          checked: false,
          error: `This run has spent its $${researchRunCapUsd} cap. Start a new run to read more papers.`,
          progress: "Run cap reached",
          fallbackAvailable: false,
        },
      }));
      return;
    }
    const preferences = researchPreferences();
    const startedAt = Date.now();
    setDeepDives((current) => ({
      ...current,
      [record.pmid]: { status: "reviewing", payload: null, checked: false, error: "", progress: "Acquiring and cross-checking the full paper on the hosted evidence backend", fallbackAvailable: false },
    }));
    try {
      const workspace = currentWorkspace();
      const response = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record,
          question: workspace.prompt,
          decisionContext: workspace.decisionContext || workspace.result?.decisionContext,
          claimFrames: compiledClaimFrames(),
          applicabilityProfile: localApplicabilityProfile(),
          promptOverrides: promptOverrides(),
          refresh,
          effort: preferences.effort,
          models: { reader: preferences.models.reader, reviewer: preferences.models.reviewer },
          budgetRemainingUsd: runBudgetRemaining(),
        }),
      });
      const completed = await response.json() as DualReviewResponse & { error?: string; code?: string; usage?: unknown };
      if (!response.ok || completed.error) {
        throw Object.assign(new Error(completed.error || "The hosted full-text investigation failed."), { code: completed.code });
      }
      recordResearchCall("full-text", startedAt, completed.models.primary, completed.usage);
      await autoPromoteDualReview(record, completed);
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
      setDeepDives((current) => ({
        ...current,
        [record.pmid]: {
          status: "error",
          payload: current[record.pmid]?.payload ?? null,
          checked: false,
          error: error instanceof Error ? error.message : "The full-paper investigation failed.",
          progress: "Full-paper run stopped",
          fallbackAvailable: code === "NO_OPEN_FULL_TEXT",
        },
      }));
    }
  }

  const localAgentControlsAvailable = companion.status === "online" || companion.status === "hosted";
  const artifactHref = caseId ? `/artifact?caseId=${encodeURIComponent(caseId)}` : "/artifact";
  const refreshInvestigation = () => {
    if (!brief || keptClaimIds.length === 0 || searching) return;
    if (!window.confirm("Refresh the investigation live? This reruns web recall and PubMed for every kept claim, bypassing saved operation results.")) return;
    void searchKeptClaims(true);
  };

  useEffect(() => {
    window.addEventListener("epistack:refresh-investigation", refreshInvestigation);
    return () => window.removeEventListener("epistack:refresh-investigation", refreshInvestigation);
    // The handler intentionally closes over the current phase state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCount, activeLanes.length, brief, keptClaimIds, queries, recall.status, steering, storageReady]);

  const displayEffort = strongestEffort(steering ? keptClaimIds.map((claimId) => steering.claims[claimId].effort) : []);
  const recallEstimate = researchStageEstimate(researchTelemetry, "recall", displayEffort);
  const spendExhausted = runBudgetExhausted(runLedger.usage.costUsd);
  const recallEstimateLabel = recallEstimate.provisional
    ? recallEstimate.samples === 0 && researchTelemetry.samples.every((sample) => sample.stage !== "recall")
      ? `No timed searches yet; allow up to ${formatDuration(recallEstimate.estimateMs)}`
      : `A search takes about ${formatDuration(recallEstimate.estimateMs)} (sharper after 3 timed runs)`
    : `A search takes about ${formatDuration(recallEstimate.estimateMs)} (median of ${recallEstimate.samples} runs)`;
  const budgetPanel = (
    <div className="research-budget">
      <p className={`research-budget-line ${spendExhausted ? "exhausted" : ""}`}>
        <span>Spent <strong>{formatUsd(runLedger.usage.costUsd)}</strong> of ${researchRunCapUsd} this run</span>
        {runLedger.usage.webSearchRequests > 0 && <span>{runLedger.usage.webSearchRequests} web searches</span>}
        {recall.status !== "running" && <span>{recallEstimateLabel}</span>}
        {(runLedger.usage.calls > 0 || spendExhausted) && !searching && (
          <button type="button" onClick={startNewRun}>Start a new run</button>
        )}
      </p>
      {recall.status === "running" && (
        <>
          <div className="research-eta-rail" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.min(1, recallElapsedMs / recallEstimate.estimateMs)})` }} />
          </div>
          <p className="research-budget-line">
            <span>{formatDuration(recallElapsedMs)} elapsed</span>
            <span>
              {recallElapsedMs < recallEstimate.estimateMs
                ? `about ${formatDuration(recallEstimate.estimateMs - recallElapsedMs)} left`
                : "taking longer than usual"}
              {recallEstimate.provisional ? " (provisional estimate)" : ""}
            </span>
          </p>
        </>
      )}
    </div>
  );

  if (!storageReady) {
    return (
      <section className="research-prerequisite" aria-live="polite">
        <span className="live-artifact-pulse" aria-hidden="true" />
        <div>
          <strong>Loading the human-edited research contract…</strong>
          <p>No retrieval or promotion control is enabled until its case identity and claim frames are verified.</p>
        </div>
      </section>
    );
  }

  if (!brief) {
    return (
      <>
        <header className="page-hero research-hero">
          <div>
            <div className="eyebrow">Investigation cockpit · Research contract required</div>
            <h1>Compile the question before spending retrieval attention.</h1>
            <p className="lede">
              This case has no matching human-edited ResearchBrief in this browser. Epistack will not substitute a demo,
              infer an action space, or write evidence into a fallback case.
            </p>
          </div>
          <button className="primary-button run-all" disabled>Research unavailable</button>
        </header>
        <section className="research-prerequisite">
          <div>
            <span>Required handoff</span>
            <strong>Decompose, contextualize, and compile a case-specific research contract.</strong>
            <p>
              {caseId
                ? `The requested case “${caseId}” does not match the locally stored brief.`
                : "No active case identity or compiled brief was found."}{" "}
              Return to the question compiler to create the claims, action options, privacy boundary, and retrieval budget that agents are allowed to use.
            </p>
          </div>
          <Link className="primary-button" href="/">Start with a question</Link>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="page-hero research-hero">
        <div>
          <div className="eyebrow">Investigation cockpit · Compiled research contract</div>
          <h1>Direct the search. Let independent agents do the first audit.</h1>
          <p className="lede">
            Each lane is traced to the human-edited scope, runs a real editable PubMed sweep, and keeps personal context local for applicability checks. Hosted extraction preserves the full text, produces atomic results, and runs an independent adversarial pass.
          </p>
        </div>
      </header>

      {brief && (
        <section className="research-brief-contract" aria-labelledby="research-contract-title">
          <header>
            <div><span>Compiled from Decompose + Contextualize</span><h2 id="research-contract-title">The contract every agent receives.</h2></div>
            <small>{brief.compiledBy} · {brief.claims.reduce((sum, claim) => sum + claim.budgetShare, 0)} budget points</small>
          </header>
          <div className="research-contract-grid">
            <article>
              <span>Stakeholder and objective</span>
              <p>{brief.stakeholderProfile.summary}</p>
            </article>
            <article>
              <span>Concrete action</span>
              <p>{brief.actionSpace.decision}</p>
              <div>{brief.actionSpace.options.map((option) => <em key={option.id}>{option.label} · {option.feasibility}</em>)}</div>
            </article>
            <article>
              <span>Dimension routing</span>
              <div className="role-counts">
                {(["decision-active", "applicability-only", "monitored-unknown", "parked"] as const).map((role) => (
                  <em key={role}><b>{brief.dimensionAssignments.filter((assignment) => assignment.role === role).length}</b>{role}</em>
                ))}
              </div>
            </article>
            <article>
              <span>Privacy boundary</span>
              <p>{brief.privacy.outboundQueryPolicy}</p>
            </article>
          </div>
        </section>
      )}

      <section className="research-boundary" aria-label="MVP evidence boundary">
        <div>
          <span>Working vertical slice</span>
          <strong>{brief.claims.length} compiled claims → live discovery → atomic results</strong>
        </div>
        <p>
          Search rank is not evidential weight. A new record must be scoped, decomposed, checked, given an applicability-distance vector, and assigned to a justified dependence family before it can affect the decision.
        </p>
      </section>

      {steering && (
        <ClaimBoard
          claims={[...brief.claims].sort((a, b) => a.priority - b.priority)}
          steering={steering}
          queries={queries}
          locked={searching}
          budgetExhausted={spendExhausted || !localAgentControlsAvailable}
          planSummary={steeringPlanSummary(brief.claims, steering)}
          budget={budgetPanel}
          onSteeringChange={updateClaimSteering}
          onQueryChange={(claimId, query) => setQueries((current) => ({ ...current, [claimId]: query }))}
          onSearch={() => void searchKeptClaims(false)}
        />
      )}

      <details className="research-advanced">
        <summary>Advanced · publication types, browser cache, backend status</summary>
        <div className="research-advanced-body">
          <section className="query-controls" aria-labelledby="query-controls-title">
            <div>
              <span>Human control surface</span>
              <h2 id="query-controls-title">Choose what the agents are allowed to retrieve.</h2>
            </div>
            <div className="filter-pills" aria-label="Publication type filters">
              {publicationOptions.map((option) => (
                <button
                  key={option.id}
                  className={filters.includes(option.id) ? "active" : ""}
                  onClick={() => toggleFilter(option.id)}
                  aria-pressed={filters.includes(option.id)}
                  disabled={searching}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="cache-controls">
              <p>Results reopen instantly on this browser. Shared operation outputs expire; accepted evidence records do not.</p>
              <button onClick={clearDashboardCache} disabled={searching} title="Remove only this browser’s research display cache. The shared operation cache and accepted evidence graph are unchanged.">
                Reset browser cache
              </button>
            </div>
          </section>

          <section className={`local-companion-status ${companion.status}`} aria-label="Hosted evidence backend status">
            <div><i aria-hidden="true" /><span>{companion.status}</span></div>
            <p><strong>Hosted evidence backend</strong>{companion.models ? ` · ${companion.models.primary} extracts, ${companion.models.adversary} challenges` : ""}</p>
            <small>{companion.detail}</small>
            <button type="button" onClick={() => void checkCompanion()} disabled={companion.status === "checking"}>{companion.status === "checking" ? "Checking…" : "Check again"}</button>
          </section>

          <section className="capability-rail" aria-label="Investigation capability status">
            {researchCapabilities.map((capability) => (
              <article className={capability.status} key={capability.id}>
                <div><i aria-hidden="true" /><span>{capability.status === "live" ? "live" : "planned"}</span></div>
                <strong>{capability.label}</strong>
                <p>{capability.detail}</p>
              </article>
            ))}
          </section>
        </div>
      </details>

      {(recall.status !== "idle" || recall.response) && (
      <section className="recall-cockpit" aria-labelledby="recall-cockpit-title">
        <header>
          <div>
            <span>Recall layer · Lead-only</span>
            <h2 id="recall-cockpit-title">Search beyond the obvious corpus without weakening the evidence gate.</h2>
            <p>One specialist looks broadly for direct, negative, corrective, and boundary-setting sources. Another searches for transportability to the shareable parts of this action context. Neither can promote a claim.</p>
          </div>
          {recall.response && (
            <div className="recall-launch">
              <button className="cache-refresh-button" onClick={() => void runRecall(true)} disabled={!localAgentControlsAvailable || searching}>
                Refresh live
              </button>
            </div>
          )}
        </header>

        <div className={`recall-progress ${recall.status}`}>
          <i aria-hidden="true" />
          <span role={recall.status === "running" ? "status" : undefined} aria-live={recall.status === "running" ? "polite" : undefined}>
            {recall.status === "running" ? "Finding sources…" : recall.error || recall.progress}
          </span>
          {recall.response && <small>{recall.response.cache.status === "hit" ? "exact local run reused" : recall.response.cache.status === "bypass" ? "recomputed live" : "fresh local run"} · {recall.response.model}</small>}
        </div>

        {recall.status === "complete" && recall.response && (
          <div
            className="role-counts"
            aria-label="Recall discovery leads by lane"
            style={{
              alignItems: "center",
              background: "#f7f8f4",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              padding: "10px 28px",
            }}
          >
            {recall.response.lanes.map((lane) => {
              const leads = recall.response!.leads.filter((lead) => lane.leadIds.includes(lead.id));
              const classBreakdown = recallClassBreakdown(leads);
              return (
                <em key={lane.lane}>
                  <b>{recallLaneLabels[lane.lane]}</b>
                  · {leads.length}
                  {classBreakdown && <span style={{ opacity: 0.72 }}> · {classBreakdown}</span>}
                  {lane.lane === "context" && <span style={{ color: "#8b3c32" }}> · context only</span>}
                </em>
              );
            })}
          </div>
        )}

        {(recall.liveTrace.length > 0 || recall.response) && (
          <details className="recall-trace" open={recall.status === "running"}>
            <summary>
              Inspect actual search/fetch events
              <span>{recall.liveTrace.filter((event) => event.state === "requested").length} observed invocations</span>
            </summary>
            <div>
              {recall.liveTrace.map((event) => (
                <article key={event.id}>
                  <span>{event.lane.replaceAll("-", " ")}</span>
                  <strong>{event.tool} · {event.state}</strong>
                  <code>{event.query || event.url || "Invocation input not present in the CLI event."}</code>
                </article>
              ))}
              {recall.liveTrace.length === 0 && (
                <p>No tool invocation inputs were visible in the hosted provider response; reported queries must be treated as model-authored.</p>
              )}
            </div>
            {recall.response && <small>{recall.response.observability.boundary}</small>}
          </details>
        )}

        {recall.response && (
          <div className="recall-lanes">
            {recall.response.lanes.map((recallLane) => {
              const leads = recall.response?.leads.filter((lead) => recallLane.leadIds.includes(lead.id)) ?? [];
              return (
                <section key={recallLane.lane}>
                  <header>
                    <div>
                      <span>{recallLane.lane.replaceAll("-", " ")}</span>
                      <strong>{leads.length} leads · outside accepted graph</strong>
                    </div>
                    <p>{recallLane.searchSummary}</p>
                  </header>
                  <div>
                    {leads.map((lead) => {
                      const sourceReview = sourceReviews[lead.id] ?? { status: "idle", response: null, error: "" };
                      return (
                      <article className={lead.disconfirming ? "disconfirming" : ""} key={lead.id}>
                        <div className="recall-lead-status">
                          <span>{lead.status}</span>
                          <small>{lead.sourceClass ? sourceClassLabels[lead.sourceClass] : lead.source.type.replaceAll("-", " ")}</small>
                          {lead.sourceClass && !canPromoteSourceClass(lead.sourceClass) && <em className="lead-class-note">context, not evidence</em>}
                          {lead.disconfirming && <b>could disconfirm</b>}
                        </div>
                        <h3>{lead.source.title}</h3>
                        <p>{lead.whyRelevant}</p>
                        <dl>
                          <div><dt>Claim links</dt><dd>{lead.claimIds.join(" · ")}</dd></div>
                          <div><dt>Limitation</dt><dd>{lead.limitation}</dd></div>
                          <div><dt>Reported query</dt><dd>{lead.discovery.reportedQuery}</dd></div>
                        </dl>
                        <div className="recall-observation-badges">
                          <span className={lead.discovery.queryObserved ? "observed" : ""}>{lead.discovery.queryObserved ? "query observed" : "query model-reported"}</span>
                          <span className={lead.discovery.sourceFetchObserved ? "observed" : ""}>{lead.discovery.sourceFetchObserved ? "fetch observed" : "fetch not observed"}</span>
                        </div>
                        <footer>
                          <a href={lead.source.url} target="_blank" rel="noreferrer">Open lead ↗</a>
                          <button onClick={() => adoptRecallQuery(lead)} disabled={searching} title="Copy this lead's reported query onto its claim card for the next search.">Use this query</button>
                          {lead.claimIds.length === 1 && steering?.claims[lead.claimIds[0]] && !steering.claims[lead.claimIds[0]].parked && (
                            <button onClick={() => parkClaim(lead.claimIds[0])} disabled={searching} title="Skip this claim in the next search. Its leads stay here.">
                              Park this claim
                            </button>
                          )}
                          {lead.sourceClass && (
                            <button
                              onClick={() => void investigateRecallLead(lead)}
                              disabled={sourceReview.status === "loading"}
                              title="Acquire the declared source and extract its typed review payload."
                            >
                              {sourceReview.status === "loading" ? "Acquiring & extracting…" : sourceReview.response ? "Re-acquire & extract" : "Acquire & extract"}
                            </button>
                          )}
                        </footer>
                        {sourceReview.status === "loading" && <div className="local-agent-progress"><i aria-hidden="true" /><span>Acquiring and extracting this declared source…</span></div>}
                        {sourceReview.error && <p className="deep-dive-error" role="alert">{sourceReview.error}</p>}
                        {sourceReview.response && (
                          <div className="candidate-extraction source-review-extraction">
                            <header>
                              <div>
                                <span>Source review · {sourceReview.response.role}</span>
                                <strong>{sourceReview.response.source.title}</strong>
                              </div>
                              <div className="candidate-cache-meta">
                                <em>{sourceReview.response.source.acquisition}</em>
                                <small>{sourceReview.response.evidenceStatus}{sourceReview.response.preliminary ? " · preliminary" : ""}</small>
                              </div>
                            </header>
                            <div className="recall-observation-badges" aria-label="Source review status">
                              <span className={sourceReview.response.source.acquisition === "fetched-verified" ? "observed" : ""}>{sourceReview.response.source.acquisition}</span>
                              <span>{sourceReview.response.role} role</span>
                            </div>
                            {renderSourceReviewPayload(sourceReview.response)}
                          </div>
                        )}
                      </article>
                      );
                    })}
                  </div>
                  {recallLane.unsearchedBoundaries.length > 0 && (
                    <details className="recall-boundaries">
                      <summary>Unsearched boundaries</summary>
                      <ul>{recallLane.unsearchedBoundaries.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul>
                    </details>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <footer className="recall-boundary-note">
          <strong>Hard boundary:</strong>
          <span>Opening a lead or copying its query does not create evidence. Acquisition, atomic extraction, dependence assignment, and adversarial verification still have to succeed.</span>
        </footer>
      </section>
      )}

      {activeLanes.some((lane) => runs[lane.id]?.status !== "ready") && (
      <div className="research-lanes">
        {activeLanes.map((lane, index) => {
          const run = runs[lane.id];
          const expanded = openLane === lane.id;
          return (
            <article className={`research-lane ${run.status} ${expanded ? "expanded" : ""}`} key={lane.id}>
              <button className="lane-heading" onClick={() => setOpenLane((current) => current === lane.id ? "" : lane.id)} aria-expanded={expanded}>
                <span className="lane-number">0{index + 1}</span>
                <span>
                  <small>{steering?.claims[lane.id]?.parked ? "parked for the next search" : statusLabel(run.status)}</small>
                  <strong>{lane.label}</strong>
                  <p>{lane.question}</p>
                </span>
                <b aria-hidden="true">{expanded ? "−" : "+"}</b>
              </button>

              {expanded && (
                <div className="lane-body">
                  <div className="lane-brief">
                    <div><span>Agent brief</span><p>{lane.focus}</p></div>
                    <div><span>Crux</span><p>{lane.crux}</p></div>
                    <div><span>Inclusion rule</span><p>{lane.inclusionRule}</p></div>
                    <div className="lane-context-bridge">
                      <span>Why this lane exists</span>
                      {lane.contextualization.length ? lane.contextualization.map((context) => (
                        <div className="lane-context-link" key={context.axisId}>
                          <strong>{context.label}</strong>
                          <p><b>Answer:</b> {context.answer}</p>
                          <p><b>Effect:</b> {context.consequence}</p>
                        </div>
                      )) : <p>This claim has no recorded contextual answer. It follows the compiled decomposition contract directly.</p>}
                    </div>
                    {lane.budgetShare && <div><span>Token budget</span><p>{lane.budgetShare}% of this investigation portfolio.</p></div>}
                    {lane.relaxationOrder?.length ? <div><span>Constraint relaxation</span><ol>{lane.relaxationOrder.map((step) => <li key={step}>{step}</li>)}</ol></div> : null}
                  </div>
                  <div className="lane-actions">
                    <span>Edit this claim&apos;s query on its card above; it applies to the next search. Discovery begins as leads. Only case-scoped records that cross the declared promotion policy appear in the live artifact.</span>
                  </div>

                  {run.error && <p className="lane-error" role="alert">{run.error}</p>}

                  {run.response && (
                    <section className="live-discoveries" aria-label={`${lane.label} discovery results`}>
                      <header>
                        <div><span>Live discovery sweep</span><strong>{run.response.records.length} shown · {run.response.totalMatches.toLocaleString()} PubMed matches</strong></div>
                        <div className="cache-meta">
                          <em title={cacheTitle(run.response.cache)}>{cacheLabel(run.response.cache)}</em>
                          <small>retrieved {new Date(run.response.retrievedAt).toLocaleString()}</small>
                        </div>
                      </header>
                      <div className="executed-query"><span>Executed</span><code>{run.response.executedQuery}</code></div>
                      <div className="discovery-records">
                        {run.response.records.map((record) => {
                          const promoted = promotionRecords.find((candidate) => candidate.pmid === record.pmid);
                          const resultId = promoted?.result_id;
                          const deepDive = deepDives[record.pmid] ?? { status: "idle", payload: null, checked: false, error: "", progress: "", fallbackAvailable: false };
                          const dualPayload = deepDive.payload && isDualReviewPayload(deepDive.payload) ? deepDive.payload : null;
                          const abstractPayload = deepDive.payload && !isDualReviewPayload(deepDive.payload) ? deepDive.payload : null;
                          const agentBusy = ["acquiring", "extracting", "reviewing", "adjudicating", "promoting"].includes(deepDive.status);
                          const actionLabel = deepDive.status === "persisted"
                            ? "Persisted with provenance"
                            : companion.status === "hosted"
                              ? "Run hosted full-text review"
                            : deepDive.status === "acquiring" || deepDive.status === "extracting"
                              ? "Reading full paper…"
                              : deepDive.status === "reviewing"
                                ? "Adversarial pass…"
                                : deepDive.status === "adjudicating"
                                  ? "Checking quotations…"
                                  : deepDive.status === "promoting"
                                    ? "Auto-promoting…"
                                    : "Run full-paper cross-check";
                          return (
                            <article className={promoted ? "promoted" : "unreviewed"} key={record.pmid}>
                              <div className="record-status">
                                <span>{promoted ? "accepted in this case" : "unreviewed lead"}</span>
                                <small>PMID {record.pmid}</small>
                              </div>
                              <h3>{record.title}</h3>
                              <p>{record.authors}</p>
                              <small>{record.journal} · {record.published}</small>
                              <footer>
                                {resultId && <Link href={`/artifact?caseId=${encodeURIComponent(caseId)}#${encodeURIComponent(resultId)}`}>Inspect atomic results <span aria-hidden="true">→</span></Link>}
                                <button
                                  onClick={() => investigateFullText(record)}
                                  disabled={!localAgentControlsAvailable || agentBusy || deepDive.status === "persisted"}
                                  title={localAgentControlsAvailable ? "Acquire and cross-check the full paper with the hosted evidence backend." : companion.detail}
                                >
                                  {actionLabel}
                                </button>
                                <a href={record.url} target="_blank" rel="noreferrer">Open PubMed ↗</a>
                              </footer>
                              {agentBusy && <div className="local-agent-progress"><i aria-hidden="true" /><span>{deepDive.progress}</span></div>}
                              {deepDive.error && (
                                <p className="deep-dive-error" role="alert">{deepDive.error} {deepDive.error.includes("bring-your-own") && <Link href="/?settings=1">Open Settings on the Frame page.</Link>}</p>
                              )}
                              {deepDive.fallbackAvailable && (
                                <div className="candidate-actions fallback-actions">
                                  <button className="cache-refresh-button" onClick={() => void checkCompanion()}>Recheck companion status</button>
                                  <button className="cache-refresh-button" onClick={() => extractAbstractRecord(record)}>Use abstract-only fallback</button>
                                </div>
                              )}
                              {dualPayload && (
                                <div className="candidate-extraction dual-review-extraction">
                                  <header>
                                    <div>
                                      <span>Dual-model full-text review</span>
                                      <strong>{dualPayload.promotion.acceptedCount} promoted · {dualPayload.promotion.rejectedCount} rejected</strong>
                                    </div>
                                    <div className="candidate-cache-meta">
                                      <em>{dualPayload.cache.status === "hit" ? "reused hosted operation cache" : dualPayload.cache.status === "bypass" ? "recomputed live" : "fresh hosted run"}</em>
                                      <small>{dualPayload.models.primary} → {dualPayload.models.adversary}</small>
                                    </div>
                                  </header>
                                  <dl className="candidate-study">
                                    <div><dt>Design</dt><dd>{dualPayload.candidate.study.design}</dd></div>
                                    <div><dt>Population</dt><dd>{dualPayload.candidate.study.population}</dd></div>
                                    <div><dt>Preserved source</dt><dd>{dualPayload.artifact.pmcid} · SHA-256 {dualPayload.artifact.contentHash.slice(0, 12)}…</dd></div>
                                  </dl>
                                  <div className="adversarial-decisions">
                                    {dualPayload.decisions.map((decision) => (
                                      <article className={decision.finalDecision} key={`${record.pmid}-review-${decision.resultIndex}`}>
                                        <div>
                                          <span>{decision.finalDecision === "promote" ? "survived" : "rejected"}</span>
                                          <small>{decision.reviewerVerdict} · passage {decision.passageFound ? "found" : "not found"}</small>
                                        </div>
                                        <strong>{decision.analysisLabel}</strong>
                                        <p>{decision.rationale}</p>
                                      </article>
                                    ))}
                                  </div>
                                  <div className="candidate-results">
                                    {dualPayload.candidate.results.map((result, resultIndex) => (
                                      <article key={`${record.pmid}-accepted-${resultIndex}`}>
                                        <div><span className={`relation-chip ${result.relation}`}>{result.relation}</span><small>{result.claimFrameId} · {result.scopeMatch}</small></div>
                                        <strong>{result.resultText}</strong>
                                        {result.estimate && <b>{result.estimate}</b>}
                                        <p>{result.rationale}</p>
                                        <div className={`applicability-vector ${result.applicability.distance}`}>
                                          <span>Applicability · {result.applicability.distance}</span>
                                          <dl>
                                            <div><dt>Matched</dt><dd>{result.applicability.matched.join(", ") || "none established"}</dd></div>
                                            <div><dt>Mismatch</dt><dd>{result.applicability.mismatched.join(", ") || "none identified"}</dd></div>
                                            <div><dt>Unknown</dt><dd>{result.applicability.unknown.join(", ") || "none recorded"}</dd></div>
                                          </dl>
                                          {result.applicability.constraintRelaxations.length > 0 && <small>Relaxed: {result.applicability.constraintRelaxations.join(" → ")}</small>}
                                        </div>
                                        <blockquote>“{result.exactExcerpt}”</blockquote>
                                        <small>{result.locator} · quotation checked against preserved full text</small>
                                      </article>
                                    ))}
                                  </div>
                                  <p className="extraction-caveat">
                                    <strong>{deepDive.status === "persisted" ? "Auto-promoted:" : "Promotion policy:"}</strong>{" "}
                                    {deepDive.status === "persisted"
                                      ? "Only records accepted by the adversarial model and the deterministic passage check entered the graph."
                                      : dualPayload.promotion.reasons.join(" ") || "Eligible records are being written with both agents' provenance."}
                                  </p>
                                  <div className="candidate-actions">
                                    <a className="cache-refresh-button" href={dualPayload.source.url} target="_blank" rel="noreferrer">Open preserved full text ↗</a>
                                    <button className="cache-refresh-button" onClick={() => investigateFullText(record, true)} disabled={!localAgentControlsAvailable || agentBusy}>Re-run both models</button>
                                  </div>
                                </div>
                              )}
                              {abstractPayload && (
                                <div className="candidate-extraction">
                                  <header>
                                    <div><span>Explicit fallback</span><strong>{abstractPayload.candidate.results.length} atomic results · abstract only</strong></div>
                                    <div className="candidate-cache-meta">
                                      <em title={cacheTitle(abstractPayload.cache)}>{cacheLabel(abstractPayload.cache)}</em>
                                      <small>{abstractPayload.model}</small>
                                    </div>
                                  </header>
                                  <dl className="candidate-study">
                                    <div><dt>Design</dt><dd>{abstractPayload.candidate.study.design}</dd></div>
                                    <div><dt>Population</dt><dd>{abstractPayload.candidate.study.population}</dd></div>
                                    <div><dt>Evidence family</dt><dd>{abstractPayload.candidate.evidenceFamily.label}</dd></div>
                                  </dl>
                                  <div className="candidate-results">
                                    {abstractPayload.candidate.results.map((result, resultIndex) => (
                                      <article key={`${record.pmid}-${resultIndex}`}>
                                        <div><span className={`relation-chip ${result.relation}`}>{result.relation}</span><small>{result.claimFrameId} · {result.scopeMatch}</small></div>
                                        <strong>{result.resultText}</strong>
                                        {result.estimate && <b>{result.estimate}</b>}
                                        <p>{result.rationale}</p>
                                        <div className={`applicability-vector ${result.applicability.distance}`}>
                                          <span>Applicability · {result.applicability.distance}</span>
                                          <small>{result.applicability.rationale}</small>
                                        </div>
                                        <small>{result.locator} · proposed from abstract</small>
                                      </article>
                                    ))}
                                  </div>
                                  <p className="extraction-caveat"><strong>Cannot yet verify:</strong> {abstractPayload.candidate.extractionCaveat}</p>
                                  <label className="human-promotion-check">
                                    <input
                                      type="checkbox"
                                      checked={deepDive.checked}
                                      onChange={(event) => setDeepDives((current) => ({
                                        ...current,
                                        [record.pmid]: { ...deepDive, checked: event.target.checked },
                                      }))}
                                    />
                                    <span>I checked the abstract, result boundaries, claim relations, and dependence-family proposal. Keep status “pending full text.”</span>
                                  </label>
                                  <div className="candidate-actions">
                                    <button className="primary-button" onClick={() => promoteAbstractRecord(record)} disabled={!deepDive.checked || deepDive.status === "promoting" || deepDive.status === "persisted"}>
                                      {deepDive.status === "promoting" ? "Writing typed records…" : deepDive.status === "persisted" ? "Accepted · pending full text" : "Promote checked results"}
                                    </button>
                                    {deepDive.status !== "persisted" && (
                                      <button className="cache-refresh-button" onClick={() => extractAbstractRecord(record, true)} disabled={deepDive.status === "extracting" || deepDive.status === "promoting"} title="Fetch the PubMed abstract and run the selected model again, replacing this reusable extraction.">
                                        Re-extract live
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </article>
                          );
                        })}
                        {run.response.records.length === 0 && (
                          <p className="no-discoveries">No records matched this exact query and filter set. Revise the query; do not infer that evidence is absent.</p>
                        )}
                      </div>
                    </section>
                  )}

                </div>
              )}
            </article>
          );
        })}
      </div>
      )}

      <section className="promotion-register" aria-labelledby="promotion-register-title">
        <header>
          <div><span>Persistent graph · Live promotions only</span><h2 id="promotion-register-title">What crossed a declared promotion policy.</h2></div>
          <strong>{promotionRecords.length} accepted result {promotionRecords.length === 1 ? "record" : "records"}</strong>
        </header>
        {promotionRecords.length > 0 ? (
          <div>
            {promotionRecords.map((record) => (
              <article key={record.result_id}>
                <div><span className={`relation-chip ${record.relation}`}>{record.relation}</span><small>{record.scope_match} scope · {record.verification_status}</small></div>
                <h3>{record.result_text}</h3>
                <p>{record.rationale}</p>
                <dl><div><dt>Source</dt><dd>{record.title} · PMID {record.pmid}</dd></div><div><dt>Evidence family</dt><dd>{record.family_label}</dd></div><div><dt>Status</dt><dd>{record.status}</dd></div></dl>
                <a href={record.source_url} target="_blank" rel="noreferrer">Open source ↗</a>
              </article>
            ))}
          </div>
        ) : (
          <p>No live discovery has crossed the gate in this case yet. Run a hosted full-paper cross-check, or explicitly inspect and promote an abstract-only fallback, to create the first provenance-bearing record.</p>
        )}
      </section>

      <section className="research-handoff">
        <div>
          <span>Promotion policy</span>
          <h2>Automation carries the routine attention. Humans inspect the cruxes.</h2>
          <p>Automatic promotion requires a hashed PMC artifact, two different model processes, full review coverage, an affirmative adversarial verdict, and a literal passage match. Rejections stay visible; “AI cross-checked” never masquerades as human verification.</p>
        </div>
        <Link className="primary-button" href={artifactHref}>Open live artifact</Link>
      </section>
    </>
  );
}
