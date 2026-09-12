"use client";

import Link from "next/link";

export type ThinkingEffort = "instant" | "medium" | "high" | "xhigh" | "pro";

export const thinkingEfforts: ThinkingEffort[] = ["instant", "medium", "high", "xhigh", "pro"];

export const thinkingEffortLabels: Record<ThinkingEffort, string> = {
  instant: "Instant",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  pro: "Pro",
};

const effortAliases: Record<string, ThinkingEffort> = { low: "instant", max: "pro" };

export function normalizeThinkingEffort(value: unknown): ThinkingEffort {
  if (typeof value !== "string") return "instant";
  const trimmed = value.trim().toLowerCase();
  const alias = effortAliases[trimmed] ?? trimmed;
  return (thinkingEfforts as readonly string[]).includes(alias) ? (alias as ThinkingEffort) : "instant";
}

export const preferencesStorageKey = "epistack:preferences:v1";

export function readPreferredEffort(): ThinkingEffort {
  try {
    const prefs = JSON.parse(window.localStorage.getItem(preferencesStorageKey) || "{}") as { effort?: unknown };
    return normalizeThinkingEffort(prefs?.effort);
  } catch {
    return "instant";
  }
}

export function BackendSettings({
  effort,
  onEffortChange,
  onClose,
}: {
  effort: ThinkingEffort;
  onEffortChange: (effort: ThinkingEffort) => void;
  onClose: () => void;
}) {
  return (
    <div className="settings-panel" role="dialog" aria-label="Settings">
      <div className="settings-heading">
        <strong>Settings</strong>
        <button type="button" className="icon-button" aria-label="Close settings" data-tooltip="Close" onClick={onClose}>×</button>
      </div>
      <label>
        <span>Backend</span>
        <input
          type="text"
          value="Astra (hosted) · no key needed"
          readOnly
          aria-readonly="true"
          tabIndex={-1}
          spellCheck={false}
        />
      </label>
      <label>
        <span>Thinking effort</span>
        <select
          value={effort}
          onChange={(event) => onEffortChange(normalizeThinkingEffort(event.target.value))}
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--line)",
            borderRadius: 9,
            color: "var(--ink)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            padding: "10px 11px",
            width: "100%",
          }}
        >
          {thinkingEfforts.map((value) => (
            <option key={value} value={value}>{thinkingEffortLabels[value]}</option>
          ))}
        </select>
      </label>
      <Link className="settings-prompt-link" href="/prompts">
        <span><strong>AI agent prompts</strong><small>Inspect and edit the instructions driving every model call.</small></span>
        <b aria-hidden="true">→</b>
      </Link>
      <p className="connection-status">
        <i aria-hidden="true" />Higher effort is slower and does not change your quota. Saved in this browser.
      </p>
    </div>
  );
}
