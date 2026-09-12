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
import { sourceClassLabels, canPromoteSourceClass } from "../../lib/source-class";
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
  recallSelectedClaimIds?: string[];
};

const dashboardCacheKey = "epistack:research-ui-cache:v2";

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
  const [recallSelectedClaimIds, setRecallSelectedClaimIds] = useState<string[]>([]);
  const [recall, setRecall] = useState<RecallRun>({
    status: "idle",
    response: null,
    error: "",
    progress: "Choose the claims that deserve broad and applicability-specific recall.",
    liveTrace: [],
  });
  const [storageReady, setStorageReady] = useState(false);
  const [companion, setCompanion] = useState<CompanionHealth>({ status: "checking", models: null, detail: "Checking the local Claude companion…" });

  const activeCount = useMemo(
    () => Object.values(runs).filter((run) => run.status === "running").length,
    [runs],
  );

  function currentCaseId() {
    return caseId || brief?.caseId || "";
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
      status: "online",
      models: { primary: "Astra · GPT 6", adversary: "Astra · adversarial reviewer" },
      detail: "Lead discovery, full-text extraction, adversarial review, and synthesis run on Astra.",
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
      setRecallSelectedClaimIds(loadedBrief?.claims.map((claim) => claim.id) ?? []);

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
      if (loadedBrief && Array.isArray(cached.recallSelectedClaimIds)) {
        const allowed = new Set(loadedBrief.claims.map((claim) => claim.id));
        const restoredSelection = cached.recallSelectedClaimIds.filter((id): id is string => typeof id === "string" && allowed.has(id));
        if (restoredSelection.length) setRecallSelectedClaimIds(restoredSelection);
      }
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
        recallSelectedClaimIds,
      };
      window.localStorage.setItem(dashboardCacheKey, JSON.stringify(cache));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeLanes, brief?.briefId, deepDives, filters, openLane, queries, recall.response, recallSelectedClaimIds, runs, storageReady]);

  function clearDashboardCache() {
    window.localStorage.removeItem(dashboardCacheKey);
    setQueries(defaultQueries(activeLanes));
    setFilters(["trials", "reviews"]);
    setRuns(freshRuns(activeLanes));
    setDeepDives({});
    setOpenLane(activeLanes[0]?.id ?? "");
    setRecallSelectedClaimIds(brief?.claims.map((claim) => claim.id) ?? []);
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

  function toggleRecallClaim(claimId: string) {
    setRecallSelectedClaimIds((current) =>
      current.includes(claimId)
        ? current.filter((candidate) => candidate !== claimId)
        : [...current, claimId]);
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
    const selectedClaims = brief.claims.filter((claim) => recallSelectedClaimIds.includes(claim.id));
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
    if (!brief || recallSelectedClaimIds.length === 0) {
      setRecall((current) => ({
        ...current,
        status: "error",
        error: brief ? "Select at least one scoped claim." : "Compile a research brief before launching broad recall.",
      }));
      return;
    }
    const claims = brief.claims
      .filter((claim) => recallSelectedClaimIds.includes(claim.id))
      .map((claim) => ({
        id: claim.id,
        statement: claim.statement,
        population: claim.population,
        exposure: claim.exposure,
        comparator: claim.comparator,
        outcome: claim.outcome,
        timeHorizon: claim.timeHorizon,
        decisionLeverage: claim.decisionLeverage,
        applicabilityFields: claim.applicabilityFields,
        retrieval: claim.retrieval,
      }));
    setRecall({
      status: "running",
      response: refresh ? recall.response : null,
      error: "",
      progress: "Launching broad-recall and applicability specialists in parallel…",
      liveTrace: [],
    });
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
        }),
      });
      const payload = await response.json() as RecallResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The hosted lead-discovery sweep failed.");
      setRecall({
        status: "complete",
        response: payload,
        error: "",
        progress: `${payload.leads.length} lead-only records returned across two search lanes.`,
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

  function adoptRecallQuery(lead: RecallResponse["leads"][number]) {
    const laneId = lead.claimIds.find((claimId) => activeLanes.some((lane) => lane.id === claimId));
    if (!laneId) return;
    setQueries((current) => ({ ...current, [laneId]: lead.discovery.reportedQuery }));
    setOpenLane(laneId);
    document.querySelector(".research-lanes")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      [record.pmid]: { status: "reviewing", payload: null, checked: false, error: "", progress: "Acquiring and cross-checking the full paper on Astra", fallbackAvailable: false },
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
        }),
      });
      const completed = await response.json() as DualReviewResponse & { error?: string; code?: string };
      if (!response.ok || completed.error) {
        throw Object.assign(new Error(completed.error || "The hosted full-text investigation failed."), { code: completed.code });
      }
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

  const localAgentControlsAvailable = companion.status === "online";
  const artifactHref = caseId ? `/artifact?caseId=${encodeURIComponent(caseId)}` : "/artifact";

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
            Each lane is traced to the human-edited scope, runs a real editable PubMed sweep, and keeps personal context local for applicability checks. A local Claude companion preserves full text, extracts atomic results, and attacks them with a different model.
          </p>
        </div>
        <button className="primary-button run-all" onClick={runAll} disabled={activeCount > 0 || activeLanes.length === 0}>
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
          <strong>{brief.claims.length} compiled claims → live discovery → atomic results</strong>
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

      <section className="recall-cockpit" aria-labelledby="recall-cockpit-title">
        <header>
          <div>
            <span>Recall layer · Lead-only</span>
            <h2 id="recall-cockpit-title">Search beyond the obvious corpus without weakening the evidence gate.</h2>
            <p>One specialist looks broadly for direct, negative, corrective, and boundary-setting sources. Another searches for transportability to the shareable parts of this action context. Neither can promote a claim.</p>
          </div>
          <div className="recall-launch">
            <button
              className="primary-button"
              onClick={() => void runRecall(false)}
              disabled={!localAgentControlsAvailable || recallSelectedClaimIds.length === 0 || recall.status === "running"}
              title={localAgentControlsAvailable ? "Launch both local recall agents." : companion.detail}
            >
              {recall.status === "running" ? "Agents searching…" : "Launch both agents"}
            </button>
            {recall.response && (
              <button className="cache-refresh-button" onClick={() => void runRecall(true)} disabled={!localAgentControlsAvailable || recall.status === "running"}>
                Bypass local cache
              </button>
            )}
          </div>
        </header>

        <div className="recall-focus">
          <div>
            <span>Spend recall tokens on</span>
            <small>Multi-select · the agent receives only these claim frames</small>
          </div>
          <div className="recall-claim-pills">
            {brief?.claims.map((claim) => (
              <button
                className={recallSelectedClaimIds.includes(claim.id) ? "active" : ""}
                key={claim.id}
                onClick={() => toggleRecallClaim(claim.id)}
                aria-pressed={recallSelectedClaimIds.includes(claim.id)}
                title={claim.statement}
              >
                {claim.shortLabel}
              </button>
            ))}
            {brief && (
              <button
                className="recall-select-all"
                onClick={() => setRecallSelectedClaimIds(
                  recallSelectedClaimIds.length === brief.claims.length ? [] : brief.claims.map((claim) => claim.id),
                )}
              >
                {recallSelectedClaimIds.length === brief.claims.length ? "clear all" : "select all"}
              </button>
            )}
          </div>
        </div>

        <div className={`recall-progress ${recall.status}`}>
          <i aria-hidden="true" />
          <span>{recall.error || recall.progress}</span>
          {recall.response && <small>{recall.response.cache.status === "hit" ? "exact local run reused" : recall.response.cache.status === "bypass" ? "recomputed live" : "fresh local run"} · {recall.response.model}</small>}
        </div>

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
                <p>No tool invocation inputs were visible in the Claude stream; reported queries must be treated as model-authored.</p>
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
                    {leads.map((lead) => (
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
                          <button onClick={() => adoptRecallQuery(lead)}>Use query in PubMed lane</button>
                        </footer>
                      </article>
                    ))}
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
          const expanded = openLane === lane.id;
          return (
            <article className={`research-lane ${run.status} ${expanded ? "expanded" : ""}`} key={lane.id}>
              <button className="lane-heading" onClick={() => setOpenLane((current) => current === lane.id ? "" : lane.id)} aria-expanded={expanded}>
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
                    <span>Discovery begins as leads. Only case-scoped records that cross the declared promotion policy appear in the live artifact.</span>
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
                              ? "Run locally for full text"
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
                                  title={localAgentControlsAvailable ? "Acquire and cross-check the full paper with the local companion." : companion.detail}
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
          <p>No live discovery has crossed the gate in this case yet. Run a local full-paper cross-check, or explicitly inspect and promote an abstract-only fallback, to create the first provenance-bearing record.</p>
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
