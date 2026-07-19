"use client";

import Link from "next/link";

export type InvestigationStage = "frame" | "evidence" | "assess" | "synthesize";

const stages: Array<{ id: InvestigationStage; label: string; href: string }> = [
  { id: "frame", label: "Frame", href: "/" },
  { id: "evidence", label: "Evidence", href: "/evidence" },
  { id: "assess", label: "Assess", href: "/inventory" },
  { id: "synthesize", label: "Synthesize", href: "/synthesis" },
];

export function CaseHeader({
  active,
  onExport,
}: {
  active: InvestigationStage;
  onExport?: () => void;
}) {
  return (
    <header className="topbar">
      <Link className="wordmark" href="/" aria-label="Epistack home">
        <span className="wordmark-mark">E</span>
        <span>Epistack</span>
      </Link>
      <nav className="stage-nav" aria-label="Investigation stages">
        {stages.map((stage, index) => (
          <Link
            className={`stage ${stage.id === active ? "active" : "ready"}`}
            href={stage.href}
            key={stage.id}
            aria-current={stage.id === active ? "page" : undefined}
          >
            <b>{index + 1}</b> {stage.label}
          </Link>
        ))}
      </nav>
      {onExport ? (
        <button className="quiet-button" onClick={onExport}>Export JSON</button>
      ) : (
        <Link className="quiet-button" href="/discoveries">Discovery queue</Link>
      )}
    </header>
  );
}

const evidenceViews = [
  { id: "sources", label: "Deep sources", href: "/evidence" },
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
