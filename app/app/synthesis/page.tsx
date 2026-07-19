import Link from "next/link";
import {
  claimRead,
  corpusMeta,
  evidenceSources,
  studyInventory,
} from "../../data/eggs-weight-corpus";
import pubmedDiscovery from "../../data/pubmed-discovery.json";
import { CaseHeader } from "../components/case-navigation";

export default function SynthesisPage() {
  return (
    <main>
      <CaseHeader active="synthesize" />
      <section className="route-page">
        <header className="page-hero narrow synthesis-hero">
          <div>
            <div className="eyebrow">Provisional synthesis · No formal belief update</div>
            <h1>Make the conclusion’s load-bearing parts visible.</h1>
            <p className="lede">This read is deliberately bounded by the compiled claim and the evidence reviewed so far.</p>
          </div>
        </header>

        <div className="compiled-claim-card">
          <span>Claim under assessment</span>
          <p>{corpusMeta.compiledClaim}</p>
        </div>

        <div className="evidence-overview synthesis-overview">
          <article className="current-read">
            <span className="read-status">Current read · {claimRead.status}</span>
            <h3>{claimRead.summary}</h3>
            <p>This is a provisional interpretation of the corpus, not a medical recommendation and not a completed probability update.</p>
          </article>
          <div className="crux-panel">
            <div>
              <span>Load-bearing evidence</span>
              <ul>{claimRead.loadBearing.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <span>What would change the answer?</span>
              <ul>{claimRead.cruxes.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>
        </div>

        <div className="corpus-boundary">
          <div>
            <span>Coverage</span>
            <strong>{corpusMeta.reviewCoverage}</strong>
            <small>{corpusMeta.updateCoverage}</small>
          </div>
          <p>{corpusMeta.caveat}</p>
        </div>

        <div className="synthesis-links" aria-label="Audit synthesis inputs">
          <Link href="/evidence"><b>{evidenceSources.length}</b><span>Inspect extracted sources</span></Link>
          <Link href="/inventory"><b>{studyInventory.length}</b><span>Audit trial inventory</span></Link>
          <Link href="/discoveries"><b>{pubmedDiscovery.recordsFetched}</b><span>Screen unassessed records</span></Link>
        </div>
      </section>
    </main>
  );
}
