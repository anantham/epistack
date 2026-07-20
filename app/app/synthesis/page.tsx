import Link from "next/link";
import { claimRead, corpusMeta } from "../../data/eggs-weight-corpus";
import { atomicResults, evidenceFamilies } from "../../data/eggs-result-ledger";
import { CaseHeader } from "../components/case-navigation";
import { DecisionWorkbench } from "./decision-workbench";

const outcomeRows = [
  {
    outcome: "Superior weight loss",
    read: "Not established",
    basis: "The short positive trial is not reproduced by the closer six-month trial; the pooled result shows no overall benefit.",
    coverage: "Direct but heterogeneous",
  },
  {
    outcome: "Short-term satiety",
    read: "Comparator-dependent",
    basis: "Some egg-versus-cereal or bagel studies show lower hunger or later intake; protein-matched work is less favorable.",
    coverage: "Acute surrogate outcomes",
  },
  {
    outcome: "LDL response",
    read: "Bounded, not settled",
    basis: "One six-month trial found no adverse LDL difference, but this does not resolve personal response or long-term events.",
    coverage: "One represented direct family",
  },
  {
    outcome: "Local-farm quality, cost, ethics",
    read: "Missing",
    basis: "The clinical literature does not identify the Muttichur farm, feed, certification, handling, price, or welfare practices.",
    coverage: "Requires primary collection",
  },
];

export default function SynthesisPage() {
  return (
    <main>
      <CaseHeader active="artifact" />
      <section className="route-page decision-route">
        <header className="page-hero narrow synthesis-hero">
          <div>
            <div className="eyebrow">Decision episode · Evidence version 1</div>
            <h1>Use the graph to make a reversible bet.</h1>
            <p className="lede">The artifact is not a theory of eggs. It records what this decision rests on, what remains personal, and what observation should update the next decision.</p>
          </div>
        </header>

        <DecisionWorkbench />

        <div className="decision-grid">
          <section className="decision-basis">
            <span>What this rests on</span>
            <h2>{atomicResults.length} result relationships collapsed into {evidenceFamilies.length} dependence families.</h2>
            <ul>{claimRead.loadBearing.map((item) => <li key={item}>{item}</li>)}</ul>
            <Link href="/matrix">Cross-examine the matrix <span aria-hidden="true">→</span></Link>
          </section>
          <section className="decision-instability">
            <span>Decision stability</span>
            <h2>Stable against the claim “eggs reliably cause greater weight loss.”</h2>
            <p>Unstable with respect to the real comparator, personal medical context, price, taste, protein alternatives, and farm-specific facts.</p>
            <small>“Stable” here means the action survives the represented evidence families—not that the topic is globally settled.</small>
          </section>
        </div>

        <section className="outcome-ledger" aria-labelledby="outcome-ledger-title">
          <header>
            <span>Options × outcomes</span>
            <h2 id="outcome-ledger-title">Separate what the evidence addresses from what the decision needs.</h2>
          </header>
          <div className="outcome-table-wrap">
            <table>
              <thead><tr><th>Outcome</th><th>Current read</th><th>Load-bearing basis</th><th>Coverage boundary</th></tr></thead>
              <tbody>{outcomeRows.map((row) => (
                <tr key={row.outcome}>
                  <th>{row.outcome}</th>
                  <td><strong>{row.read}</strong></td>
                  <td>{row.basis}</td>
                  <td>{row.coverage}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        <section className="next-information">
          <header>
            <span>Highest-value next information</span>
            <h2>Resolve what could actually change next week’s action.</h2>
          </header>
          <div>
            <article><b>1</b><strong>Name the comparator</strong><p>What breakfast would the two eggs replace? The evidence does not support treating addition and substitution as equivalent.</p></article>
            <article><b>2</b><strong>Check target context</strong><p>Record medical constraints, current diet, goals, allergies, medications, and realistic protein alternatives before applying population evidence.</p></article>
            <article><b>3</b><strong>Inspect the farm</strong><p>Collect price, handling, freshness, feed, certification, and welfare information directly. Those facts are absent from the literature graph.</p></article>
            <article><b>4</b><strong>Choose a measurable crux</strong><p>For a six-day trial, satiety, preference, adherence, and digestive tolerance are measurable. Body fat and long-term risk are not.</p></article>
          </div>
        </section>

        <section className="protocol-draft">
          <div>
            <span>Draft personal observation · Not started</span>
            <h2>Six breakfasts can test usability, not universal health.</h2>
            <p>Log the graph version and decision rationale before acting so later evidence updates can be traced back to the original basis.</p>
          </div>
          <dl>
            <div><dt>Intervention</dt><dd>Two eggs substituted for the named breakfast on six planned days.</dd></div>
            <div><dt>Record</dt><dd>Preparation, comparator displaced, adherence, hunger before lunch, later intake, energy, preference, and adverse symptoms.</dd></div>
            <div><dt>Keep exploratory</dt><dd>Scale weight, sleep, and resting heart rate are noisy over six days and should not be treated as causal confirmation.</dd></div>
            <div><dt>Outside this protocol</dt><dd>Body fat, LDL/ApoB, and clinical risk require a longer, appropriately supervised design.</dd></div>
          </dl>
        </section>

        <div className="corpus-boundary decision-boundary">
          <div>
            <span>Evidence boundary</span>
            <strong>{corpusMeta.reviewCoverage}</strong>
            <small>{corpusMeta.updateCoverage}</small>
          </div>
          <p>{claimRead.summary} This is decision support, not individualized medical advice.</p>
        </div>
      </section>
    </main>
  );
}
