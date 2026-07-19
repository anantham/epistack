import { CaseHeader, EvidenceSubnav } from "../components/case-navigation";
import { DiscoveryBrowser } from "./discovery-browser";

export default function DiscoveriesPage() {
  return (
    <main>
      <CaseHeader active="evidence" />
      <section className="route-page">
        <EvidenceSubnav active="discoveries" />
        <header className="page-hero narrow">
          <div>
            <div className="eyebrow">Evidence intake · Not yet assessed</div>
            <h1>Keep discovery separate from evidence.</h1>
            <p className="lede">
              Search results live in a review queue until a person verifies relevance, extraction, provenance, and quality.
            </p>
          </div>
        </header>
        <DiscoveryBrowser />
      </section>
    </main>
  );
}
