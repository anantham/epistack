"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  modelFamily,
  normalizeModelId,
  parseResearchPreferences,
  researchBudgetProfiles,
  researchEffortSteps,
  researchPreferencesStorageKey,
  researchRunCapUsd,
  type ResearchEffortStep,
  type ResearchModelPreferences,
  type ResearchModelRole,
} from "../../lib/research-budget";

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

type ModelOption = {
  id: string;
  name: string;
  promptPerMillion: number | null;
  completionPerMillion: number | null;
  webSearchPerCall: number | null;
};

type ModelDrafts = Record<ResearchModelRole, string>;

const statusLabels: Record<ServiceStatus["state"], string> = {
  healthy: "healthy",
  attention: "needs attention",
  unavailable: "unavailable",
  "not-configured": "not configured",
};

const modelListCacheKey = "epistack:openrouter-models:v1";

const modelRoles: Array<{ role: ResearchModelRole; label: string; hint: string }> = [
  { role: "search", label: "Search agents", hint: "Search the web for leads" },
  { role: "reader", label: "Paper reader", hint: "Extracts results from full text" },
  { role: "reviewer", label: "Reviewer", hint: "Challenges every extracted result" },
];

export function readPreferredEffort(): ThinkingEffort {
  try {
    const prefs = JSON.parse(window.localStorage.getItem(preferencesStorageKey) || "{}") as { effort?: unknown };
    return normalizeThinkingEffort(prefs?.effort);
  } catch {
    return "instant";
  }
}

function readSavedResearch() {
  try {
    return parseResearchPreferences(window.localStorage.getItem(researchPreferencesStorageKey));
  } catch {
    return parseResearchPreferences(null);
  }
}

function formatPrice(value: number | null) {
  if (value === null) return "?";
  return value >= 10 ? `$${Math.round(value)}` : `$${Number(value.toFixed(2))}`;
}

