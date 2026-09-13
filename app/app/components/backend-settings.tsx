"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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

type ServiceStatus = {
  state: "healthy" | "attention" | "unavailable" | "not-configured";
  message: string;
  model?: string;
};

type BackendStatus = {
  checkedAt: string;
  astra: ServiceStatus;
  openrouter: ServiceStatus;
};

const statusLabels: Record<ServiceStatus["state"], string> = {
  healthy: "Healthy",
  attention: "Needs attention",
  unavailable: "Unavailable",
  "not-configured": "Not configured",
};

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
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [checking, setChecking] = useState<"all" | "astra" | "openrouter" | null>(null);
  const [statusError, setStatusError] = useState("");

  const checkStatus = useCallback(async () => {
    setChecking("all");
    setStatusError("");
    try {
      const response = await fetch("/api/backend-status", { cache: "no-store" });
      const result = await response.json() as BackendStatus & { error?: string };
      if (!response.ok) throw new Error(result.error || `Status check returned HTTP ${response.status}.`);
      setBackendStatus(result);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "The backend status check failed.");
    } finally {
      setChecking(null);
    }
  }, []);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const renderServiceStatus = (service: "astra" | "openrouter", label: string, description: string) => {
    const status = backendStatus?.[service];
    const isChecking = checking === "all" || checking === service;
    return (
      <div className="settings-health-card">
        <div className="settings-health-heading">
          <div>
            <strong>{label}</strong>
            <small>{description}</small>
          </div>
          <button
            type="button"
            className="settings-health-check"
            onClick={() => { void checkStatus(); }}
            disabled={isChecking}
          >
            {isChecking ? "Checking" : "Check"}
          </button>
        </div>
        <p className={`connection-status ${isChecking ? "checking" : status ? status.state : ""}`}>
          <i aria-hidden="true" />
          <span>{isChecking ? "Checking from the hosted worker…" : status ? `${statusLabels[status.state]} · ${status.message}` : "Not checked yet."}</span>
        </p>
        {service === "openrouter" && status?.model && <small className="settings-health-model">Model: {status.model}</small>}
      </div>
    );
  };

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
      <div className="settings-health-section">
        <div className="settings-health-section-heading">
          <span>Live backend status</span>
          <button type="button" className="settings-health-refresh" onClick={() => { void checkStatus(); }} disabled={checking !== null}>
            {checking === "all" ? "Checking…" : "Check both"}
          </button>
        </div>
        {renderServiceStatus("astra", "Astra / Lyra gateway", "Primary hosted reasoning backend")}
        {renderServiceStatus("openrouter", "OpenRouter fallback", "Server-side recovery path")}
        {statusError && <p className="settings-health-error">{statusError}</p>}
        <p className="settings-health-note">These checks test reachability, credentials, and model availability. They do not run a full model request.</p>
      </div>
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
