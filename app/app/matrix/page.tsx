import {
  atomicResults,
  claimFrames,
  evidenceFamilies,
  relationCounts,
  resultsForSource,
  sourcesWithResults,
} from "../../data/eggs-result-ledger";
import { CaseHeader, EvidenceSubnav } from "../components/case-navigation";

function readable(value: string) {
  return value.replaceAll("-", " ");
}

export default function MatrixPage() {
  return (
    <main>
      <CaseHeader active="assess" />
      <section className="route-page matrix-route">
        <EvidenceSubnav active="matrix" />
        <header className="page-hero narrow">
          <div>
            <div className="eyebrow">Projection · Not the canonical record</div>
            <h1>Cross-examine claims against results.</h1>
            <p className="lede">
              Each cell summarizes atomic result relationships. Open the result ledger to inspect the analysis, locator, scope, and dependence behind every mark.
            </p>
          </div>
        </header>

        <section className="matrix-warning">
          <strong>Do not count marks as votes.</strong>
          <p>
            Multiple marks from one publication may share participants and methods. The {evidenceFamilies.length} evidence families below are the independence boundary; the 2023 review also reuses represented primary trials.
          </p>
        </section>

        <div className="claim-matrix-wrap">
          <table className="claim-matrix">
            <thead>
              <tr>
                <th>Scoped claim</th>
                {sourcesWithResults.map((source) => (
                  <th key={source.id}>
                    <span>{source.authors.split(",")[0]}</span>
                    <small>{source.year}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {claimFrames.map((claim) => (
                <tr key={claim.id}>
                  <th>
                    <strong>{claim.shortLabel}</strong>
                    <small>{claim.statement}</small>
                  </th>
                  {sourcesWithResults.map((source) => {
                    const results = resultsForSource(source.id).filter((result) => result.claimId === claim.id);
                    const counts = relationCounts(results);
                    return (
                      <td className={results.length > 1 ? "contains-multiple" : ""} key={source.id}>
                        {results.length === 0 ? (
                          <span className="matrix-silent" aria-label="No extracted result">·</span>
                        ) : (
                          <div className="matrix-marks" aria-label={`${results.length} extracted result relationships`}>
                            {Object.entries(counts).filter(([, count]) => count > 0).map(([relation, count]) => (
                              <span className={`relation-chip ${relation}`} key={relation} title={readable(relation)}>
                                <b>{count}</b>{readable(relation)}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="family-register" aria-labelledby="family-register-title">
          <header>
            <span>Independence register</span>
            <h2 id="family-register-title">One family, however many endpoints.</h2>
          </header>
          <div>
            {evidenceFamilies.map((family) => {
              const resultCount = atomicResults.filter((result) => result.evidenceFamilyId === family.id).length;
              return (
                <article key={family.id}>
                  <b>{resultCount}</b>
                  <div><strong>{family.label}</strong><p>{family.reason}</p></div>
                  {family.dependsOn && <small>Depends on {family.dependsOn.length} represented primary-study families</small>}
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
