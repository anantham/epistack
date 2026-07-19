import { studyInventory } from "../../data/eggs-weight-corpus";
import { CaseHeader, EvidenceSubnav } from "../components/case-navigation";
import { InventoryBrowser } from "./inventory-browser";

export default function InventoryPage() {
  return (
    <main>
      <CaseHeader active="assess" />
      <section className="route-page">
        <EvidenceSubnav active="inventory" />
        <header className="page-hero narrow">
          <div>
            <div className="eyebrow">Systematic-review spine</div>
            <h1 id="inventory-title">Assess all {studyInventory.length} controlled-trial records.</h1>
            <p className="lede">
              This inventory is transcribed from the 2023 review’s study table. Arrows describe each publication’s reported direction, not our confidence in it.
            </p>
          </div>
        </header>
        <InventoryBrowser />
      </section>
    </main>
  );
}
