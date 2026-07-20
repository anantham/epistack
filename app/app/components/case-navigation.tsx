"use client";

import Link from "next/link";

export type InvestigationStage = "decompose" | "contextualize" | "investigate" | "artifact";

const stages: Array<{ id: InvestigationStage; label: string; tooltip: string; href: string }> = [
  { id: "decompose", label: "Decompose", tooltip: "Decompose · dimensions", href: "/" },
  { id: "contextualize", label: "Contextualize", tooltip: "Contextualize · action space", href: "/map" },
  { id: "investigate", label: "Investigate", tooltip: "Investigate · agents & ingestion", href: "/research" },
  { id: "artifact", label: "Artifact", tooltip: "Artifact · claims & uncertainty", href: "/evidence" },
];

export function StageNav({ active }: { active: InvestigationStage }) {
  return (
    <nav className="stage-nav" aria-label="Investigation stages">
      {stages.map((stage, index) => (
        <Link
          className={`stage ${stage.id === active ? "active" : "ready"}`}
          href={stage.href}
          key={stage.id}
          aria-current={stage.id === active ? "page" : undefined}
          aria-label={`Stage ${index + 1}: ${stage.label}`}
        >
          <b>{index + 1}</b>
          <span className="stage-tooltip" aria-hidden="true">{stage.tooltip}</span>
        </Link>
      ))}
    </nav>
  );
}

export function CaseHeader({ active }: { active: InvestigationStage }) {
  return (
    <header className="topbar">
      <StageNav active={active} />
    </header>
  );
}

const evidenceViews = [
  { id: "sources", label: "Result ledger", href: "/evidence" },
  { id: "matrix", label: "Claim matrix", href: "/matrix" },
  { id: "inventory", label: "Trial inventory", href: "/inventory" },
  { id: "discoveries", label: "Discovery queue", href: "/discoveries" },
] as const;

export function EvidenceSubnav({ active }: { active: (typeof evidenceViews)[number]["id"] }) {
  return (
    <nav className="case-subnav" aria-label="Evidence views">
      {evidenceViews.map((view) => (
        <Link
          className={view.id === active ? "active" : ""}
          href={view.href}
          key={view.id}
          aria-current={view.id === active ? "page" : undefined}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
