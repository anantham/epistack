"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { sourceClassLabels, type SourceClass } from "../../lib/source-class";
import type { Divergence, DivergenceItem } from "../../lib/source-divergence";
import {
  researchBriefSchema,
  researchBriefStorageKey,
  type ResearchBrief,
} from "../../lib/research-brief";

type SourceMetadata = {
  sourceClass?: string;
  epistemicRole?: string;
  acquisition?: string;
};

type ArtifactSource = {
  id: string;
  title: string;
  canonicalUrl: string | null;
  doi: string | null;
  pmid: string | null;
  publisher: string | null;
  issuedAt: string | null;
  sourceType: string;
  contentHash: string | null;
};

type ArtifactFamily = {
  id: string;
  label: string;
  reason: string;
  dependsOn: string[];
};

type ArtifactRelation = SourceMetadata & {
  id: string;
  resultId: string;
  claimFrameId: string;
  relation: string;
  scopeMatch: string;
  rationale: string;
  assessor: string;
  status: string;
  acceptedAt: string;
  result: {
    id: string;
    resultRole: string;
    resultText: string;
    estimate: string | null;
    locator: string;
    excerpt: string | null;
    verificationStatus: string;
    analysisLabel: string;
    analysisType: string;
    population: string | null;
    exposure: string | null;
    comparator: string | null;
    outcome: string | null;
    timeHorizon: string | null;
  };
  source: ArtifactSource;
  family: ArtifactFamily;
};

type ArtifactClaim = {
  id: string;
  statement: string;
  population: string | null;
  exposure: string | null;
  comparator: string | null;
  outcome: string | null;
  timeHorizon: string | null;
  modality: string;
  status: string;
  relations: ArtifactRelation[];
};

