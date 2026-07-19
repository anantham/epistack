"use client";

import { useMemo, useState } from "react";
import {
  studyInventory,
  type RiskOfBias,
} from "../../data/eggs-weight-corpus";

export function InventoryBrowser() {
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState<"all" | RiskOfBias>("all");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return studyInventory.filter((item) => {
      const matchesRisk = risk === "all" || item.riskOfBias === risk;
      const matchesQuery = !needle || [
        item.citation,
        item.country,
        item.design,
        item.healthStatus,
        item.intervention,
        item.comparator,
        item.result,
      ].join(" ").toLowerCase().includes(needle);
      return matchesRisk && matchesQuery;
    });
  }, [query, risk]);

  return (
    <section className="inventory inventory-route" aria-labelledby="inventory-title">
      <div className="inventory-controls">
        <label>
          <span>Search trials</span>
          <input
            type="search"
            placeholder="Study, country, population, comparator…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Risk of bias</span>
          <select value={risk} onChange={(event) => setRisk(event.target.value as "all" | RiskOfBias)}>
            <option value="all">All assessments</option>
            <option value="low">Low</option>
            <option value="some-concerns">Some concerns</option>
            <option value="high">High</option>
            <option value="not-assessed">Not assessed</option>
          </select>
        </label>
        <strong>{rows.length} of {studyInventory.length}</strong>
      </div>
      <div className="inventory-table-wrap">
        <table>
          <thead><tr><th>Study</th><th>Population</th><th>Exposure → comparator</th><th>Duration</th><th>Reported</th><th>RoB</th></tr></thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.citation}</strong><small>{item.country} · {item.design}</small></td>
                <td>{item.healthStatus}<small>{item.participants}</small></td>
                <td>{item.intervention}<small>vs {item.comparator}</small></td>
                <td>{item.durationWeeks} wk</td>
                <td><span className={`inventory-result ${item.direction}`}>{item.result}</span></td>
                <td><span className={`risk ${item.riskOfBias}`}>{item.riskOfBias.replace("-", " ")}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
