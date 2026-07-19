"use client";

import { useEffect, useMemo, useState } from "react";
import {
  atomicResults,
  claimFrames,
  evidenceFamilies,
  getClaim,
  getEvidenceFamily,
  relationCounts,
  resultsForSource,
  sourceRelationshipSummary,
  sourcesWithResults,
  type EvidenceRelation,
} from "../../data/eggs-result-ledger";

const relationshipFilters: Array<"all" | EvidenceRelation> = [
  "all",
  "supports",
  "contradicts",
  "qualifies",
  "undercuts",
  "bounds",
  "not-informative",
];

function readable(value: string) {
  return value.replaceAll("-", " ");
}

export function EvidenceBrowser() {
  const [claimId, setClaimId] = useState<"all" | string>("all");
  const [relation, setRelation] = useState<"all" | EvidenceRelation>("all");
  const [focusedResultId, setFocusedResultId] = useState<string | null>(null);

  useEffect(() => {
    const resultId = new URLSearchParams(window.location.search).get("result");
    if (!resultId || !atomicResults.some((result) => result.id === resultId)) return;
    setFocusedResultId(resultId);
    const result = atomicResults.find((candidate) => candidate.id === resultId);
    if (result) {
      setClaimId(result.claimId);
      window.requestAnimationFrame(() => {
        document.getElementById(`result-${resultId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, []);

  const filteredResults = useMemo(() => atomicResults.filter((result) => {
    const matchesClaim = claimId === "all" || result.claimId === claimId;
    const matchesRelation = relation === "all" || result.relation === relation;
    return matchesClaim && matchesRelation;
  }), [claimId, relation]);

  const visibleSources = sourcesWithResults.filter((source) =>
    filteredResults.some((result) => result.sourceId === source.id),
  );

  const visibleFamilies = new Set(filteredResults.map((result) => result.evidenceFamilyId)).size;

  return (
    <>
      <section className="ledger-explainer" aria-label="How result-level evidence works">
        <div>
          <span>Canonical record</span>
          <strong>Source → study → analysis → result → claim relationship</strong>
        </div>
        <p>
          A publication has no single vote. Each result keeps its own scope, locator, and relationship;
          results sharing participants or data remain collapsed into one evidence family.
        </p>
      </section>

      <div className="ledger-stats" aria-label="Result ledger status">
        <div><b>{filteredResults.length}</b><span>atomic results</span></div>
        <div><b>{visibleSources.length}</b><span>source containers</span></div>
        <div><b>{visibleFamilies}</b><span>evidence families</span></div>
        <div><b>{filteredResults.filter((item) => item.verification === "source-checked").length}</b><span>source checked</span></div>
      </div>

      <div className="result-filter-block">
        <label>
          <span>Claim frame</span>
          <select value={claimId} onChange={(event) => setClaimId(event.target.value)}>
            <option value="all">All scoped claims</option>
            {claimFrames.map((claim) => <option key={claim.id} value={claim.id}>{claim.shortLabel}</option>)}
          </select>
        </label>
        <div className="evidence-toolbar" aria-label="Filter result relationships">
          <span>Result relationship</span>
          <div>
            {relationshipFilters.map((option) => {
              const count = option === "all"
                ? atomicResults.length
                : atomicResults.filter((result) => result.relation === option).length;
              return (
                <button
                  key={option}
                  className={relation === option ? "active" : ""}
                  onClick={() => setRelation(option)}
                >
                  {option === "all" ? "All" : readable(option)}
                  <b>{count}</b>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="result-source-list">
        {visibleSources.map((source) => {
          const sourceResults = resultsForSource(source.id).filter((result) =>
            filteredResults.some((candidate) => candidate.id === result.id),
          );
          const summary = sourceRelationshipSummary(sourceResults);
          const counts = relationCounts(sourceResults);
          return (
            <article className={`result-source-card ${sourceResults.some((result) => result.id === focusedResultId) ? "focused-source" : ""}`} key={source.id}>
              <header>
                <div className="source-card-topline">
                  <span className={`direction ${summary}`}>{readable(summary)}</span>
                  <span>{source.sourceType} · {source.year}</span>
                </div>
                <h2>{source.title}</h2>
                <p>{source.authors} · {source.sample}</p>
                <div className="relation-summary" aria-label="Relationships represented in this source">
                  {Object.entries(counts).filter(([, count]) => count > 0).map(([key, count]) => (
                    <span className={`relation-chip ${key}`} key={key}><b>{count}</b>{readable(key)}</span>
                  ))}
                </div>
              </header>

              <div className="result-ledger">
                {sourceResults.map((result) => {
                  const claim = getClaim(result.claimId);
                  const family = getEvidenceFamily(result.evidenceFamilyId);
                  return (
                    <details
                      className={`atomic-result ${result.id === focusedResultId ? "focused-result" : ""}`}
                      id={`result-${result.id}`}
                      key={result.id}
                      open={result.id === focusedResultId || sourceResults.length <= 2}
                    >
                      <summary>
                        <span className={`relation-mark ${result.relation}`}>{readable(result.relation)}</span>
                        <span className="result-summary-copy">
                          <strong>{result.result}</strong>
                          <small>{claim?.shortLabel} · {result.role} · {result.scopeMatch} scope match</small>
                        </span>
                        {result.estimate && <b className="result-estimate">{result.estimate}</b>}
                      </summary>
                      <div className="result-inspection">
                        <div className="claim-target">
                          <span>Claim this bears on</span>
                          <p>{claim?.statement}</p>
                        </div>
                        <dl>
                          <div><dt>Why this relationship</dt><dd>{result.rationale}</dd></div>
                          <div><dt>Locator</dt><dd>{result.locator}</dd></div>
                          {result.sourcePassage && <div><dt>Short source passage</dt><dd>“{result.sourcePassage}”</dd></div>}
                          <div><dt>Extraction status</dt><dd><span className={`verification ${result.verification}`}>{readable(result.verification)}</span></dd></div>
                        </dl>
                        {family && (
                          <div className="dependence-note">
                            <span>Grouped, not another vote</span>
                            <strong>{family.label}</strong>
                            <p>{family.reason}</p>
                            {family.dependsOn && family.dependsOn.length > 0 && (
                              <small>Reuses evidence from {family.dependsOn.length} represented primary-study {family.dependsOn.length === 1 ? "family" : "families"}.</small>
                            )}
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>

              <footer>
                <div>
                  <span>Source-level caveat</span>
                  <p>{source.limitations[0]}</p>
                </div>
                <a href={source.url} target="_blank" rel="noreferrer">Open source <span aria-hidden="true">↗</span></a>
              </footer>
            </article>
          );
        })}
      </div>

      {filteredResults.length === 0 && (
        <div className="empty-ledger">
          No extracted result matches both filters. This is an absence in the current ledger, not evidence of no effect.
        </div>
      )}

      <section className="verification-legend" aria-label="Extraction verification legend">
        <span><i className="source-checked" />Source checked against the publisher page</span>
        <span><i className="review-extracted" />Transcribed from the assessed review record</span>
        <span><i className="abstract-only" />Abstract-level extraction; full text still needed</span>
        <small>{evidenceFamilies.length} total evidence families are represented in this vertical slice.</small>
      </section>
    </>
  );
}
