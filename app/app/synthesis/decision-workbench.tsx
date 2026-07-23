"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  agentPromptStorageKey,
  sanitizeAgentPromptOverrides,
  type AgentPromptOverrides,
} from "../../lib/agent-prompts";
import type { DecisionSynthesis } from "../../lib/decision-synthesis";
import {
  researchBriefSchema,
  researchBriefStorageKey,
  type ResearchBrief,
} from "../../lib/research-brief";

type ArtifactSummary = {
  contractVersion: "live-artifact.v1";
  generatedAt: string;
  caseId: string;
  status: {
    phase: string;
    label: string;
    reasons: string[];
    isStale: boolean;
  };
  counts: {
    claimFrames: number;
    missingClaims: number;
    sources: number;
    results: number;
    evidenceRelations: number;
    dependenceGroups: number;
  };
  latestEvidenceAt: string | null;
  latestEvidenceSnapshot: { id: string; createdAt: string } | null;
  latestDecision: {
    id: string;
    status: string;
    isStale: boolean;
    staleReasons: string[];
  } | null;
  integrityWarnings: string[];
  graph: {
    claimFrames: Array<{ id: string; statement: string }>;
    sources: Array<{ id: string; title: string; canonicalUrl: string | null }>;
    results: Array<{ id: string; resultText: string; dependenceGroupId: string }>;
    evidenceRelations: Array<{ id: string; resultId: string; claimFrameId: string }>;
    dependenceGroups: Array<{ id: string; label: string; reason: string }>;
  };
};

