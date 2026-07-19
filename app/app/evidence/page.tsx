import Link from "next/link";
import { corpusMeta, evidenceSources, studyInventory } from "../../data/eggs-weight-corpus";
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
            <div className="eyebrow">Claim-matched corpus · Human review required</div>
            <h1>Inspect the evidence, one source at a time.</h1>
            <p className="lede">
              These records have been extracted deeply enough to inspect relevance, provenance, funding, and limitations. Direction is not confidence.
            </p>
          </div>
          <div className="corpus-counts" aria-label="Evidence corpus status">
            <Link href="/evidence"><b>{evidenceSources.length}</b><span>deep sources</span></Link>
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
          <p>{corpusMeta.caveat}</p>
        </div>

        <EvidenceBrowser />
      </section>
    </main>
  );
}
