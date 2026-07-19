"use client";

import { useMemo, useState } from "react";
import pubmedDiscovery from "../../data/pubmed-discovery.json";

export function DiscoveryBrowser() {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const records = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pubmedDiscovery.records;
    return pubmedDiscovery.records.filter((record) =>
      [record.title, record.journal, record.published, ...record.authors]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);
  const displayed = showAll ? records : records.slice(0, 24);

  return (
    <>
      <div className="search-audit">
        <div>
          <span>Reproducible discovery trail</span>
          <strong>{pubmedDiscovery.countReportedByPubMed} PubMed matches</strong>
          <small>Fetched {pubmedDiscovery.fetchedAt.slice(0, 10)}</small>
        </div>
        <div>
          <p>{pubmedDiscovery.evidencePolicy}</p>
          <code>{pubmedDiscovery.query}</code>
        </div>
      </div>

      <section className="discovery-inbox discovery-route" aria-labelledby="discovery-title">
        <div className="discovery-heading">
          <div>
            <div className="eyebrow">Unassessed intake queue</div>
            <h2 id="discovery-title">Screen before promotion</h2>
            <p>Matching is not endorsement. Open, screen, extract, and verify each record before treating it as evidence.</p>
          </div>
          <label>
            <span>Search {pubmedDiscovery.recordsFetched} records</span>
            <input
              type="search"
              placeholder="Title, author, journal, or year"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setShowAll(false);
              }}
            />
          </label>
        </div>
        <div className="discovery-list">
          {displayed.map((record) => (
            <article key={record.pmid}>
              <div>
                <span className="unassessed">Unassessed</span>
                <small>{record.published} · {record.journal}</small>
              </div>
              <h4>{record.title}</h4>
              <p>{record.authors.slice(0, 4).join(", ")}{record.authors.length > 4 ? " et al." : ""}</p>
              <div className="discovery-meta">
                <span>PMID {record.pmid}</span>
                {record.doi && <span>DOI {record.doi}</span>}
                {record.publicationTypes.slice(0, 2).map((type) => <span key={type}>{type}</span>)}
              </div>
              <a href={record.url} target="_blank" rel="noreferrer">Screen source ↗</a>
            </article>
          ))}
        </div>
        <div className="discovery-footer">
          <span>Showing {displayed.length} of {records.length} matching records</span>
          {records.length > 24 && (
            <button onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show first 24" : `Show all ${records.length}`}
            </button>
          )}
        </div>
      </section>
    </>
  );
}
