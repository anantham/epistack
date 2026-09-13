"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

export type InvestigationStage = "decompose" | "contextualize" | "investigate" | "artifact";

const stages: Array<{ id: InvestigationStage; label: string; tooltip: string; href: string }> = [
  { id: "decompose", label: "Decompose", tooltip: "Decompose · dimensions", href: "/" },
  { id: "contextualize", label: "Contextualize", tooltip: "Contextualize · action space", href: "/map" },
  { id: "investigate", label: "Investigate", tooltip: "Investigate · agents & ingestion", href: "/research" },
  { id: "artifact", label: "Artifact", tooltip: "Artifact · live accepted evidence", href: "/artifact" },
];

function useCurrentCaseId() {
  const [caseId, setCaseId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCaseId(new URLSearchParams(window.location.search).get("caseId")?.trim() || "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return caseId;
}

export function useCaseHref(href: string) {
  const caseId = useCurrentCaseId();
  if (!caseId) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}caseId=${encodeURIComponent(caseId)}`;
}

export function StageNav({ active, estimates }: { active: InvestigationStage; estimates?: Array<string | null> }) {
  const caseId = useCurrentCaseId();

  return (
    <nav className="stage-nav" aria-label="Investigation stages">
      {stages.map((stage, index) => {
        const href = caseId
          ? `${stage.href}?caseId=${encodeURIComponent(caseId)}`
          : stage.href;
        const estimate = estimates?.[index];
        return (
          <Link
            className={`stage ${stage.id === active ? "active" : "ready"}`}
            href={href}
            key={stage.id}
            aria-current={stage.id === active ? "page" : undefined}
            aria-label={`Stage ${index + 1}: ${stage.label}`}
            data-loading-label={`Loading ${stage.label}…`}
          >
            <b>{index + 1}</b>
            <span className="stage-tooltip" aria-hidden="true">{estimate ? `${stage.tooltip} · ${estimate}` : stage.tooltip}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function CaseHeader({ active, actions }: { active: InvestigationStage; actions?: ReactNode }) {
  return (
    <header className="topbar">
      <StageNav active={active} />
      {actions}
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
