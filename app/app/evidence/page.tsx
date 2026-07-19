import Link from "next/link";
import { corpusMeta, studyInventory } from "../../data/eggs-weight-corpus";
import { atomicResults, evidenceFamilies, sourcesWithResults } from "../../data/eggs-result-ledger";
import pubmedDiscovery from "../../data/pubmed-discovery.json";
import { CaseHeader, EvidenceSubnav } from "../components/case-navigation";
import { EvidenceBrowser } from "./evidence-browser";

export default function EvidencePage() {
  return (
    <main>
      <CaseHeader active="evidence" />
      <section className="route-page">
        <EvidenceSubnav active="sources" />
        <header className="page-hero">
          <div>
            <div className="eyebrow">Result ledger · Human review required</div>
            <h1>A paper can disagree with itself.</h1>
            <p className="lede">
              Inspect the individual analyses, estimates, and interpretations inside each source. Relationships belong to results—not to publications as a whole.
            </p>
          </div>
          <div className="corpus-counts" aria-label="Evidence corpus status">
            <Link href="/evidence"><b>{atomicResults.length}</b><span>atomic results</span></Link>
            <Link href="/matrix"><b>{evidenceFamilies.length}</b><span>evidence families</span></Link>
            <Link href="/inventory"><b>{studyInventory.length}</b><span>trial records</span></Link>
            <Link href="/discoveries"><b>{pubmedDiscovery.recordsFetched}</b><span>discoveries</span></Link>
          </div>
        </header>

        <div className="corpus-boundary">
          <div>
            <span>Coverage</span>
            <strong>{corpusMeta.reviewCoverage}</strong>
            <small>{corpusMeta.updateCoverage}</small>
          </div>
          <p>{corpusMeta.caveat} {sourcesWithResults.length} source containers currently have result-level decomposition; other records remain visible in the broader trial inventory.</p>
        </div>

        <EvidenceBrowser />
      </section>
    </main>
  );
}
