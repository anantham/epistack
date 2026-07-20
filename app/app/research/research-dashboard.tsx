"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  knownSourceByPmid,
  laneAudit,
  researchCapabilities,
  researchLanes,
  verticalSliceAudit,
  type ResearchLane,
} from "../../data/eggs-investigation";
import { atomicResults, claimFrames as legacyClaimFrames } from "../../data/eggs-result-ledger";
import type { DeepDiveResponse } from "../../lib/deep-dive";
import type { DualReviewResponse } from "../../lib/dual-review";
import type { PublicationFilter, PubmedDiscovery, ResearchResponse } from "../../lib/research";
import { agentPromptStorageKey, sanitizeAgentPromptOverrides } from "../../lib/agent-prompts";
import {
  researchBriefSchema,
  researchBriefStorageKey,
  researchLanesFromBrief,
  type ResearchBrief,
  type ResearchClaimFrame,
} from "../../lib/research-brief";

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
  status: "checking" | "online" | "offline";
  models: { primary: string; adversary: string } | null;
  detail: string;
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
};

const dashboardCacheKey = "epistack:research-ui-cache:v2";
const localClaudeCompanionUrl = "http://127.0.0.1:4317";

function isDualReviewPayload(payload: DeepDiveResponse | DualReviewResponse): payload is DualReviewResponse {
  return payload.verificationStatus === "ai-cross-checked-full-text";
}

function defaultQueries(lanes: ResearchLane[] = researchLanes) {
  return Object.fromEntries(lanes.map((lane) => [lane.id, lane.defaultQuery])) as Record<string, string>;
}

