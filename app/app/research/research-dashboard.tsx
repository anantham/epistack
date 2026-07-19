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
  type ResearchLaneId,
} from "../../data/eggs-investigation";
import { atomicResults } from "../../data/eggs-result-ledger";
import type { DeepDiveResponse } from "../../lib/deep-dive";
import type { PublicationFilter, PubmedDiscovery, ResearchResponse } from "../../lib/research";

type LaneRun = {
  status: "ready" | "running" | "complete" | "error";
  response: ResearchResponse | null;
  error: string;
};

type DeepDiveRun = {
  status: "idle" | "extracting" | "review" | "promoting" | "persisted" | "error";
  payload: DeepDiveResponse | null;
  checked: boolean;
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

const initialRuns = Object.fromEntries(
  researchLanes.map((lane) => [lane.id, { status: "ready", response: null, error: "" }]),
) as Record<ResearchLaneId, LaneRun>;

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
  const [queries, setQueries] = useState<Record<ResearchLaneId, string>>(
    Object.fromEntries(researchLanes.map((lane) => [lane.id, lane.defaultQuery])) as Record<ResearchLaneId, string>,
  );
  const [filters, setFilters] = useState<PublicationFilter[]>(["trials", "reviews"]);
  const [runs, setRuns] = useState<Record<ResearchLaneId, LaneRun>>(initialRuns);
  const [deepDives, setDeepDives] = useState<Record<string, DeepDiveRun>>({});
  const [promotionRecords, setPromotionRecords] = useState<PromotionRecord[]>([]);
  const [openLane, setOpenLane] = useState<ResearchLaneId>(researchLanes[0].id);

  const activeCount = useMemo(
    () => Object.values(runs).filter((run) => run.status === "running").length,
    [runs],
  );

  function currentCaseId() {
    try {
      const workspace = JSON.parse(window.localStorage.getItem("epistack:workspace:v1") || "{}") as { result?: { caseId?: string } | null };
      return workspace.result?.caseId || "eggs-live-mvp";
    } catch {
      return "eggs-live-mvp";
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
    void loadPromotionRegister();
    // The register is case-scoped at mount; a new framing navigation remounts this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleFilter(filter: PublicationFilter) {
    setFilters((current) => current.includes(filter)
      ? current.filter((candidate) => candidate !== filter)
      : [...current, filter]);
  }

  async function runLane(lane: ResearchLane) {
    setOpenLane(lane.id);
    setRuns((current) => ({
      ...current,
      [lane.id]: { status: "running", response: null, error: "" },
    }));
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queries[lane.id], filters, maxResults: 6 }),
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
          response: null,
          error: error instanceof Error ? error.message : "The live discovery sweep failed.",
        },
      }));
    }
  }

  async function runAll() {
    // PubMed asks unauthenticated clients to stay below three requests/second.
    // Each lane performs a search and summary request, so run lanes in series.
    for (const lane of researchLanes) await runLane(lane);
  }

  function modelPreferences() {
    try {
      const preferences = JSON.parse(window.localStorage.getItem("epistack:preferences:v1") || "{}") as { apiKey?: string; model?: string };
      return { apiKey: preferences.apiKey?.trim() || "", model: preferences.model?.trim() || "anthropic/claude-opus-4.8" };
    } catch {
      return { apiKey: "", model: "anthropic/claude-opus-4.8" };
    }
  }

  async function extractRecord(record: PubmedDiscovery) {
    setDeepDives((current) => ({
      ...current,
      [record.pmid]: { status: "extracting", payload: null, checked: false, error: "" },
    }));
    try {
      const preferences = modelPreferences();
      const response = await fetch("/api/deep-dive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record, openRouterApiKey: preferences.apiKey, openRouterModel: preferences.model }),
      });
      const payload = await response.json() as DeepDiveResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The abstract extraction failed.");
      setDeepDives((current) => ({
        ...current,
        [record.pmid]: { status: "review", payload, checked: false, error: "" },
      }));
    } catch (error) {
      setDeepDives((current) => ({
        ...current,
        [record.pmid]: { status: "error", payload: null, checked: false, error: error instanceof Error ? error.message : "The abstract extraction failed." },
      }));
    }
  }

  async function promoteRecord(record: PubmedDiscovery) {
    const dive = deepDives[record.pmid];
    if (!dive?.payload || !dive.checked) return;
    setDeepDives((current) => ({ ...current, [record.pmid]: { ...dive, status: "promoting", error: "" } }));
    try {
      let workspace: { prompt?: string; result?: { caseId?: string } | null } = {};
      try {
        workspace = JSON.parse(window.localStorage.getItem("epistack:workspace:v1") || "{}") as typeof workspace;
      } catch {
        workspace = {};
      }
      const response = await fetch("/api/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: workspace.result?.caseId,
          originalPrompt: workspace.prompt,
          source: dive.payload.source,
          candidate: dive.payload.candidate,
          model: dive.payload.model,
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

  return (
    <>
      <header className="page-hero research-hero">
        <div>
          <div className="eyebrow">Investigation cockpit · Egg MVP</div>
          <h1>Direct the search. Inspect what earns promotion.</h1>
          <p className="lede">
            Each specialist lane runs a real, editable PubMed sweep. Returned records remain discovery leads until a human verifies their full result structure.
          </p>
        </div>
        <button className="primary-button run-all" onClick={runAll} disabled={activeCount > 0}>
          {activeCount > 0 ? `${activeCount} lanes searching` : "Run all three lanes"}
        </button>
      </header>

      <section className="research-boundary" aria-label="MVP evidence boundary">
        <div>
          <span>Working vertical slice</span>
          <strong>{verticalSliceAudit.lanes} live queries → {verticalSliceAudit.results} atomic result relationships</strong>
        </div>
        <p>
          Search rank is not evidential weight. A new record must be scoped, decomposed, checked, and assigned to one of {verticalSliceAudit.families} current evidence families—or a justified new family—before it can affect the decision.
        </p>
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
        <p>
          Filters are applied to every lane. Turn them all off to inspect the unfiltered query; edit any lane directly before launching it.
        </p>
      </section>

      <div className="research-lanes">
        {researchLanes.map((lane, index) => {
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
                      {run.status === "running" ? "Searching PubMed…" : run.status === "complete" ? "Run this lane again" : "Run this lane"}
                    </button>
                    <span>{audit.resultCount} reviewed results from {audit.familyCount} independent families already anchor this lane.</span>
                  </div>

                  {run.error && <p className="lane-error" role="alert">{run.error}</p>}

                  {run.response && (
                    <section className="live-discoveries" aria-label={`${lane.label} discovery results`}>
                      <header>
                        <div><span>Live discovery sweep</span><strong>{run.response.records.length} shown · {run.response.totalMatches.toLocaleString()} PubMed matches</strong></div>
                        <small>{new Date(run.response.retrievedAt).toLocaleString()}</small>
                      </header>
                      <div className="executed-query"><span>Executed</span><code>{run.response.executedQuery}</code></div>
                      <div className="discovery-records">
                        {run.response.records.map((record) => {
                          const known = knownSourceByPmid.get(record.pmid);
                          const resultId = known ? firstResultForSource(known.id) : undefined;
                          const deepDive = deepDives[record.pmid] ?? { status: "idle", payload: null, checked: false, error: "" };
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
                                {known && resultId ? (
                                  <Link href={`/evidence?result=${resultId}`}>Inspect atomic results <span aria-hidden="true">→</span></Link>
                                ) : (
                                  <button onClick={() => extractRecord(record)} disabled={deepDive.status === "extracting" || deepDive.status === "promoting" || deepDive.status === "persisted"}>
                                    {deepDive.status === "extracting" ? "Extracting abstract…" : deepDive.status === "persisted" ? "Persisted in graph" : "Extract abstract results"}
                                  </button>
                                )}
                                <a href={record.url} target="_blank" rel="noreferrer">Open PubMed ↗</a>
                              </footer>
                              {deepDive.error && (
                                <p className="deep-dive-error" role="alert">{deepDive.error} {deepDive.error.includes("bring-your-own") && <Link href="/">Open Settings on the Frame page.</Link>}</p>
                              )}
                              {deepDive.payload && (
                                <div className="candidate-extraction">
                                  <header>
                                    <div><span>Proposed typed records</span><strong>{deepDive.payload.candidate.results.length} atomic results · abstract only</strong></div>
                                    <small>{deepDive.payload.model}</small>
                                  </header>
                                  <dl className="candidate-study">
                                    <div><dt>Design</dt><dd>{deepDive.payload.candidate.study.design}</dd></div>
                                    <div><dt>Population</dt><dd>{deepDive.payload.candidate.study.population}</dd></div>
                                    <div><dt>Evidence family</dt><dd>{deepDive.payload.candidate.evidenceFamily.label}</dd></div>
                                  </dl>
                                  <div className="candidate-results">
                                    {deepDive.payload.candidate.results.map((result, resultIndex) => (
                                      <article key={`${record.pmid}-${resultIndex}`}>
                                        <div><span className={`relation-chip ${result.relation}`}>{result.relation}</span><small>{result.claimFrameId} · {result.scopeMatch}</small></div>
                                        <strong>{result.resultText}</strong>
                                        {result.estimate && <b>{result.estimate}</b>}
                                        <p>{result.rationale}</p>
                                        <small>{result.locator} · proposed from abstract</small>
                                      </article>
                                    ))}
                                  </div>
                                  <p className="extraction-caveat"><strong>Cannot yet verify:</strong> {deepDive.payload.candidate.extractionCaveat}</p>
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
                                  <button className="primary-button" onClick={() => promoteRecord(record)} disabled={!deepDive.checked || deepDive.status === "promoting" || deepDive.status === "persisted"}>
                                    {deepDive.status === "promoting" ? "Writing typed records…" : deepDive.status === "persisted" ? "Accepted · pending full text" : "Promote checked results"}
                                  </button>
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
          <div><span>Persistent graph · Live promotions only</span><h2 id="promotion-register-title">What crossed the human promotion gate.</h2></div>
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
          <p>No live discovery has crossed the gate in this case yet. The reviewed egg fixture remains separate; extract an unreviewed lead, check it, and promote it to create the first durable record.</p>
        )}
      </section>

      <section className="research-handoff">
        <div>
          <span>Promotion gate</span>
          <h2>The agent proposes. The evidence graph does not update silently.</h2>
          <p>A human must verify the source locator, scope, estimate, relation, and dependence family. Only then may a result influence a claim matrix or decision episode.</p>
        </div>
        <Link className="primary-button" href="/evidence">Inspect promoted results</Link>
      </section>
    </>
  );
}
