"use client";

import { useState } from "react";
import {
  evidenceSources,
  type EvidenceDirection,
} from "../../data/eggs-weight-corpus";

export function EvidenceBrowser() {
  const [filter, setFilter] = useState<"all" | EvidenceDirection>("all");
  const filteredSources = filter === "all"
    ? evidenceSources
    : evidenceSources.filter((source) => source.direction === filter);

  return (
    <>
      <div className="evidence-toolbar" aria-label="Filter evidence">
        <span>Relationship to claim</span>
        <div>
          {(["all", "supports", "challenges", "mixed", "context"] as const).map((option) => (
            <button
              key={option}
              className={filter === option ? "active" : ""}
              onClick={() => setFilter(option)}
            >
              {option === "all" ? "All" : option[0].toUpperCase() + option.slice(1)}
              <b>
                {option === "all"
                  ? evidenceSources.length
                  : evidenceSources.filter((source) => source.direction === option).length}
              </b>
            </button>
          ))}
        </div>
      </div>

      <div className="source-grid">
        {filteredSources.map((source) => (
          <article className="source-card" key={source.id}>
            <div className="source-card-topline">
              <span className={`direction ${source.direction}`}>{source.direction}</span>
              <span>{source.directness} · {source.sourceType}</span>
            </div>
            <h3>{source.title}</h3>
            <p className="source-byline">{source.authors} · {source.year} · {source.sample}</p>
            <p className="source-finding">{source.finding}</p>
            <dl className="pico-grid">
              <div><dt>Population</dt><dd>{source.population}</dd></div>
              <div><dt>Exposure</dt><dd>{source.intervention}</dd></div>
              <div><dt>Comparator</dt><dd>{source.comparator}</dd></div>
              <div><dt>Duration</dt><dd>{source.duration}</dd></div>
            </dl>
            <details>
              <summary>Inspect quality and provenance</summary>
              <div className="quality-block">
                <p><b>Risk of bias:</b> {source.riskOfBias.replace("-", " ")}</p>
                <p><b>Funding:</b> {source.funding}</p>
                <p><b>Locator:</b> {source.locator}</p>
                <div><b>Transparency</b><ul>{source.transparency.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><b>Limitations</b><ul>{source.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </div>
            </details>
            <a href={source.url} target="_blank" rel="noreferrer">
              Open source <span aria-hidden="true">↗</span>
            </a>
          </article>
        ))}
      </div>
    </>
  );
}
