import { CaseHeader, RefreshControl } from "../components/case-navigation";
import { ResearchDashboard } from "./research-dashboard";

export default function ResearchPage() {
  return (
    <main>
      <CaseHeader
        active="investigate"
        actions={<RefreshControl label="Recompute investigation" eventName="epistack:refresh-investigation" />}
      />
      <section className="route-page research-route">
        <ResearchDashboard />
      </section>
    </main>
  );
}