function modelOptionLabel(option: ModelOption) {
  const tokens = `${formatPrice(option.promptPerMillion)} in / ${formatPrice(option.completionPerMillion)} out per 1M tokens`;
  return option.webSearchPerCall ? `${option.name} · ${tokens} · built-in search` : `${option.name} · ${tokens}`;
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
  const [checking, setChecking] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [researchEffort, setResearchEffort] = useState<ResearchEffortStep>(() => readSavedResearch().effort);
  const [modelDrafts, setModelDrafts] = useState<ModelDrafts>(() => {
    const { models } = readSavedResearch();
    return { search: models.search ?? "", reader: models.reader ?? "", reviewer: models.reviewer ?? "" };
  });
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelListError, setModelListError] = useState("");

  const checkStatus = useCallback(async () => {
    setChecking(true);
    setStatusError("");
    try {
      const response = await fetch("/api/backend-status", { cache: "no-store" });
      const result = await response.json() as BackendStatus & { error?: string };
      if (!response.ok) throw new Error(result.error || `Status check returned HTTP ${response.status}.`);
      setBackendStatus(result);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "The backend status check failed.");
    } finally {
      setChecking(false);
    }
  }, []);

  const loadModelOptions = useCallback(async () => {
    try {
      const cached = JSON.parse(window.sessionStorage.getItem(modelListCacheKey) || "null") as { models?: ModelOption[] } | null;
      if (Array.isArray(cached?.models) && cached.models.length) {
        setModelOptions(cached.models);
        return;
      }
    } catch {
      // An unreadable cached list is fetched again.
    }
    try {
      const response = await fetch("/api/openrouter/models");
      const payload = await response.json() as { models?: ModelOption[]; error?: string };
      if (!response.ok || !Array.isArray(payload.models)) throw new Error(payload.error || "OpenRouter's model list is unavailable.");
      setModelOptions(payload.models);
      try {
        window.sessionStorage.setItem(modelListCacheKey, JSON.stringify({ models: payload.models }));
      } catch {
        // The list is refetched next time.
      }
    } catch (error) {
      setModelListError(error instanceof Error ? error.message : "OpenRouter's model list is unavailable.");
    }
  }, []);

  useEffect(() => {
    void checkStatus();
    void loadModelOptions();
  }, [checkStatus, loadModelOptions]);

  function saveResearch(nextEffort: ResearchEffortStep, drafts: ModelDrafts) {
    const models: ResearchModelPreferences = {};
    for (const { role } of modelRoles) {
      const id = normalizeModelId(drafts[role]);
      if (id) models[role] = id;
    }
    try {
      window.localStorage.setItem(researchPreferencesStorageKey, JSON.stringify({ effort: nextEffort, models }));
    } catch {
      // Settings still apply until this page reloads.
    }
  }

  function updateModel(role: ResearchModelRole, value: string) {
    const drafts = { ...modelDrafts, [role]: value };
    setModelDrafts(drafts);
    saveResearch(researchEffort, drafts);
  }

  function chooseEffort(step: ResearchEffortStep) {
    setResearchEffort(step);
    saveResearch(step, modelDrafts);
  }

  const serverModel = backendStatus?.openrouter.model;

  function placeholderFor(role: ResearchModelRole) {
    if (role !== "reviewer" && serverModel) return `Server default · ${serverModel}`;
    return "Server default";
  }

  function noteFor(role: ResearchModelRole): { kind: "error" | "warning"; text: string } | null {
    const draft = modelDrafts[role].trim();
    if (!draft) return null;
    if (!normalizeModelId(draft)) return { kind: "error", text: "Use provider/model, for example openai/gpt-4o-mini." };
    if (modelOptions.length && !modelOptions.some((option) => option.id === draft)) {
      return { kind: "warning", text: "Not in OpenRouter's current model list." };
    }
    if (role === "reviewer") {
      const reader = normalizeModelId(modelDrafts.reader) || serverModel;
      if (reader && modelFamily(reader) === modelFamily(draft)) {
        return { kind: "warning", text: "Same model family as the reader, so the review is less independent." };
      }
    }
    return null;
  }

  const services = [
    { label: "Astra", status: backendStatus?.astra },
    { label: "OpenRouter", status: backendStatus?.openrouter },
  ];
  const problems = services.filter((service) => service.status && service.status.state !== "healthy");

  return (
    <div className="settings-panel" role="dialog" aria-label="Settings">
      <div className="settings-heading">
        <strong>Settings</strong>
        <button type="button" className="icon-button" aria-label="Close settings" data-tooltip="Close" onClick={onClose}>×</button>
      </div>

      <div className="settings-status" aria-live="polite">
        <div className="settings-status-row">
          {services.map(({ label, status }) => (
            <span className={`settings-status-item ${checking ? "checking" : status?.state ?? ""}`} key={label}>
              <i aria-hidden="true" />
              {label} {checking ? "checking" : status ? statusLabels[status.state] : "not checked"}
            </span>
          ))}
          <button type="button" className="settings-status-refresh" onClick={() => { void checkStatus(); }} disabled={checking}>
            {checking ? "Checking" : "Recheck"}
          </button>
        </div>
        {!checking && problems.map(({ label, status }) => (
          <small className="settings-status-detail" key={label}>{label}: {status?.message}</small>
        ))}
        {statusError && <small className="settings-status-detail">{statusError}</small>}
      </div>

      <fieldset className="settings-group">
        <legend>Models</legend>
        {modelRoles.map(({ role, label, hint }) => {
          const note = noteFor(role);
          const noteId = `settings-model-${role}-note`;
          return (
            <label className="settings-model" key={role}>
              <span>{label}<small>{hint}</small></span>
              <input
                type="text"
                list="openrouter-model-options"
                value={modelDrafts[role]}
                placeholder={placeholderFor(role)}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={note?.kind === "error" ? true : undefined}
                aria-describedby={note ? noteId : undefined}
                onChange={(event) => updateModel(role, event.target.value)}
              />
              {note && <small className={`settings-model-note ${note.kind}`} id={noteId}>{note.text}</small>}
            </label>
          );
        })}
        <datalist id="openrouter-model-options">
          {modelOptions.map((option) => (
            <option key={option.id} value={option.id} label={modelOptionLabel(option)} />
          ))}
        </datalist>
        {modelListError && <small className="settings-model-note warning">{modelListError} Any provider/model id still works.</small>}
      </fieldset>

      <fieldset className="settings-group">
        <legend>Research effort</legend>
        <div className="settings-steps">
          {researchEffortSteps.map((step) => (
            <label className={researchEffort === step ? "active" : ""} key={step}>
              <input
                type="radio"
                name="research-effort"
                value={step}
                checked={researchEffort === step}
                onChange={() => chooseEffort(step)}
              />
              <span>{researchBudgetProfiles[step].label}</span>
            </label>
          ))}
        </div>
        <small className="settings-steps-summary">
          {researchBudgetProfiles[researchEffort].summary} Every run stops at ${researchRunCapUsd}.
        </small>
      </fieldset>

      <label className="settings-group settings-effort">
        <span>Decompose and brief effort</span>
        <select
          className="settings-select"
          value={effort}
          onChange={(event) => onEffortChange(normalizeThinkingEffort(event.target.value))}
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
      <p className="settings-footnote">Saved in this browser.</p>
    </div>
  );
}
