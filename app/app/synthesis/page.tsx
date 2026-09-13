"use client";

import Link from "next/link";
import { CaseHeader, RefreshControl, useCaseHref } from "../components/case-navigation";
import { DecisionWorkbench } from "./decision-workbench";

export default function SynthesisPage() {
  const artifactHref = useCaseHref("/artifact");

  return (
    <main>
      <CaseHeader
        active="artifact"
        actions={<RefreshControl label="Recompute synthesis" eventName="epistack:refresh-synthesis" />}
      />
      <section className="route-page decision-route live-decision-route">
        <header className="page-hero narrow synthesis-hero">
          <div>
            <div className="eyebrow">Decision episode · Versioned accepted evidence</div>
            <h1>Make a reversible bet—and show exactly what carries it.</h1>
            <p className="lede">
              This specialist does not search, count papers as votes, or infer your goals. It reads the promoted
              result graph against the human-compiled action space, then exposes applicability, cruxes, gaps, and
              flip conditions. Highest-value next information stays visible beside the action.
            </p>
          </div>
          <Link href={artifactHref}>Inspect the accepted graph <span aria-hidden="true">→</span></Link>
        </header>
        <DecisionWorkbench />
      </section>
    </main>
  );
}
