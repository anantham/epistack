"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  agentPromptDefinitions,
  agentPromptPhases,
  agentPromptRuntimeLabels,
  agentPromptStorageKey,
  sanitizeAgentPromptOverrides,
  type AgentPromptId,
  type AgentPromptOverrides,
} from "../../lib/agent-prompts";
import {
  decompositionBrowserCacheStorageKey,
  legacyDecompositionBrowserCacheStorageKey,
} from "../../lib/decomposition-cache";

type PromptDraft = {
  instructions: string;
  taskTemplate: string;
  repairTemplate: string;
};

type PromptDrafts = Record<AgentPromptId, PromptDraft>;

function defaultDrafts(): PromptDrafts {
  return Object.fromEntries(agentPromptDefinitions.map((definition) => [definition.id, {
    instructions: definition.instructions,
    taskTemplate: definition.taskTemplate,
    repairTemplate: definition.repairTemplate ?? "",
  }])) as PromptDrafts;
}

function variableNames(template: string) {
  return Array.from(new Set([...template.matchAll(/\{\{([a-zA-Z0-9]+)\}\}/g)].map((match) => match[1])));
}

export default function PromptLabPage() {
  const [drafts, setDrafts] = useState<PromptDrafts>(defaultDrafts);
  const [activeId, setActiveId] = useState<AgentPromptId>(agentPromptDefinitions[0].id);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const overrides = sanitizeAgentPromptOverrides(JSON.parse(window.localStorage.getItem(agentPromptStorageKey) || "{}"));
        setDrafts(Object.fromEntries(agentPromptDefinitions.map((definition) => {
          const override = overrides[definition.id] ?? {};
          return [definition.id, {
            instructions: override.instructions ?? definition.instructions,
            taskTemplate: override.taskTemplate ?? definition.taskTemplate,
            repairTemplate: override.repairTemplate ?? definition.repairTemplate ?? "",
          }];
        })) as PromptDrafts);
      } catch {
        setSaveState("error");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const activeDefinition = agentPromptDefinitions.find((definition) => definition.id === activeId) ?? agentPromptDefinitions[0];
  const activeDraft = drafts[activeDefinition.id];
  const changedIds = useMemo(() => new Set(agentPromptDefinitions
    .filter((definition) => {
      const draft = drafts[definition.id];
      return draft.instructions !== definition.instructions
        || draft.taskTemplate !== definition.taskTemplate
        || draft.repairTemplate !== (definition.repairTemplate ?? "");
    })
    .map((definition) => definition.id)), [drafts]);
  const placeholders = variableNames(activeDraft.taskTemplate);

  function updateDraft(field: keyof PromptDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [activeId]: { ...current[activeId], [field]: value },
    }));
    setSaveState("idle");
  }

  function restoreSelected() {
    setDrafts((current) => ({
      ...current,
      [activeId]: {
        instructions: activeDefinition.instructions,
        taskTemplate: activeDefinition.taskTemplate,
        repairTemplate: activeDefinition.repairTemplate ?? "",
      },
    }));
    setSaveState("idle");
  }

  function restoreAll() {
    setDrafts(defaultDrafts());
    setSaveState("idle");
  }

  function savePrompts() {
    if (agentPromptDefinitions.some((definition) => {
      const draft = drafts[definition.id];
      return !draft.instructions.trim()
        || !draft.taskTemplate.trim()
        || (definition.repairTemplate !== undefined && !draft.repairTemplate.trim());
    })) {
      setSaveState("error");
      return;
    }
    const overrides: AgentPromptOverrides = {};
    for (const definition of agentPromptDefinitions) {
      const draft = drafts[definition.id];
      const override: NonNullable<AgentPromptOverrides[AgentPromptId]> = {};
      if (draft.instructions !== definition.instructions) override.instructions = draft.instructions;
      if (draft.taskTemplate !== definition.taskTemplate) override.taskTemplate = draft.taskTemplate;
      if (draft.repairTemplate !== (definition.repairTemplate ?? "")) override.repairTemplate = draft.repairTemplate;
      if (Object.keys(override).length) overrides[definition.id] = override;
    }
    try {
      window.localStorage.setItem(agentPromptStorageKey, JSON.stringify(overrides));
      window.localStorage.removeItem("epistack:decomposition-operation-cache:v2");
      window.localStorage.removeItem(legacyDecompositionBrowserCacheStorageKey);
      window.localStorage.removeItem(decompositionBrowserCacheStorageKey);
      window.localStorage.removeItem("epistack:research-ui-cache:v1");
      window.localStorage.removeItem("epistack:research-ui-cache:v2");
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <main className="prompt-lab-page">
      <header className="prompt-lab-topbar">
        <Link className="prompt-lab-brand" href="/">epistack</Link>
        <Link className="prompt-lab-close" href="/">← Back to question</Link>
      </header>

      <section className="prompt-lab-hero">
        <div>
          <span className="eyebrow">Settings · Prompt transparency</span>
          <h1>Prompt Lab</h1>
          <p>Inspect the actual instructions and runtime envelopes sent to each AI specialist, grouped in pipeline order. Edits are device-local and take effect on the next model call.</p>
        </div>
        <div className="prompt-lab-summary">
          <strong>{agentPromptDefinitions.length}</strong>
          <span>model prompts</span>
          <small>{changedIds.size ? `${changedIds.size} modified locally` : "defaults active"}</small>
        </div>
      </section>

      <section className="prompt-lab-workspace">
        <nav className="prompt-agent-index" aria-label="AI agent prompts">
          <header>
            <span>Pipeline order</span>
            <small>Grouped by phase. Select an agent to inspect its contract.</small>
          </header>
          {agentPromptPhases.map((phase) => (
            <section className="prompt-phase-group" key={phase.id} aria-label={`${phase.label} phase`}>
              <div className="prompt-phase-heading">
                <span>{phase.label}</span>
                <small>{phase.blurb}</small>
              </div>
              {agentPromptDefinitions.filter((definition) => definition.phase === phase.id).map((definition) => (
                <button
                  type="button"
                  className={definition.id === activeId ? "active" : ""}
                  aria-current={definition.id === activeId ? "true" : undefined}
                  onClick={() => setActiveId(definition.id)}
                  key={definition.id}
                >
                  <b>{String(agentPromptDefinitions.indexOf(definition) + 1).padStart(2, "0")}</b>
                  <span><strong>{definition.name}</strong><small>{agentPromptRuntimeLabels[definition.runtime]}</small></span>
                  <i className={changedIds.has(definition.id) ? "modified" : ""} aria-label={changedIds.has(definition.id) ? "Modified" : "Using default"} />
                </button>
              ))}
            </section>
          ))}
          <div className="prompt-index-note">
            <strong>What is not here?</strong>
            <p>PubMed/PMC retrieval, hashing, literal passage checks, schema validation, and promotion adjudication are deterministic code rather than model instructions.</p>
            <p><strong>Hosted</strong> prompts run through this site&rsquo;s server routes. <strong>Local companion</strong> prompts run only when you start the Claude Code companion (<code>npm run agents</code>).</p>
          </div>
        </nav>

        <article className="prompt-editor">
          <header className="prompt-editor-heading">
            <div>
              <span>{activeDefinition.stage}</span>
              <h2>{activeDefinition.name}</h2>
              <p>{activeDefinition.description}</p>
            </div>
            <button type="button" onClick={restoreSelected} disabled={!changedIds.has(activeId)}>Restore this prompt</button>
          </header>

          <dl className="prompt-agent-contract">
            <div><dt>Role</dt><dd>{activeDefinition.role}</dd></div>
            <div><dt>Structured output</dt><dd>{activeDefinition.outputContract}</dd></div>
            <div><dt>Runtime</dt><dd>{agentPromptRuntimeLabels[activeDefinition.runtime]}</dd></div>
            <div><dt>Temperature</dt><dd>{activeDefinition.temperature}</dd></div>
            <div><dt>Token ceiling</dt><dd>{activeDefinition.maxOutputTokens.toLocaleString()}</dd></div>
          </dl>

          <label className="prompt-field">
            <span><strong>System instructions</strong><small>Stable role, epistemic rules, and failure boundaries.</small></span>
            <textarea value={activeDraft.instructions} onChange={(event) => updateDraft("instructions", event.target.value)} rows={18} spellCheck={false} />
            <em>{activeDraft.instructions.length.toLocaleString()} characters</em>
          </label>

          <label className="prompt-field">
            <span><strong>Runtime task template</strong><small>Dynamic case data is inserted only at the named placeholders.</small></span>
            <textarea value={activeDraft.taskTemplate} onChange={(event) => updateDraft("taskTemplate", event.target.value)} rows={10} spellCheck={false} />
            <div className="prompt-placeholders">
              <span>Inputs</span>
              {placeholders.map((placeholder) => <code key={placeholder}>{`{{${placeholder}}}`}</code>)}
            </div>
          </label>

          {activeDefinition.repairTemplate !== undefined && (
            <label className="prompt-field">
              <span><strong>Validation-repair template</strong><small>Used only when the first structured response fails validation.</small></span>
              <textarea value={activeDraft.repairTemplate} onChange={(event) => updateDraft("repairTemplate", event.target.value)} rows={6} spellCheck={false} />
            </label>
          )}

          <footer className="prompt-savebar">
            <div>
              <strong>{saveState === "saved" ? "Saved for future model calls" : saveState === "error" ? "Every prompt field must contain instructions" : "Unsaved edits stay in this page"}</strong>
              <small>Saving clears browser-restored model outputs. Shared cache identity includes the exact prompt overrides.</small>
            </div>
            <button type="button" className="quiet-button" onClick={restoreAll} disabled={changedIds.size === 0}>Restore all</button>
            <button type="button" className="primary-button" onClick={savePrompts}>Save prompt configuration</button>
          </footer>
        </article>
      </section>
    </main>
  );
}
