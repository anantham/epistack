import { CaseHeader } from "../components/case-navigation";
import { ArtifactWorkspace } from "./artifact-workspace";

export default function ArtifactPage() {
  return (
    <main>
      <CaseHeader active="artifact" />
      <section className="route-page live-artifact-route">
        <ArtifactWorkspace />
      </section>
    </main>
  );
}