type StoredDecision = {
  caseId: string;
  decision?: {
    id: string;
    status: string;
    graphSnapshotId: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  decisionId?: string;
  graphSnapshotId?: string;
  evidenceVersion?: string;
  model?: string;
  createdAt?: string;
  synthesis?: DecisionSynthesis | null;
  cache?: {
    status: "hit" | "miss" | "bypass";
    createdAt: string;
    expiresAt: string | null;
  };
  error?: string;
};

type Preferences = {
  apiKey?: string;
  model?: string;
};

type LoadState =
  | { status: "loading"; message: string }
  | { status: "ready"; message: string }
  | { status: "empty"; message: string }
  | { status: "error"; message: string };

const waitingSteps = [
  "reading accepted result records",
  "grouping correlated evidence",
  "checking option coverage",
  "separating applicability from truth",
  "finding load-bearing cruxes",
  "testing decision-flip conditions",
  "drafting a reversible observation",
];

function getSession() {
  if (typeof window === "undefined") {
    return {
      caseId: "",
      brief: null as ResearchBrief | null,
      preferences: {} as Preferences,
      promptOverrides: {} as AgentPromptOverrides,
    };
  }
  const queryCaseId = new URLSearchParams(window.location.search).get("caseId");
  let brief: ResearchBrief | null = null;
  let workspaceCaseId: string | null = null;
  let preferences: Preferences = {};
  let promptOverrides: AgentPromptOverrides = {};
  try {
    const parsed = researchBriefSchema.safeParse(
      JSON.parse(window.localStorage.getItem(researchBriefStorageKey) || "null"),
    );
    if (parsed.success) brief = parsed.data;
  } catch {
    // The missing-brief state below explains how to recover.
  }
  try {
    const workspace = JSON.parse(window.localStorage.getItem("epistack:workspace:v1") || "{}") as {
      result?: { caseId?: string } | null;
    };
    workspaceCaseId = workspace.result?.caseId || null;
  } catch {
    // Query and brief identifiers remain available.
  }
  try {
    preferences = JSON.parse(window.localStorage.getItem("epistack:preferences:v1") || "{}") as Preferences;
  } catch {
    preferences = {};
  }
  try {
    promptOverrides = sanitizeAgentPromptOverrides(
      JSON.parse(window.localStorage.getItem(agentPromptStorageKey) || "{}"),
    );
  } catch {
    promptOverrides = {};
  }
  const caseId = queryCaseId || brief?.caseId || workspaceCaseId || "";
  return {
    caseId,
    brief: brief?.caseId === caseId ? brief : null,
    preferences,
    promptOverrides,
  };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function cacheLabel(cache: StoredDecision["cache"]) {
  if (!cache) return "persisted decision";
  if (cache.status === "hit") return "reused · no model call";
  if (cache.status === "bypass") return "recomputed live";
  return "fresh synthesis";
}

export function DecisionWorkbench() {
  const [session, setSession] = useState<ReturnType<typeof getSession> | null>(null);
  const caseId = session?.caseId ?? "";
  const brief = session?.brief ?? null;
  const preferences = session?.preferences ?? {};
  const promptOverrides = session?.promptOverrides ?? {};
  const [artifact, setArtifact] = useState<ArtifactSummary | null>(null);
  const [decision, setDecision] = useState<StoredDecision | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading", message: "Loading the accepted evidence basis…" });
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [waitingStep, setWaitingStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSession(getSession()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadCurrent = useCallback(async () => {
    if (!caseId) {
      setArtifact(null);
      setDecision(null);
      setLoad({ status: "empty", message: "No active case identity was found. Start with a question before synthesizing a decision." });
      return;
    }
    setLoad({ status: "loading", message: "Loading the accepted evidence basis…" });
    try {
      const [artifactResponse, decisionResponse] = await Promise.all([
        fetch(`/api/artifact?caseId=${encodeURIComponent(caseId)}`, { cache: "no-store" }),
        fetch(`/api/synthesize?caseId=${encodeURIComponent(caseId)}`, { cache: "no-store" }),
      ]);
      const artifactPayload = await artifactResponse.json().catch(() => null) as ArtifactSummary | { error?: { message?: string } | string } | null;
      if (!artifactResponse.ok || !artifactPayload || !("contractVersion" in artifactPayload)) {
        const rawError = artifactPayload && "error" in artifactPayload ? artifactPayload.error : null;
        const message = typeof rawError === "string" ? rawError : rawError?.message;
        throw new Error(message || "The accepted evidence graph could not be loaded.");
      }
      const decisionPayload = await decisionResponse.json().catch(() => null) as StoredDecision | null;
      setArtifact(artifactPayload);
      if (!decisionResponse.ok) {
        const message = typeof decisionPayload?.error === "string"
          ? decisionPayload.error
          : "The accepted graph loaded, but its recorded decision could not be read.";
        throw new Error(message);
      }
      setDecision(decisionPayload?.synthesis ? decisionPayload : null);
      if (artifactPayload.counts.results === 0) {
        setLoad({ status: "empty", message: "No accepted result-level evidence exists yet." });
      } else {
        setLoad({ status: "ready", message: artifactPayload.status.label });
      }
    } catch (error) {
      setLoad({
        status: "error",
        message: error instanceof Error ? error.message : "The decision basis could not be loaded.",
      });
    }
  }, [caseId]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => void loadCurrent(), 0);
    return () => window.clearTimeout(timer);
  }, [loadCurrent, session]);

  useEffect(() => {
    if (!isSynthesizing) return;
    const started = window.performance.now();
    const stepTimer = window.setInterval(
      () => setWaitingStep((current) => (current + 1) % waitingSteps.length),
      2800,
    );
    const elapsedTimer = window.setInterval(
      () => setElapsed(window.performance.now() - started),
      200,
    );
    return () => {
      window.clearInterval(stepTimer);
      window.clearInterval(elapsedTimer);
    };
  }, [isSynthesizing]);

  async function synthesize(refresh = false) {
    if (!brief) {
      setLoad({ status: "error", message: "Return to Contextualize and compile the human-edited action space before synthesis." });
      return;
    }
    setIsSynthesizing(true);
    setWaitingStep(0);
    setElapsed(0);
    setLoad({ status: "ready", message: "Synthesizing a conditional action from accepted evidence…" });
    try {
      const response = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          researchBrief: brief,
          openRouterApiKey: preferences.apiKey,
          openRouterModel: preferences.model,
          promptOverrides,
          refresh,
        }),
      });
      const payload = await response.json().catch(() => null) as StoredDecision | null;
      if (!response.ok || !payload?.synthesis) {
        throw new Error(payload?.error || "The selected model did not return a valid decision synthesis.");
      }
      setDecision(payload);
      await loadCurrent();
      setDecision(payload);
      setLoad({ status: "ready", message: "Decision synthesized and bound to its accepted-evidence version." });
    } catch (error) {
      setLoad({
        status: "error",
        message: error instanceof Error ? error.message : "The decision could not be synthesized.",
      });
    } finally {
      setIsSynthesizing(false);
    }
  }

  const synthesis = decision?.synthesis ?? null;
  const resultById = useMemo(
    () => new Map(artifact?.graph.results.map((result) => [result.id, result]) ?? []),
    [artifact],
  );
  const familyById = useMemo(
    () => new Map(artifact?.graph.dependenceGroups.map((family) => [family.id, family]) ?? []),
    [artifact],
  );
  const stale = artifact?.latestDecision?.isStale === true
    || artifact?.status.isStale === true
    || artifact?.latestDecision?.status === "stale";
  const canSynthesize = Boolean(
    caseId
    && brief
    && artifact
    && artifact.counts.results > 0
    && artifact.integrityWarnings.length === 0
    && load.status !== "error"
    && !isSynthesizing,
  );

  function exportPrivate() {
    if (!artifact || !synthesis) return;
    downloadJson(`epistack-${caseId}-private.json`, {
      contractVersion: "epistack-private-decision-bundle.v1",
      warning: "Contains local stakeholder context and a personalized decision. Keep private unless manually reviewed.",
      exportedAt: new Date().toISOString(),
      researchBrief: brief,
      artifact,
      decision,
    });
  }

  function exportShareable() {
    if (!artifact || !synthesis) return;
    downloadJson(`epistack-${caseId}-shareable-evidence.json`, {
      contractVersion: "epistack-redacted-evidence-bundle.v1",
      warning: "Automatic redaction removes the stakeholder profile and recommendation, but claim text, excerpts, and source metadata still require human review before sharing.",
      exportedAt: new Date().toISOString(),
      evidenceVersion: decision?.evidenceVersion,
      graph: artifact.graph,
      decisionStructure: {
        loadBearingResultIds: synthesis.loadBearingResultIds,
        loadBearingFamilyIds: synthesis.loadBearingFamilyIds,
        cruxes: synthesis.cruxes,
        missingEvidence: synthesis.missingEvidence,
        stabilityTests: {
          survives: synthesis.stability.survives,
          flipsUnder: synthesis.stability.flipsUnder,
        },
        observationCannotEstablish: synthesis.observationProtocol.cannotEstablish,
      },
      removed: ["case prompt", "stakeholder profile", "values", "constraints", "recommendation", "action descriptions"],
    });
  }

  return (
    <section className="decision-workbench live-decision-workbench" aria-labelledby="decision-workbench-title">
      <header>
        <div>
          <span>Accepted graph → contextualized action</span>
          <h2 id="decision-workbench-title">{brief?.actionSpace.decision || "Compile a decision from the evidence artifact."}</h2>
          <p>{brief?.actionSpace.decisionHorizon || "The decision horizon will come from Contextualize."}</p>
        </div>
        <div className="decision-basis-count">
          <b>{artifact?.counts.results ?? 0}</b><span>results</span>
          <b>{artifact?.counts.dependenceGroups ?? 0}</b><span>families</span>
          <b>{artifact?.counts.missingClaims ?? 0}</b><span>uncovered claims</span>
        </div>
      </header>

      <div className={`decision-runtime-state ${load.status}`}>
        <span aria-hidden="true">{load.status === "error" ? "!" : load.status === "empty" ? "○" : "●"}</span>
        <div>
          <strong>{load.message}</strong>
          {artifact?.latestEvidenceSnapshot && (
            <small>Evidence basis {artifact.latestEvidenceSnapshot.id} · {formatDate(artifact.latestEvidenceSnapshot.createdAt)}</small>
          )}
        </div>
        {load.status === "error" && /key|model|credit/i.test(load.message) && <Link href="/?settings=1">Open Settings</Link>}
      </div>

      {!brief && (
        <div className="decision-prerequisite">
          <div>
            <span>Human context missing</span>
            <strong>Synthesis will not infer your action space from evidence.</strong>
            <p>Return to Contextualize, prune the interpretation map, and compile the realistic options and constraints for this case.</p>
          </div>
          <Link className="primary-button" href="/map">Contextualize first</Link>
        </div>
      )}

      {stale && (
        <div className="decision-stale-alert">
          <strong>This decision is stale.</strong>
          <span>Accepted evidence changed after its recorded basis. Re-synthesize to see whether the action survives.</span>
        </div>
      )}

      {artifact && artifact.integrityWarnings.length > 0 && (
        <div className="decision-integrity-alert" role="alert">
          <div>
            <strong>Synthesis is paused for this degraded artifact.</strong>
            <span>Resolve the stored-data integrity warnings before asking a model to turn this graph into an action.</span>
          </div>
          <details>
            <summary>Inspect {artifact.integrityWarnings.length} {artifact.integrityWarnings.length === 1 ? "warning" : "warnings"}</summary>
            <ul>{artifact.integrityWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </details>
        </div>
      )}

      <div className="decision-synthesis-actions">
        <button className="primary-button" onClick={() => synthesize(false)} disabled={!canSynthesize}>
          {isSynthesizing ? "Synthesizing…" : synthesis ? "Re-run from current evidence" : "Synthesize decision"}
        </button>
        {synthesis && (
          <button className="cache-refresh-button" onClick={() => synthesize(true)} disabled={!canSynthesize}>
            Bypass cache
          </button>
        )}
        <span>Only accepted D1 result records are sent to this specialist. Discovery leads remain outside.</span>
      </div>

      {isSynthesizing && (
        <div className="decision-agent-progress" aria-live="polite">
          <i aria-hidden="true" />
          <div>
            <strong>{waitingSteps[waitingStep]}…</strong>
            <small>{Math.floor(elapsed / 1000)}s elapsed · one specialist, with one contract-repair attempt if needed</small>
          </div>
        </div>
      )}

      {synthesis && (
        <>
          <article className={`computed-decision stance-${synthesis.recommendation.stance}`} aria-live="polite">
            <div className="decision-version-line">
              <span>{synthesis.recommendation.stance.replaceAll("-", " ")}</span>
              <small>{cacheLabel(decision?.cache)} · {decision?.model || "model not recorded"}</small>
            </div>
            <h3>{synthesis.recommendation.headline}</h3>
            <p>{synthesis.recommendation.action}</p>
            <div className="decision-broad-applicable">
              <strong>Broad evidence vs. this decision</strong>
              <span>{synthesis.broadVsApplicable}</span>
            </div>
          </article>

          <section className="decision-option-grid" aria-labelledby="decision-options-title">
            <header>
              <span>Options × outcomes</span>
              <h3 id="decision-options-title">No result count becomes a vote.</h3>
            </header>
            <div>
              {synthesis.options.map((option) => (
                <article key={option.optionId}>
                  <div><span>{option.feasibility.replaceAll("-", " ")}</span><strong>{option.label}</strong></div>
                  {option.outcomeReads.map((outcome) => (
                    <section key={`${option.optionId}-${outcome.outcome}`}>
                      <header><b>{outcome.outcome}</b><span className={`decision-direction ${outcome.direction}`}>{outcome.direction.replaceAll("-", " ")}</span></header>
                      <p>{outcome.interpretation}</p>
                      <small>{outcome.applicabilityCaveat}</small>
                      <div className="decision-basis-links">
                        {outcome.basisResultIds.length
                          ? outcome.basisResultIds.map((id) => (
                              <a href={`/artifact?caseId=${encodeURIComponent(caseId)}#${encodeURIComponent(id)}`} key={id} title={resultById.get(id)?.resultText || id}>
                                {id}
                              </a>
                            ))
                          : <em>no accepted result cited</em>}
                      </div>
                    </section>
                  ))}
                  {option.tradeoffs.length > 0 && <footer>{option.tradeoffs.map((tradeoff) => <span key={tradeoff}>{tradeoff}</span>)}</footer>}
                </article>
              ))}
            </div>
          </section>

          <div className="decision-audit-grid">
            <section>
              <span>Load-bearing results</span>
              <h3>These IDs carry the action.</h3>
              <div className="decision-id-list">
                {synthesis.loadBearingResultIds.map((id) => (
                  <a href={`/artifact?caseId=${encodeURIComponent(caseId)}#${encodeURIComponent(id)}`} key={id}>
                    <strong>{id}</strong>
                    <small>{resultById.get(id)?.resultText || "Open in artifact"}</small>
                  </a>
                ))}
              </div>
            </section>
            <section>
              <span>Dependence families</span>
              <h3>Correlated results stay bundled.</h3>
              <div className="decision-family-list">
                {synthesis.loadBearingFamilyIds.map((id) => (
                  <article key={id}>
                    <strong>{familyById.get(id)?.label || id}</strong>
                    <small>{familyById.get(id)?.reason || "Dependence rationale not loaded."}</small>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="decision-crux-grid">
            <header><span>Cruxes and flip tests</span><h3>What should we look at next?</h3></header>
            <div>
              {synthesis.cruxes.map((crux) => (
                <article key={crux.question}>
                  <span>{crux.resolvability.replaceAll("-", " ")}</span>
                  <strong>{crux.question}</strong>
                  <p>{crux.whyItMatters}</p>
                  <small>Would flip if: {crux.wouldFlipDecisionIf}</small>
                </article>
              ))}
            </div>
          </section>

          <div className="decision-separation-grid">
            <section>
              <span>Human supplied</span>
              <ul>{synthesis.valuesAndConstraints.humanSupplied.map((value) => <li key={value}>{value}</li>)}</ul>
            </section>
            <section>
              <span>Model assumptions</span>
              <ul>{synthesis.valuesAndConstraints.modelAssumptions.length
                ? synthesis.valuesAndConstraints.modelAssumptions.map((value) => <li key={value}>{value}</li>)
                : <li>No additional model assumptions were recorded.</li>}</ul>
            </section>
            <section>
              <span>Decision stability · {synthesis.stability.label.replaceAll("-", " ")}</span>
              <strong>Survives</strong>
              <ul>{synthesis.stability.survives.map((value) => <li key={value}>{value}</li>)}</ul>
              <strong>Flips under</strong>
              <ul>{synthesis.stability.flipsUnder.map((value) => <li key={value}>{value}</li>)}</ul>
            </section>
          </div>

          <section className="decision-missing-grid">
            <header><span>Missing evidence</span><h3>Absence is not reassurance.</h3></header>
            <div>
              {synthesis.missingEvidence.map((item) => (
                <article key={item.gap}>
                  <strong>{item.gap}</strong>
                  <p>{item.whyDecisionRelevant}</p>
                  <small>Next collection action: {item.nextAction}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="protocol-draft live-protocol">
            <div>
              <span>Proposed personal observation · Not evidence yet</span>
              <h3>{synthesis.observationProtocol.title}</h3>
              <p>{synthesis.observationProtocol.purpose}</p>
              <small>{synthesis.observationProtocol.duration}</small>
            </div>
            <dl>
              <div><dt>Measure</dt><dd>{synthesis.observationProtocol.measurements.join(" · ")}</dd></div>
              <div><dt>Stop when</dt><dd>{synthesis.observationProtocol.stoppingConditions.join(" · ") || "No stopping condition recorded."}</dd></div>
              <div><dt>Cannot establish</dt><dd>{synthesis.observationProtocol.cannotEstablish.join(" · ")}</dd></div>
            </dl>
          </section>

          <section className="decision-export">
            <div>
              <span>Compounding artifact</span>
              <strong>Export the private decision or a stripped evidence bundle.</strong>
              <small>Automatic redaction is a first pass. Inspect claim text, excerpts, and metadata before sharing.</small>
            </div>
            <button onClick={exportPrivate}>Export private JSON</button>
            <button onClick={exportShareable}>Export shareable skeleton</button>
          </section>
        </>
      )}
    </section>
  );
}
