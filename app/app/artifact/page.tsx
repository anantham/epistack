import { CaseHeader, RefreshControl } from "../components/case-navigation";
import { ArtifactWorkspace } from "./artifact-workspace";

export default function ArtifactPage() {
  return (
    <main>
      <CaseHeader
        active="artifact"
        actions={<RefreshControl label="Refresh artifact" eventName="epistack:refresh-artifact" />}
      />
      <section className="route-page live-artifact-route">
        <ArtifactWorkspace />
      </section>
    </main>
  );
}
