"use client";

import Link from "next/link";

export type InvestigationStage = "frame" | "evidence" | "assess" | "synthesize";

const stages: Array<{ id: InvestigationStage; label: string; href: string }> = [
  { id: "frame", label: "Frame", href: "/" },
  { id: "evidence", label: "Evidence", href: "/evidence" },
  { id: "assess", label: "Assess", href: "/inventory" },
  { id: "synthesize", label: "Decide", href: "/synthesis" },
];

export function CaseHeader({ active }: { active: InvestigationStage }) {
  return (
    <header className="topbar">
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
            <span className="stage-tooltip" aria-hidden="true">{stage.label}</span>
          </Link>
        ))}
      </nav>
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
