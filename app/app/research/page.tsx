import { CaseHeader } from "../components/case-navigation";
import { ResearchDashboard } from "./research-dashboard";

export default function ResearchPage() {
  return (
    <main>
      <CaseHeader active="investigate" />
      <section className="route-page research-route">
        <ResearchDashboard />
      </section>
    </main>
  );
}