type ArtifactResponse = {
  caseId: string;
  generatedAt: string;
  case: {
    id: string;
    title: string;
    originalPrompt: string;
    activeQuestion: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  claims: ArtifactClaim[];
  orphanRelations: ArtifactRelation[];
  divergenceItems: DivergenceItem[];
  counts: {
    claims: number;
    resultRelations: number;
    sources: number;
    dependenceFamilies: number;
    fullTextVerified: number;
  };
  freshness: {
    latestEvidenceAt: string | null;
    graphUpdatedAt: string | null;
    stale: boolean;
    reasons: string[];
  };
  statusLabel: string;
  integrityWarnings: string[];
  unavailable?: boolean;
  error?: string;
};

type LoadState =
  | { status: "loading"; artifact: null; detail: string }
  | { status: "ready"; artifact: ArtifactResponse; detail: string }
  | { status: "unavailable"; artifact: null; detail: string }
  | { status: "error"; artifact: null; detail: string };

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function field(row: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return null;
}

function textField(row: JsonRecord, ...keys: string[]) {
  const value = field(row, ...keys);
  return typeof value === "string" ? value : value === null ? null : String(value);
}

function sourceMetadata(...rows: JsonRecord[]): SourceMetadata {
  const value = (camel: string, snake: string) => rows
    .map((row) => field(row, camel, snake))
    .find((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()));
  return {
    sourceClass: value("sourceClass", "source_class"),
    epistemicRole: value("epistemicRole", "epistemic_role"),
    acquisition: value("acquisition", "acquisition"),
  };
}

function SourceBadges({ item }: { item: SourceMetadata }) {
  if (!item.sourceClass && !item.epistemicRole && !item.acquisition) return null;
  return (
    <span className="live-relation-summary" aria-label="Source metadata">
      {item.sourceClass && (
        <span className="live-relation-tag">
          {Object.hasOwn(sourceClassLabels, item.sourceClass)
            ? sourceClassLabels[item.sourceClass as SourceClass]
            : item.sourceClass}
        </span>
      )}
      {item.epistemicRole && <span className="live-relation-tag">{item.epistemicRole}</span>}
      {item.acquisition && <span className="live-relation-tag">{item.acquisition}</span>}
    </span>
  );
}

function SourceDivergencePanel({ items }: { items: DivergenceItem[] }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [divergences, setDivergences] = useState<Divergence[] | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function checkDivergence() {
    if (request.current || items.length < 2) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    setDivergences(null);
    try {
      const response = await fetch("/api/divergence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
        signal: controller.signal,
      });
      const payload = record(await response.json());
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "The divergence comparison failed.");
      }
      if (!Array.isArray(payload.divergences) || !payload.divergences.every((value) => {
        const entry = record(value);
        return typeof entry.aId === "string" && typeof entry.bId === "string"
          && typeof entry.rationale === "string"
          && ["same", "partial", "different"].includes(String(entry.scopeMatch))
          && ["contradicts", "differs-by-scope", "consistent", "indeterminate"].includes(String(entry.verdict));
      })) {
        throw new Error("The divergence service returned an unreadable response.");
      }
      setDivergences(payload.divergences as Divergence[]);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "The divergence comparison failed.");
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <section className="live-artifact-options" aria-labelledby="source-divergence-title">
      <header>
        <span>Context only · Never causal evidence</span>
        <h2 id="source-divergence-title">Source divergence</h2>
        <p>Compare scoped source statements. These comparisons do not change accepted evidence or claim coverage.</p>
      </header>
      {items.length < 2 ? (
        <small>Need at least two scoped normative/descriptive sources to compare.</small>
      ) : (
        <>
          <div>
            <article>
              <button className="primary-button" type="button" disabled={loading} onClick={() => void checkDivergence()}>
                {loading ? "Checking divergence…" : "Check divergence"}
              </button>
              <p role="status">{loading ? "Comparing source statements…" : `${items.length} scoped items available.`}</p>
              {error && <p role="alert">{error}</p>}
            </article>
          </div>
          {divergences !== null && (
            <div aria-live="polite">
              {divergences.length === 0 ? <article><p>No divergences were returned.</p></article> : divergences.map((entry, index) => (
                <article key={`${entry.aId}-${entry.bId}-${index}`}>
                  <span>Context · Never causal evidence</span>
                  <strong>{entry.aId} ↔ {entry.bId}</strong>
                  <p>Scope match: {entry.scopeMatch} · Verdict: {entry.verdict}</p>
                  <p>{entry.rationale}</p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function parseJsonRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

function description(value: unknown) {
  const parsed = parseJsonRecord(value);
  return textField(parsed, "description", "label", "value");
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readable(value: string | null | undefined) {
  if (!value) return "not recorded";
  return value.replaceAll("-", " ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "No accepted evidence yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function relationCounts(relations: ArtifactRelation[]) {
  return relations.reduce<Record<string, number>>((counts, relation) => {
    counts[relation.relation] = (counts[relation.relation] ?? 0) + 1;
    return counts;
  }, {});
}

function getStoredBrief(): ResearchBrief | null {
  try {
    const raw = window.localStorage.getItem(researchBriefStorageKey);
    if (!raw) return null;
    const parsed = researchBriefSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function getWorkspaceCaseId() {
  try {
    const workspace = JSON.parse(window.localStorage.getItem("epistack:workspace:v1") || "{}") as {
      result?: { caseId?: string } | null;
    };
    return workspace.result?.caseId || null;
  } catch {
    return null;
  }
}

function initialArtifactSession() {
  if (typeof window === "undefined") return { brief: null as ResearchBrief | null, caseId: "" };
  const storedBrief = getStoredBrief();
  const queryCaseId = new URLSearchParams(window.location.search).get("caseId");
  const caseId = queryCaseId || storedBrief?.caseId || getWorkspaceCaseId() || "";
  return {
    brief: storedBrief?.caseId === caseId ? storedBrief : null,
    caseId,
  };
}

function normalizeArtifactResponse(payload: unknown): ArtifactResponse | null {
  const candidate = record(payload);
  const caseId = textField(candidate, "caseId");
  const contractVersion = textField(candidate, "contractVersion");
  if (!caseId || contractVersion !== "live-artifact.v1") return null;

  const graph = record(candidate.graph);
  const rawClaims = records(field(graph, "claimFrames", "claim_frames"));
  const rawSources = records(graph.sources);
  const rawStudies = records(graph.studies);
  const rawAnalyses = records(graph.analyses);
  const rawResults = records(graph.results);
  const rawRelations = records(field(graph, "evidenceRelations", "evidence_relations"));
  const rawFamilies = records(field(graph, "dependenceGroups", "dependence_groups"));
  const byId = (rows: JsonRecord[]) => new Map(rows.map((row) => [textField(row, "id") || "", row]));
  const sourceById = byId(rawSources);
  const studyById = byId(rawStudies);
  const analysisById = byId(rawAnalyses);
  const resultById = byId(rawResults);
  const familyById = byId(rawFamilies);

  const normalizeRelation = (rawRelation: JsonRecord): ArtifactRelation | null => {
    const resultId = textField(rawRelation, "resultId", "result_id");
    const claimFrameId = textField(rawRelation, "claimFrameId", "claim_frame_id");
    const rawResult = resultId ? resultById.get(resultId) : null;
    if (!resultId || !claimFrameId || !rawResult) return null;
    const analysisId = textField(rawResult, "analysisId", "analysis_id");
    const rawAnalysis = analysisId ? analysisById.get(analysisId) : null;
    const studyId = rawAnalysis ? textField(rawAnalysis, "studyId", "study_id") : null;
    const rawStudy = studyId ? studyById.get(studyId) : null;
    const sourceId = rawStudy ? textField(rawStudy, "sourceId", "source_id") : null;
    const rawSource = sourceId ? sourceById.get(sourceId) : null;
    const familyId = textField(rawResult, "dependenceGroupId", "dependence_group_id");
    const rawFamily = familyId ? familyById.get(familyId) : null;
    const estimate = parseJsonRecord(field(rawResult, "estimate", "estimateJson", "estimate_json"));

    return {
      ...sourceMetadata(rawRelation, rawResult, rawSource ?? {}),
      id: textField(rawRelation, "id") || `${claimFrameId}-${resultId}`,
      resultId,
      claimFrameId,
      relation: textField(rawRelation, "relation") || "not-informative",
      scopeMatch: textField(rawRelation, "scopeMatch", "scope_match") || "unknown",
      rationale: textField(rawRelation, "rationale") || "No relationship rationale was recorded.",
      assessor: textField(rawRelation, "assessor") || "unspecified assessor",
      status: textField(rawRelation, "status") || "accepted",
      acceptedAt: textField(rawRelation, "createdAt", "created_at") || "",
      result: {
        id: resultId,
        resultRole: textField(rawResult, "resultRole", "result_role") || "unspecified",
        resultText: textField(rawResult, "resultText", "result_text") || "Result text not recorded.",
        estimate: textField(estimate, "display", "estimate") || null,
        locator: textField(rawResult, "locator") || "",
        excerpt: textField(rawResult, "excerpt"),
        verificationStatus: textField(rawResult, "verificationStatus", "verification_status") || "unverified",
        analysisLabel: rawAnalysis ? textField(rawAnalysis, "label") || "Unlabelled analysis" : "Unlinked analysis",
        analysisType: rawAnalysis ? textField(rawAnalysis, "analysisType", "analysis_type") || "unspecified" : "unlinked",
        population: rawAnalysis ? description(field(rawAnalysis, "population", "populationJson", "population_json")) : null,
        exposure: rawAnalysis ? description(field(rawAnalysis, "exposure", "exposureJson", "exposure_json")) : null,
        comparator: rawAnalysis ? description(field(rawAnalysis, "comparator", "comparatorJson", "comparator_json")) : null,
        outcome: rawAnalysis ? description(field(rawAnalysis, "outcome", "outcomeJson", "outcome_json")) : null,
        timeHorizon: rawAnalysis ? textField(rawAnalysis, "timeHorizon", "time_horizon") : null,
      },
      source: {
        id: sourceId || "unlinked-source",
        title: rawSource ? textField(rawSource, "title") || "Untitled source" : "Unlinked source",
        canonicalUrl: rawSource ? textField(rawSource, "canonicalUrl", "canonical_url") : null,
        doi: rawSource ? textField(rawSource, "doi") : null,
        pmid: rawSource ? textField(rawSource, "pmid") : null,
        publisher: rawSource ? textField(rawSource, "publisher") : null,
        issuedAt: rawSource ? textField(rawSource, "issuedAt", "issued_at") : null,
        sourceType: rawSource ? textField(rawSource, "sourceType", "source_type") || "unspecified source" : "unlinked source",
        contentHash: rawSource ? textField(rawSource, "contentHash", "content_hash") : null,
      },
      family: {
        id: familyId || "unlinked-family",
        label: rawFamily ? textField(rawFamily, "label") || "Unlabelled family" : "Unlinked dependence family",
        reason: rawFamily ? textField(rawFamily, "reason") || "No dependence rationale recorded." : "This result has no readable dependence-family record.",
        dependsOn: rawFamily ? stringArray(field(rawFamily, "dependsOnJson", "depends_on_json", "dependsOn")) : [],
      },
    };
  };

  const normalizedRelations = rawRelations.map(normalizeRelation).filter((relation): relation is ArtifactRelation => relation !== null);
  const relationByClaim = new Map<string, ArtifactRelation[]>();
  for (const relation of normalizedRelations) {
    relationByClaim.set(relation.claimFrameId, [...(relationByClaim.get(relation.claimFrameId) ?? []), relation]);
  }
  const claims = rawClaims.map((rawClaim, claimIndex): ArtifactClaim => {
    const id = textField(rawClaim, "id") || `unidentified-claim-${claimIndex + 1}`;
    return {
      id,
      statement: textField(rawClaim, "statement") || "Claim statement not recorded.",
      population: description(field(rawClaim, "population", "populationJson", "population_json")),
      exposure: description(field(rawClaim, "exposure", "exposureJson", "exposure_json")),
      comparator: description(field(rawClaim, "comparator", "comparatorJson", "comparator_json")),
      outcome: description(field(rawClaim, "outcome", "outcomeJson", "outcome_json")),
      timeHorizon: textField(rawClaim, "timeHorizon", "time_horizon"),
      modality: textField(rawClaim, "modality") || "unspecified",
      status: textField(rawClaim, "status") || "active",
      relations: relationByClaim.get(id) ?? [],
    };
  });
  const representedRelationIds = new Set(claims.flatMap((claim) => claim.relations.map((relation) => relation.id)));
  const counts = record(candidate.counts);
  const verificationStatuses = record(field(counts, "verificationStatuses", "verification_statuses"));
  const status = record(candidate.status);
  const latestDecision = record(candidate.latestDecision);
  const apiCase = record(candidate.case);

  const divergenceItems: DivergenceItem[] = [];
  const comparisonIds = new Set<string>();
  for (const item of [...rawSources, ...rawResults, ...rawRelations]) {
    const id = textField(item, "id");
    const statement = textField(item, "statement")?.trim() || textField(item, "resultText", "result_text")?.trim();
    const scope = parseJsonRecord(field(item, "comparisonScope", "comparison_scope"));
    const relation = normalizedRelations.find((entry) => entry.resultId === id || entry.id === id);
    const sourceClass = sourceMetadata(item).sourceClass || relation?.sourceClass;
    if (!id || !statement || !sourceClass || comparisonIds.has(id)
      || typeof scope.topic !== "string" || !scope.topic.trim()
      || typeof scope.population !== "string" || !scope.population.trim()
      || typeof scope.jurisdiction !== "string" || !scope.jurisdiction.trim()) continue;
    comparisonIds.add(id);
    divergenceItems.push({
      id,
      sourceClass,
      statement,
      comparisonScope: {
        topic: scope.topic,
        population: scope.population,
        jurisdiction: scope.jurisdiction,
        ...(typeof scope.effectiveFrom === "string" ? { effectiveFrom: scope.effectiveFrom } : {}),
        ...(typeof scope.effectiveTo === "string" ? { effectiveTo: scope.effectiveTo } : {}),
      },
    });
  }

  return {
    caseId,
    divergenceItems,
    generatedAt: textField(candidate, "generatedAt") || new Date().toISOString(),
    case: Object.keys(apiCase).length ? {
      id: textField(apiCase, "id") || caseId,
      title: textField(apiCase, "title") || "Epistack investigation",
      originalPrompt: textField(apiCase, "originalPrompt", "original_prompt") || "",
      activeQuestion: textField(apiCase, "activeQuestion", "active_question"),
      status: textField(apiCase, "status") || "framing",
      createdAt: textField(apiCase, "createdAt", "created_at") || "",
      updatedAt: textField(apiCase, "updatedAt", "updated_at") || "",
    } : null,
    claims,
    orphanRelations: normalizedRelations.filter((relation) => !representedRelationIds.has(relation.id)),
    counts: {
      claims: Number(field(counts, "claimFrames", "claim_frames") ?? claims.length),
      resultRelations: Number(field(counts, "evidenceRelations", "evidence_relations") ?? normalizedRelations.length),
      sources: Number(counts.sources ?? rawSources.length),
      dependenceFamilies: Number(field(counts, "dependenceGroups", "dependence_groups") ?? rawFamilies.length),
      fullTextVerified: Object.entries(verificationStatuses).reduce((sum, [key, value]) =>
        key.includes("full-text") ? sum + Number(value ?? 0) : sum, 0),
    },
    freshness: {
      latestEvidenceAt: textField(candidate, "latestEvidenceAt"),
      graphUpdatedAt: textField(apiCase, "updatedAt", "updated_at"),
      stale: field(status, "phase") === "stale"
        || field(status, "isStale", "is_stale") === true
        || field(latestDecision, "isStale", "is_stale") === true,
      reasons: unique([
        ...stringArray(status.reasons),
        ...stringArray(field(latestDecision, "staleReasons", "stale_reasons")),
      ]),
    },
    statusLabel: textField(status, "label") || "Live accepted evidence",
    integrityWarnings: stringArray(candidate.integrityWarnings),
  };
}

export function ArtifactWorkspace() {
  const [session, setSession] = useState<ReturnType<typeof initialArtifactSession> | null>(null);
  const brief = session?.brief ?? null;
  const caseId = session?.caseId ?? "";
  const [load, setLoad] = useState<LoadState>({
    status: "loading",
    artifact: null,
    detail: "Loading the accepted result graph…",
  });
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSession(initialArtifactSession()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const refresh = () => setRefreshNonce((current) => current + 1);
    window.addEventListener("epistack:refresh-artifact", refresh);
    return () => window.removeEventListener("epistack:refresh-artifact", refresh);
  }, []);

  useEffect(() => {
    if (!caseId) return;
    const controller = new AbortController();

    async function loadArtifact() {
      setLoad({ status: "loading", artifact: null, detail: "Loading the accepted result graph…" });
      try {
        const response = await fetch(`/api/artifact?caseId=${encodeURIComponent(caseId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as unknown;
        if (response.status === 503 || (payload && typeof payload === "object" && (payload as { unavailable?: boolean }).unavailable)) {
          const rawError = payload && typeof payload === "object" ? (payload as { error?: unknown }).error : null;
          const detail = typeof rawError === "string"
            ? rawError
            : rawError && typeof rawError === "object" && typeof (rawError as { message?: unknown }).message === "string"
              ? (rawError as { message: string }).message
              : "The persistent evidence store is not available in this environment.";
          setLoad({ status: "unavailable", artifact: null, detail });
          return;
        }
        if (!response.ok) {
          const rawError = payload && typeof payload === "object" ? (payload as { error?: unknown }).error : null;
          const message = typeof rawError === "string"
            ? rawError
            : rawError && typeof rawError === "object" && typeof (rawError as { message?: unknown }).message === "string"
              ? (rawError as { message: string }).message
              : "The live artifact could not be loaded.";
          throw new Error(message);
        }
        const artifact = normalizeArtifactResponse(payload);
        if (!artifact) throw new Error("The evidence store returned an artifact this interface cannot read.");
        setLoad({ status: "ready", artifact, detail: "" });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoad({
          status: "error",
          artifact: null,
          detail: error instanceof Error ? error.message : "The live artifact could not be loaded.",
        });
      }
    }

    void loadArtifact();
    return () => controller.abort();
  }, [caseId, refreshNonce]);

  const artifact = load.artifact;
  const apiClaimsByBriefId = useMemo(() => {
    const byId = new Map<string, ArtifactClaim>();
    for (const claim of artifact?.claims ?? []) {
      byId.set(claim.id, claim);
      const localId = claim.id.startsWith(`${caseId}-`) ? claim.id.slice(caseId.length + 1) : claim.id;
      byId.set(localId, claim);
    }
    return byId;
  }, [artifact?.claims, caseId]);

  const visibleClaims = useMemo(() => {
    if (!brief) return artifact?.claims ?? [];
    const compiled = brief.claims.map((claim) => {
      const stored = apiClaimsByBriefId.get(claim.id);
      return stored ?? {
        id: claim.id,
        statement: claim.statement,
        population: claim.population,
        exposure: claim.exposure,
        comparator: claim.comparator,
        outcome: claim.outcome,
        timeHorizon: claim.timeHorizon,
        modality: claim.modality,
        status: "compiled-uncovered",
        relations: [],
      };
    });
    const compiledIds = new Set(compiled.flatMap((claim) => [
      claim.id,
      claim.id.startsWith(`${caseId}-`) ? claim.id.slice(caseId.length + 1) : `${caseId}-${claim.id}`,
    ]));
    return [
      ...compiled,
      ...(artifact?.claims ?? []).filter((claim) => !compiledIds.has(claim.id)),
    ];
  }, [apiClaimsByBriefId, artifact?.claims, brief, caseId]);

  const acceptedRelations = visibleClaims.flatMap((claim) => claim.relations);
  const uncoveredClaims = visibleClaims.filter((claim) => claim.relations.length === 0);
  const actionOptions = brief?.actionSpace.options ?? [];
  const allSources = unique(acceptedRelations.map((relation) => relation.source.id));
  const allFamilies = unique(acceptedRelations.map((relation) => relation.family.id));
  const fullTextCount = acceptedRelations.filter((relation) =>
    relation.result.verificationStatus.includes("full-text"),
  ).length;
  const counts = artifact?.counts ?? {
    claims: visibleClaims.length,
    resultRelations: acceptedRelations.length,
    sources: allSources.length,
    dependenceFamilies: allFamilies.length,
    fullTextVerified: fullTextCount,
  };
  const question = brief?.compiledQuestion
    || artifact?.case?.activeQuestion
    || artifact?.case?.originalPrompt
    || "This investigation";
  const researchHref = caseId ? `/research?caseId=${encodeURIComponent(caseId)}` : "/research";
  const synthesisHref = caseId ? `/synthesis?caseId=${encodeURIComponent(caseId)}` : "/synthesis";

  if (!session) {
    return (
      <section className="live-artifact-state" aria-live="polite">
        <span className="live-artifact-pulse" aria-hidden="true" />
        <div>
          <strong>Resolving the active investigation…</strong>
          <p>Epistack will not substitute a demonstration case.</p>
        </div>
      </section>
    );
  }

  if (!caseId) {
    return (
      <section className="live-artifact-state live-artifact-state-problem">
        <span aria-hidden="true">○</span>
        <div>
          <div className="eyebrow">No active case</div>
          <h1>Start with a question before opening an artifact.</h1>
          <p>No case identity was found in the URL or this browser. Epistack will not substitute a demonstration case.</p>
          <Link className="primary-button" href="/">Start with a question</Link>
        </div>
      </section>
    );
  }

  if (load.status === "loading") {
    return (
      <section className="live-artifact-state" aria-live="polite">
        <span className="live-artifact-pulse" aria-hidden="true" />
        <div>
          <strong>{load.detail}</strong>
          <p>The artifact only counts evidence that crossed the promotion boundary.</p>
        </div>
      </section>
    );
  }

  if (load.status === "unavailable" || load.status === "error") {
    return (
      <section className="live-artifact-state live-artifact-state-problem">
        <span aria-hidden="true">{load.status === "unavailable" ? "○" : "!"}</span>
        <div>
          <div className="eyebrow">{load.status === "unavailable" ? "Evidence store unavailable" : "Artifact could not load"}</div>
          <h1>Your framing is still safe.</h1>
          <p>{load.detail}</p>
          <p>This view never substitutes fixture evidence when the live store is missing. Return to research to inspect or promote results.</p>
          <Link className="primary-button" href={researchHref}>Return to research</Link>
        </div>
      </section>
    );
  }

  const noAcceptedEvidence = acceptedRelations.length === 0;

  return (
    <>
      <header className="live-artifact-hero">
        <div>
          <div className="eyebrow">Live artifact · Accepted evidence only</div>
          <h1>{question}</h1>
          <p>
            This is a navigable record of what crossed the evidence gate, what each result bears on,
            and which parts of the compiled question remain uncovered.
          </p>
        </div>
        <div className="live-artifact-actions">
          <Link href={researchHref}>Continue research</Link>
          <Link href={synthesisHref}>Open decision workbench <span aria-hidden="true">→</span></Link>
        </div>
      </header>

      <section className="live-artifact-meta" aria-label="Artifact evidence status">
        <div>
          <span>Accepted claim–result links</span>
          <b>{counts.resultRelations}</b>
        </div>
        <div>
          <span>Distinct source records</span>
          <b>{counts.sources}</b>
        </div>
        <div>
          <span>Dependence groups</span>
          <b>{counts.dependenceFamilies}</b>
        </div>
        <div>
          <span>Accepted links with full-text review</span>
          <b>{counts.fullTextVerified}</b>
        </div>
        <div className={`live-artifact-freshness ${artifact?.freshness.stale ? "is-stale" : ""}`}>
          <span>{artifact?.freshness.stale ? "Decision freshness" : "Artifact status"}</span>
          <strong>{artifact?.statusLabel}</strong>
          <small>Latest accepted evidence: {formatDate(artifact?.freshness.latestEvidenceAt)}</small>
          {artifact?.freshness.reasons.length ? <small>{artifact.freshness.reasons.join(" ")}</small> : null}
        </div>
      </section>

      {artifact?.integrityWarnings.length ? (
        <section className="live-artifact-integrity" aria-label="Stored-data integrity warnings">
          <span>Degraded artifact</span>
          <strong>{artifact.integrityWarnings.length} stored-data {artifact.integrityWarnings.length === 1 ? "warning needs" : "warnings need"} review.</strong>
          <details>
            <summary>Inspect warnings</summary>
            <ul>{artifact.integrityWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </details>
        </section>
      ) : null}

      {noAcceptedEvidence && (
        <section className="live-artifact-empty">
          <div>
            <span>0</span>
            <div>
              <h2>No evidence has crossed the promotion boundary.</h2>
              <p>
                The compiled claims below are a research contract, not conclusions. Discovery records,
                abstracts, and agent proposals remain outside this artifact until they are reviewed and promoted.
              </p>
            </div>
          </div>
          <Link className="primary-button" href={researchHref}>Investigate these claims</Link>
        </section>
      )}

      {actionOptions.length > 0 && (
        <section className="live-artifact-options" aria-labelledby="artifact-options-title">
          <header>
            <span>Action space inherited from contextualization</span>
            <h2 id="artifact-options-title">{brief?.actionSpace.decision}</h2>
            <p>{brief?.actionSpace.decisionHorizon}</p>
          </header>
          <div>
            {actionOptions.map((option) => (
              <article key={option.id}>
                <span>{readable(option.feasibility)}</span>
                <strong>{option.label}</strong>
                <p>{option.description}</p>
              </article>
            ))}
          </div>
          <small>These are feasible actions supplied by the research brief, not recommendations generated from evidence counts.</small>
        </section>
      )}

      <section className="live-artifact-claims" aria-labelledby="artifact-claims-title">
        <header>
          <div>
            <span>Claim coverage</span>
            <h2 id="artifact-claims-title">Read the conclusion boundary before the details.</h2>
          </div>
          <p>
            {visibleClaims.length} scoped {visibleClaims.length === 1 ? "claim" : "claims"} · {uncoveredClaims.length} uncovered · {acceptedRelations.length} accepted result {acceptedRelations.length === 1 ? "relation" : "relations"}
          </p>
        </header>

        <div className="live-claim-list">
          {visibleClaims.map((claim, claimIndex) => {
            const byRelation = relationCounts(claim.relations);
            const familyCount = unique(claim.relations.map((relation) => relation.family.id)).length;
            return (
              <article className={`live-claim ${claim.relations.length === 0 ? "is-uncovered" : ""}`} key={claim.id}>
                <header>
                  <div className="live-claim-index">{String(claimIndex + 1).padStart(2, "0")}</div>
                  <div>
                    <div className="live-claim-kicker">
                      <span>{readable(claim.modality)}</span>
                      <span>{claim.relations.length === 0 ? "uncovered" : `${claim.relations.length} accepted ${claim.relations.length === 1 ? "relation" : "relations"}`}</span>
                      {familyCount > 0 && <span>{familyCount} {familyCount === 1 ? "family" : "families"}</span>}
                    </div>
                    <h3>{claim.statement}</h3>
                    {claim.relations.length > 0 && (
                      <div className="live-relation-summary" aria-label="Raw relationship counts">
                        {Object.entries(byRelation).map(([relation, count]) => (
                          <span className={`live-relation-tag relation-${relation}`} key={relation}>
                            <b>{count}</b>{readable(relation)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </header>

                <details className="live-claim-scope">
                  <summary>Inspect claim scope</summary>
                  <dl>
                    <div><dt>Population</dt><dd>{claim.population || "Not recorded"}</dd></div>
                    <div><dt>Exposure</dt><dd>{claim.exposure || "Not recorded"}</dd></div>
                    <div><dt>Comparator</dt><dd>{claim.comparator || "Not recorded"}</dd></div>
                    <div><dt>Outcome</dt><dd>{claim.outcome || "Not recorded"}</dd></div>
                    <div><dt>Time horizon</dt><dd>{claim.timeHorizon || "Not recorded"}</dd></div>
                  </dl>
                </details>

                {claim.relations.length === 0 ? (
                  <div className="live-uncovered-callout">
                    <span>No promoted result currently bears on this claim.</span>
                    <Link href={researchHref}>Search this gap <span aria-hidden="true">→</span></Link>
                  </div>
                ) : (
                  <div className="live-result-list">
                    {claim.relations.map((relation) => (
                      <details className="live-result" id={relation.result.id} key={relation.id}>
                        <summary>
                          <span className={`live-relation-tag relation-${relation.relation}`}>{readable(relation.relation)}</span>
                          <span>
                            <strong>{relation.result.resultText}</strong>
                            <small>{relation.source.title}</small>
                            <SourceBadges item={relation} />
                          </span>
                          {relation.result.estimate && <b>{relation.result.estimate}</b>}
                        </summary>
                        <div className="live-result-body">
                          <div className="live-result-reading">
                            <span>Why it bears on this claim</span>
                            <p>{relation.rationale}</p>
                          </div>
                          <dl>
                            <div><dt>Scope match</dt><dd>{readable(relation.scopeMatch)}</dd></div>
                            <div><dt>Result role</dt><dd>{readable(relation.result.resultRole)}</dd></div>
                            <div><dt>Analysis</dt><dd>{relation.result.analysisLabel} · {readable(relation.result.analysisType)}</dd></div>
                            <div><dt>Verification</dt><dd>{readable(relation.result.verificationStatus)}</dd></div>
                            <div><dt>Accepted by</dt><dd>{relation.assessor}</dd></div>
                            <div><dt>Accepted at</dt><dd>{formatDate(relation.acceptedAt)}</dd></div>
                          </dl>

                          <section className="live-source-locus">
                            <header>
                              <div>
                                <span>Source container</span>
                                <strong>{relation.source.title}</strong>
                              </div>
                              {relation.source.canonicalUrl && (
                                <a href={relation.source.canonicalUrl} target="_blank" rel="noreferrer">Open source ↗</a>
                              )}
                            </header>
                            <div className="live-locator">
                              <span>Exact locus</span>
                              <strong>{relation.result.locator || "Locator not recorded"}</strong>
                            </div>
                            {relation.result.excerpt ? (
                              <blockquote>{relation.result.excerpt}</blockquote>
                            ) : (
                              <p className="live-missing-excerpt">No preserved excerpt is attached to this accepted record.</p>
                            )}
                            <footer>
                              <span>{relation.source.sourceType}</span>
                              {relation.source.pmid && <span>PMID {relation.source.pmid}</span>}
                              {relation.source.doi && <span>DOI {relation.source.doi}</span>}
                              <span>{relation.source.contentHash ? "source snapshot hashed" : "no source hash recorded"}</span>
                            </footer>
                          </section>

                          <section className="live-family-note">
                            <span>Dependence family · Do not count as another vote</span>
                            <strong>{relation.family.label}</strong>
                            <p>{relation.family.reason}</p>
                            {relation.family.dependsOn.length > 0 && (
                              <small>Recorded as depending on {relation.family.dependsOn.length} other {relation.family.dependsOn.length === 1 ? "family" : "families"}.</small>
                            )}
                          </section>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <SourceDivergencePanel
        key={`${caseId}-${JSON.stringify(artifact?.divergenceItems ?? [])}`}
        items={artifact?.divergenceItems ?? []}
      />

      {artifact?.orphanRelations && artifact.orphanRelations.length > 0 && (
        <section className="live-artifact-orphans">
          <span>Graph integrity notice</span>
          <h2>{artifact.orphanRelations.length} accepted {artifact.orphanRelations.length === 1 ? "relation has" : "relations have"} no readable claim frame.</h2>
          <p>They remain visible to the API but are excluded from claim coverage until their claim identity is repaired.</p>
        </section>
      )}

      <footer className="live-artifact-handoff">
        <div>
          <span>Next move</span>
          <strong>{uncoveredClaims.length > 0 ? "Investigate the gaps that could change the action." : "Cross-examine the evidence before deciding."}</strong>
          <p>Raw record counts describe this artifact. They are not confidence scores and publications do not receive one vote each.</p>
        </div>
        <div>
          <Link href={researchHref}>Continue research</Link>
          <Link className="primary-button" href={synthesisHref}>Open decision workbench</Link>
        </div>
      </footer>
    </>
  );
}
