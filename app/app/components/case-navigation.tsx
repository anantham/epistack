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

function HomeControl({ caseId, onHome }: { caseId: string; onHome?: () => void }) {
  const icon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9v11h14V9" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );

  if (onHome) {
    return (
      <button type="button" className="stage-home" aria-label="Edit question" data-tooltip="Edit question" onClick={onHome}>
        {icon}
      </button>
    );
  }

  return (
    <Link className="stage-home" href={caseId ? `/?caseId=${encodeURIComponent(caseId)}` : "/"} aria-label="Edit question" data-tooltip="Edit question">
      {icon}
    </Link>
  );
}

export function StageNav({ active, estimates, onHome }: { active: InvestigationStage; estimates?: Array<string | null>; onHome?: () => void }) {
  const caseId = useCurrentCaseId();

  return (
    <nav className="stage-nav" aria-label="Investigation stages">
      <HomeControl caseId={caseId} onHome={onHome} />
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

export function RefreshControl({
  label,
  onClick,
  eventName,
  disabled = false,
  busy = false,
}: {
  label: string;
  onClick?: () => void;
  eventName?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button phase-refresh-control"
      aria-label={busy ? `${label} in progress` : label}
      data-tooltip={busy ? `${label}…` : label}
      disabled={disabled || busy}
      onClick={() => {
        if (onClick) {
          onClick();
        } else if (eventName) {
          window.dispatchEvent(new CustomEvent(eventName));
        }
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}

export function CaseHeader({ active, actions, onHome }: { active: InvestigationStage; actions?: ReactNode; onHome?: () => void }) {
  return (
    <header className="topbar">
      <StageNav active={active} onHome={onHome} />
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