function freshRuns(lanes: ResearchLane[] = researchLanes) {
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

function firstResultForSource(sourceId: string) {
  return atomicResults.find((result) => result.sourceId === sourceId)?.id;
}

function statusLabel(status: LaneRun["status"]) {
  if (status === "running") return "searching live";
  if (status === "complete") return "sweep complete";
  if (status === "error") return "needs retry";
  return "ready for human launch";
}

export function ResearchDashboard() {
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const activeLanes = useMemo(() => brief ? researchLanesFromBrief(brief) : researchLanes, [brief]);
  const [queries, setQueries] = useState<Record<string, string>>(defaultQueries);
  const [filters, setFilters] = useState<PublicationFilter[]>(["trials", "reviews"]);
  const [runs, setRuns] = useState<Record<string, LaneRun>>(freshRuns);
  const [deepDives, setDeepDives] = useState<Record<string, DeepDiveRun>>({});
  const [promotionRecords, setPromotionRecords] = useState<PromotionRecord[]>([]);
  const [openLane, setOpenLane] = useState<string>(researchLanes[0].id);
  const [storageReady, setStorageReady] = useState(false);
  const [companion, setCompanion] = useState<CompanionHealth>({ status: "checking", models: null, detail: "Checking the local Claude companion…" });

  const activeCount = useMemo(
    () => Object.values(runs).filter((run) => run.status === "running").length,
    [runs],
  );

  function currentCaseId() {
    if (brief?.caseId) return brief.caseId;
    try {
      const workspace = JSON.parse(window.localStorage.getItem("epistack:workspace:v1") || "{}") as { result?: { caseId?: string } | null };
      return workspace.result?.caseId || "eggs-live-mvp";
    } catch {
      return "eggs-live-mvp";
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
    try {
      return JSON.parse(window.localStorage.getItem("epistack:workspace:v1") || "{}") as {
        prompt?: string;
        decisionContext?: string;
        result?: { caseId?: string; decisionContext?: string } | null;
        compiledQuestion?: string;
      };
    } catch {
      return {};
    }
  }

  async function checkCompanion() {
    setCompanion((current) => ({ ...current, status: "checking", detail: "Checking the local Claude companion…" }));
    try {
      const response = await fetch(`${localClaudeCompanionUrl}/health`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; models?: { primary?: string; adversary?: string } };
      if (!response.ok || !payload.ok || !payload.models?.primary || !payload.models.adversary) throw new Error("Health check failed.");
      setCompanion({
        status: "online",
        models: { primary: payload.models.primary, adversary: payload.models.adversary },
        detail: "Full-text acquisition, dual-model review, and local run cache are ready.",
      });
    } catch {
      setCompanion({
        status: "offline",
        models: null,
        detail: "Start npm run agents in the app directory, then retry this check.",
      });
    }
  }

  async function loadPromotionRegister() {
    try {
      const response = await fetch(`/api/promote?caseId=${encodeURIComponent(currentCaseId())}`);
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
      const rawBrief = window.localStorage.getItem(researchBriefStorageKey);
      if (rawBrief) {
        const parsedBrief = researchBriefSchema.safeParse(JSON.parse(rawBrief));
        if (parsedBrief.success) loadedBrief = parsedBrief.data;
        else window.localStorage.removeItem(researchBriefStorageKey);
      }
      const lanes = loadedBrief ? researchLanesFromBrief(loadedBrief) : researchLanes;
      setBrief(loadedBrief);
      setQueries(defaultQueries(lanes));
      setRuns(freshRuns(lanes));
      setOpenLane(lanes[0]?.id ?? researchLanes[0].id);

      const raw = window.localStorage.getItem(dashboardCacheKey);
      if (!raw) return;
      const cached = JSON.parse(raw) as Partial<CachedDashboardState>;
      const briefId = loadedBrief?.briefId ?? "legacy-eggs-fixture";
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
  }, [brief?.caseId, storageReady]);

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
        briefId: brief?.briefId ?? "legacy-eggs-fixture",
        savedAt: new Date().toISOString(),
        queries,
        filters,
        runs: reusableRuns,
        deepDives: reusableDeepDives,
        openLane,
      };
      window.localStorage.setItem(dashboardCacheKey, JSON.stringify(cache));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeLanes, brief?.briefId, deepDives, filters, openLane, queries, runs, storageReady]);

  function clearDashboardCache() {
    window.localStorage.removeItem(dashboardCacheKey);
    setQueries(defaultQueries(activeLanes));
    setFilters(["trials", "reviews"]);
    setRuns(freshRuns(activeLanes));
    setDeepDives({});
    setOpenLane(activeLanes[0]?.id ?? researchLanes[0].id);
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
        body: JSON.stringify({ query: queries[lane.id], filters, maxResults: 6, refresh }),
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

  async function runAll() {
    // PubMed asks unauthenticated clients to stay below three requests/second.
    // Each lane performs a search and summary request, so run lanes in series.
    for (const lane of activeLanes) await runLane(lane);
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
    if (brief) return brief.claims;
    return legacyClaimFrames.map((claim, index) => ({
      ...claim,
      kind: index === 2 ? "mechanism" : index === 3 ? "harm" : "effectiveness",
      priority: index + 1,
      budgetShare: 25,
      decisionLeverage: "Legacy egg fixture claim retained until a human-edited ResearchBrief is compiled.",
      axisIds: ["legacy-eggs-fixture"],
      queryUsesAxisIds: ["legacy-eggs-fixture"],
      applicabilityUsesAxisIds: [],
      retrieval: {
        searchQuery: "egg breakfast randomized trial",
        inclusionRule: "Human comparative evidence with an explicit egg exposure and comparator.",
        exclusionSignals: ["No explicit egg exposure or comparison"],
        relaxationOrder: ["Broaden duration while preserving exposure, comparator, and outcome"],
      },
      applicabilityFields: ["population", "exposure", "comparator", "outcome", "time horizon"],
    } satisfies ResearchClaimFrame));
  }

  function applicabilityProfile() {
    if (!brief) return { summary: "Legacy egg fixture; no compiled stakeholder profile is available." };
    return {
      stakeholder: brief.stakeholderProfile,
      actionSpace: brief.actionSpace,
      applicabilityDimensions: brief.dimensionAssignments.filter((assignment) => assignment.role === "applicability-only"),
      monitoredUnknowns: brief.dimensionAssignments.filter((assignment) => assignment.role === "monitored-unknown"),
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
          applicabilityProfile: applicabilityProfile(),
          openRouterApiKey: preferences.apiKey,
          openRouterModel: preferences.model,
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
    setDeepDives((current) => ({
      ...current,
      [record.pmid]: { status: "acquiring", payload: null, checked: false, error: "", progress: "Contacting the local Claude companion", fallbackAvailable: false },
    }));
    try {
      const workspace = currentWorkspace();
      const response = await fetch(`${localClaudeCompanionUrl}/investigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record,
          question: workspace.prompt,
          decisionContext: workspace.decisionContext || workspace.result?.decisionContext,
          claimFrames: compiledClaimFrames(),
          applicabilityProfile: applicabilityProfile(),
          promptOverrides: promptOverrides(),
          refresh,
        }),
      });
      if (!response.ok || !response.body) throw new Error("The local Claude companion did not start the investigation stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let completed: DualReviewResponse | null = null;
      let companionError: { code?: string; message?: string } | null = null;
      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as {
          type?: string;
          phase?: DeepDiveRun["status"] | "cache-hit";
          label?: string;
          payload?: DualReviewResponse;
          code?: string;
          message?: string;
        };
        if (event.type === "status") {
          const status: DeepDiveRun["status"] = event.phase === "cache-hit" ? "adjudicating" : event.phase === "reviewing" ? "reviewing" : event.phase === "adjudicating" ? "adjudicating" : event.phase === "extracting" ? "extracting" : "acquiring";
          setDeepDives((current) => ({
            ...current,
            [record.pmid]: { status, payload: null, checked: false, error: "", progress: event.label || "Local agents are working", fallbackAvailable: false },
          }));
        } else if (event.type === "complete" && event.payload) {
          completed = event.payload;
        } else if (event.type === "error") {
          companionError = { code: event.code, message: event.message };
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        buffered += decoder.decode(value, { stream: !done });
        const lines = buffered.split("\n");
        buffered = lines.pop() || "";
        lines.forEach(consumeLine);
        if (done) break;
      }
      if (buffered.trim()) consumeLine(buffered);
      const finalCompanionError = companionError as { code?: string; message?: string } | null;
      if (finalCompanionError) throw Object.assign(new Error(finalCompanionError.message || "The local Claude investigation failed."), { code: finalCompanionError.code });
      if (!completed) throw new Error("The local Claude companion ended without a completed review.");
      await autoPromoteDualReview(record, completed);
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
      const offline = error instanceof TypeError && /fetch/i.test(error.message);
      if (offline) setCompanion({ status: "offline", models: null, detail: "Start npm run agents in the app directory, then retry this check." });
      setDeepDives((current) => ({
        ...current,
        [record.pmid]: {
          status: "error",
          payload: current[record.pmid]?.payload ?? null,
          checked: false,
          error: error instanceof Error ? error.message : "The full-paper investigation failed.",
          progress: "Full-paper run stopped",
          fallbackAvailable: code === "NO_OPEN_FULL_TEXT" || offline,
        },
      }));
    }
  }

  return (
    <>
      <header className="page-hero research-hero">
        <div>
          <div className="eyebrow">Investigation cockpit · {brief ? "Compiled research contract" : "Egg fixture fallback"}</div>
          <h1>Direct the search. Let independent agents do the first audit.</h1>
          <p className="lede">
            Each lane is traced to the human-edited scope, runs a real editable PubMed sweep, and keeps personal context local for applicability checks. A local Claude companion preserves full text, extracts atomic results, and attacks them with a different model.
          </p>
        </div>
        <button className="primary-button run-all" onClick={runAll} disabled={activeCount > 0}>
          {activeCount > 0 ? `${activeCount} lanes searching` : `Run all ${activeLanes.length} lanes`}
        </button>
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
          <strong>{brief ? `${brief.claims.length} compiled claims → live discovery → atomic results` : `${verticalSliceAudit.lanes} live queries → ${verticalSliceAudit.results} atomic result relationships`}</strong>
        </div>
        <p>
          Search rank is not evidential weight. A new record must be scoped, decomposed, checked, given an applicability-distance vector, and assigned to a justified dependence family before it can affect the decision.
        </p>
      </section>

      <section className={`local-companion-status ${companion.status}`} aria-label="Local Claude companion status">
        <div><i aria-hidden="true" /><span>{companion.status}</span></div>
        <p><strong>Local Claude companion</strong>{companion.models ? ` · ${companion.models.primary} extracts, ${companion.models.adversary} challenges` : ""}</p>
        <small>{companion.detail}</small>
        <button type="button" onClick={() => void checkCompanion()} disabled={companion.status === "checking"}>{companion.status === "checking" ? "Checking…" : "Check again"}</button>
      </section>

      <section className="capability-rail" aria-label="Investigation capability status">
        {researchCapabilities.map((capability) => (
          <article className={capability.status} key={capability.id}>
            <div><i aria-hidden="true" /><span>{capability.status}</span></div>
            <strong>{capability.label}</strong>
            <p>{capability.detail}</p>
          </article>
        ))}
      </section>

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
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="cache-controls">
          <p>Results reopen instantly on this browser. Shared operation outputs expire; accepted evidence records do not.</p>
          <button onClick={clearDashboardCache} title="Remove only this browser’s research display cache. The shared operation cache and accepted evidence graph are unchanged.">
            Reset browser cache
          </button>
        </div>
      </section>

      <div className="research-lanes">
        {activeLanes.map((lane, index) => {
          const run = runs[lane.id];
          const audit = laneAudit(lane);
          const expanded = openLane === lane.id;
          return (
            <article className={`research-lane ${run.status} ${expanded ? "expanded" : ""}`} key={lane.id}>
              <button className="lane-heading" onClick={() => setOpenLane(lane.id)} aria-expanded={expanded}>
                <span className="lane-number">0{index + 1}</span>
                <span>
                  <small>{statusLabel(run.status)}</small>
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
                    {lane.budgetShare && <div><span>Token budget</span><p>{lane.budgetShare}% of this investigation portfolio.</p></div>}
                    {lane.relaxationOrder?.length ? <div><span>Constraint relaxation</span><ol>{lane.relaxationOrder.map((step) => <li key={step}>{step}</li>)}</ol></div> : null}
                  </div>
                  <label className="query-editor">
                    <span>Editable PubMed query</span>
                    <textarea
                      value={queries[lane.id]}
                      onChange={(event) => setQueries((current) => ({ ...current, [lane.id]: event.target.value }))}
                      rows={3}
                    />
                  </label>
                  <div className="lane-actions">
                    <button className="primary-button" onClick={() => runLane(lane)} disabled={run.status === "running"}>
                      {run.status === "running" ? "Searching PubMed…" : "Run this lane"}
                    </button>
                    {run.response && (
                      <button className="cache-refresh-button" onClick={() => runLane(lane, true)} disabled={run.status === "running"} title="Bypass both cached operation output and the browser-restored display.">
                        Refresh live
                      </button>
                    )}
                    <span>{audit.resultCount > 0 ? `${audit.resultCount} reviewed results from ${audit.familyCount} independent families already anchor this lane.` : "No result is pre-promoted for this generated lane; discovery begins as leads, not evidence."}</span>
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
                          const known = knownSourceByPmid.get(record.pmid);
                          const resultId = known ? firstResultForSource(known.id) : undefined;
                          const deepDive = deepDives[record.pmid] ?? { status: "idle", payload: null, checked: false, error: "", progress: "", fallbackAvailable: false };
                          const dualPayload = deepDive.payload && isDualReviewPayload(deepDive.payload) ? deepDive.payload : null;
                          const abstractPayload = deepDive.payload && !isDualReviewPayload(deepDive.payload) ? deepDive.payload : null;
                          const agentBusy = ["acquiring", "extracting", "reviewing", "adjudicating", "promoting"].includes(deepDive.status);
                          const actionLabel = deepDive.status === "persisted"
                            ? "Persisted with provenance"
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
                            <article className={known ? "promoted" : "unreviewed"} key={record.pmid}>
                              <div className="record-status">
                                <span>{known ? "deep dive available" : "unreviewed lead"}</span>
                                <small>PMID {record.pmid}</small>
                              </div>
                              <h3>{record.title}</h3>
                              <p>{record.authors}</p>
                              <small>{record.journal} · {record.published}</small>
                              <footer>
                                {known && resultId && <Link href={`/evidence?result=${resultId}`}>Inspect atomic results <span aria-hidden="true">→</span></Link>}
                                <button onClick={() => investigateFullText(record)} disabled={agentBusy || deepDive.status === "persisted"}>{actionLabel}</button>
                                <a href={record.url} target="_blank" rel="noreferrer">Open PubMed ↗</a>
                              </footer>
                              {agentBusy && <div className="local-agent-progress"><i aria-hidden="true" /><span>{deepDive.progress}</span></div>}
                              {deepDive.error && (
                                <p className="deep-dive-error" role="alert">{deepDive.error} {deepDive.error.includes("bring-your-own") && <Link href="/">Open Settings on the Frame page.</Link>}</p>
                              )}
                              {deepDive.fallbackAvailable && (
                                <div className="candidate-actions fallback-actions">
                                  <button className="cache-refresh-button" onClick={() => void checkCompanion()}>Retry local companion</button>
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
                                      <em>{dualPayload.cache.status === "hit" ? "reused local agent cache" : dualPayload.cache.status === "bypass" ? "recomputed locally" : "fresh local run"}</em>
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
                                    <button className="cache-refresh-button" onClick={() => investigateFullText(record, true)} disabled={agentBusy}>Re-run both models</button>
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

                  <section className="reviewed-anchor">
                    <header><span>Already promoted into the canonical graph</span><strong>{audit.sourceCount} source containers · {audit.checkedCount} source-checked results</strong></header>
                    <div>
                      {lane.knownSourceIds.map((sourceId) => {
                        const knownSource = Array.from(knownSourceByPmid.values()).find((source) => source.id === sourceId);
                        const resultId = firstResultForSource(sourceId);
                        return knownSource && resultId ? (
                          <Link href={`/evidence?result=${resultId}`} key={sourceId}>
                            <span>{knownSource.sourceType} · {knownSource.year}</span>
                            <strong>{knownSource.title}</strong>
                            <small>Open result-level deep dive →</small>
                          </Link>
                        ) : null;
                      })}
                    </div>
                  </section>
                </div>
              )}
            </article>
          );
        })}
      </div>

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
          <p>No live discovery has crossed the gate in this case yet. The reviewed egg fixture remains separate; run a full-paper cross-check to create the first dual-model, provenance-bearing record.</p>
        )}
      </section>

      <section className="research-handoff">
        <div>
          <span>Promotion policy</span>
          <h2>Automation carries the routine attention. Humans inspect the cruxes.</h2>
          <p>Automatic promotion requires a hashed PMC artifact, two different model processes, full review coverage, an affirmative adversarial verdict, and a literal passage match. Rejections stay visible; “AI cross-checked” never masquerades as human verification.</p>
        </div>
        <Link className="primary-button" href="/evidence">Inspect promoted results</Link>
      </section>
    </>
  );
}
