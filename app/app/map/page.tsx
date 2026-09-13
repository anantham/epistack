"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  decompositionSessionKey,
  type DecompositionResponse,
  type DecompositionCluster
} from "../../lib/decomposition";
import {
  completeDimensionRoles,
  researchBriefStorageKey,
  type ContextualizationEntry,
  type ResearchBrief,
  type ResearchClaimFrame
} from "../../lib/research-brief";
import {
  agentPromptStorageKey,
  sanitizeAgentPromptOverrides
} from "../../lib/agent-prompts";
import { runHostedDecomposition } from "../../lib/hosted-decomposition-client";
import {
  appendBriefTelemetryRun,
  briefTelemetryStorageKey,
  emptyBriefTelemetry,
  parseBriefTelemetry,
  summarizeBriefTelemetry,
  type BriefTelemetry
} from "../../lib/brief-telemetry";
import { formatDuration } from "../../lib/decomposition-telemetry";
import { CaseHeader } from "../components/case-navigation";
import { BackendSettings, normalizeThinkingEffort, preferencesStorageKey, readPreferredEffort, type ThinkingEffort } from "../components/backend-settings";

const editableClaimFields = [
  "shortLabel",
  "statement",
  "population",
  "exposure",
  "comparator",
  "outcome",
  "timeHorizon",
  "modality",
  "decisionLeverage"
] as const;

type EditableClaimField = (typeof editableClaimFields)[number];

const claimFieldLabels: Record<EditableClaimField, string> = {
  shortLabel: "Short label",
  statement: "Statement",
  population: "Population",
  exposure: "Exposure / action",
  comparator: "Comparator",
  outcome: "Outcome",
  timeHorizon: "Time horizon",
  modality: "Modality",
  decisionLeverage: "Decision leverage"
};

const claimInputStyle = {
  background: "transparent",
  border: 0,
  borderBottom: "1px solid var(--line-dark)",
  borderRadius: 0,
  color: "var(--ink)",
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: 17,
  lineHeight: 1.4,
  outline: "none",
  padding: "8px 2px 10px",
  resize: "vertical" as const,
  width: "100%"
};

const briefCompileStorageKey = "epistack:brief-compile:v1";

type PendingBriefCompile = {
  caseId: string;
  id: string;
  token: string;
  startedAt: number;
  status: "queued" | "completed";
  brief?: ResearchBrief;
};

export default function ContextualizeMap() {
  const router = useRouter();
  
  const [prompt, setPrompt] = useState("");
  const [decisionContext, setDecisionContext] = useState("");
  const [clusters, setClusters] = useState<DecompositionCluster[]>([]);
  const [caseId, setCaseId] = useState("");
  const [caseSummary, setCaseSummary] = useState("");
  const [knownUnknowns, setKnownUnknowns] = useState<string[]>([]);
  const [claimTemplate, setClaimTemplate] = useState("");
  
  const [ready, setReady] = useState(false);
  
  const [elicitationIndex, setElicitationIndex] = useState(0);
  const [contextAnswers, setContextAnswers] = useState<Record<string, string>>({});
  const [contextSelections, setContextSelections] = useState<Record<string, string[]>>({});
  
  const [compileState, setCompileState] = useState<"idle" | "compiling" | "review" | "error">("idle");
  const [compileProgress, setCompileProgress] = useState("");
  const [compileError, setCompileError] = useState("");
  const [compiledBrief, setCompiledBrief] = useState<ResearchBrief | null>(null);
  const [editedClaims, setEditedClaims] = useState<ResearchClaimFrame[]>([]);
  const [recomputing, setRecomputing] = useState(false);
  const [briefTelemetry, setBriefTelemetry] = useState<BriefTelemetry>(emptyBriefTelemetry);
  const [compileElapsed, setCompileElapsed] = useState(0);
  const [preferredEffort, setPreferredEffort] = useState<ThinkingEffort>("instant");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const compileStartedAtRef = useRef(0);
  const briefSummary = useMemo(() => summarizeBriefTelemetry(briefTelemetry), [briefTelemetry]);
  const briefEstimate = briefSummary.byEffort[preferredEffort]?.totalMedianMs ?? briefSummary.totalMedianMs;
  const briefSamples = briefSummary.byEffort[preferredEffort]?.samples ?? briefSummary.samples;
  const briefRemaining = briefEstimate ? Math.max(0, briefEstimate - compileElapsed) : null;

  async function requestCompile(body: unknown) {
    const response = await fetch("/api/compile-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error("The hosted compiler returned an unreadable response.");
    }
    if (!response.ok) throw new Error(data?.error || `The hosted compiler returned HTTP ${response.status}.`);
    return data;
  }

  function finishCompiledBrief(brief: ResearchBrief, startedAt: number, recordTelemetry = true) {
    setCompiledBrief(brief);
    setEditedClaims(brief.claims as ResearchClaimFrame[]);
    setCompileState("review");
    setCompileProgress("Review the compiled claims before starting research");
    setCompileError("");
    if (recordTelemetry) {
      const totalMs = Math.max(0, Date.now() - startedAt);
      setBriefTelemetry((current) => {
        const next = appendBriefTelemetryRun(current, { totalMs, effort: preferredEffort, at: new Date().toISOString() });
        try {
          window.localStorage.setItem(briefTelemetryStorageKey, JSON.stringify(next));
        } catch {
          // Telemetry is an estimate; failing to persist it must not block the run.
        }
        return next;
      });
    }
  }

  async function resumeBriefCompile(receipt: PendingBriefCompile) {
    compileStartedAtRef.current = receipt.startedAt;
    setCompileElapsed(Math.max(0, Date.now() - receipt.startedAt));
    setCompileState("compiling");
    setCompileProgress("Resuming the saved research compiler run");
    setCompileError("");
    if (receipt.status === "completed" && receipt.brief) {
      finishCompiledBrief(receipt.brief, receipt.startedAt, false);
      return;
    }
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
      const result = await requestCompile({ id: receipt.id, token: receipt.token });
      if (result.status === "busy") continue;
      if (result.status === "failed") throw new Error(result.error || "The hosted research compiler failed.");
      if (result.status === "completed") {
        if (!result.brief?.claims?.length) throw new Error("The hosted compiler returned no validated brief.");
        const completed = { ...receipt, status: "completed" as const, brief: result.brief as ResearchBrief };
        try { window.localStorage.setItem(briefCompileStorageKey, JSON.stringify(completed)); } catch { /* best effort */ }
        finishCompiledBrief(completed.brief, receipt.startedAt);
        return;
      }
      setCompileProgress("Compiling the research contract on Astra");
    }
    throw new Error("This compilation is taking longer than expected. Try again to resume the saved run.");
  }

  useEffect(() => {
    const stored = window.localStorage.getItem(decompositionSessionKey) || window.sessionStorage.getItem(decompositionSessionKey);
    if (stored) {
      try {
        const response = JSON.parse(stored) as DecompositionResponse;
        setPrompt(response.prompt);
        setDecisionContext(response.decisionContext ?? "");
        setClusters(response.decomposition.clusters);
        setCaseId(response.caseId);
        setCaseSummary(response.decomposition.summary);
        setKnownUnknowns(response.decomposition.knownUnknowns);
        setClaimTemplate(response.decomposition.claimTemplate);
      } catch (err) {
        console.error("Failed to parse stored decomposition", err);
      }
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !caseId || compileState !== "idle") return;
    try {
      const pending = JSON.parse(window.localStorage.getItem(briefCompileStorageKey) || "null") as PendingBriefCompile | null;
      if (!pending || pending.caseId !== caseId) return;
      const timer = window.setTimeout(() => {
        void resumeBriefCompile(pending).catch((error) => {
          setCompileState("error");
          setCompileProgress("");
          setCompileError(error instanceof Error ? error.message : "An unknown error occurred during compilation.");
        });
      }, 0);
      return () => window.clearTimeout(timer);
    } catch {
      // Ignore malformed saved compile receipts.
    }
  }, [ready, caseId, compileState]);

  useEffect(() => {
    try {
      setBriefTelemetry(parseBriefTelemetry(window.localStorage.getItem(briefTelemetryStorageKey)));
    } catch {
      setBriefTelemetry(emptyBriefTelemetry);
    }
    setPreferredEffort(readPreferredEffort());
    try {
      const saved = JSON.parse(window.sessionStorage.getItem("epistack:contextualize:v1") || "null") as {
        contextAnswers?: Record<string, string>;
        contextSelections?: Record<string, string[]>;
        elicitationIndex?: number;
      } | null;
      if (saved) {
        if (saved.contextAnswers) setContextAnswers(saved.contextAnswers);
        if (saved.contextSelections) setContextSelections(saved.contextSelections);
        if (typeof saved.elicitationIndex === "number") setElicitationIndex(Math.max(0, saved.elicitationIndex));
      }
    } catch {
      // Ignore malformed saved interview state.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(
          "epistack:contextualize:v1",
          JSON.stringify({ contextAnswers, contextSelections, elicitationIndex }),
        );
      } catch {
        // Session persistence is best-effort.
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [contextAnswers, contextSelections, elicitationIndex]);

  useEffect(() => {
    if (compileState !== "compiling") return;
    const timer = window.setInterval(() => {
      setCompileElapsed(Date.now() - (compileStartedAtRef.current || Date.now()));
    }, 500);
    return () => window.clearInterval(timer);
  }, [compileState]);

  async function recomputeQuestions() {
    if (recomputing) return;
    if (!window.confirm("Recompute the decomposition and regenerate the interview questions on Astra?")) return;
    setRecomputing(true);
    setCompileError("");
    try {
      const promptOverrides = sanitizeAgentPromptOverrides(
        JSON.parse(window.localStorage.getItem(agentPromptStorageKey) || "{}"),
      );
      let effort: string | undefined;
      try {
        const prefs = JSON.parse(window.localStorage.getItem("epistack:preferences:v1") || "{}") as { effort?: unknown };
        if (typeof prefs?.effort === "string") effort = prefs.effort;
      } catch {
        // Preference read is best-effort; the server defaults the effort.
      }
      const result = await runHostedDecomposition(
        { question: prompt, decisionContext, promptOverrides, effort },
        `contextualize-recompute:${Date.now()}`,
        true,
        () => {},
      );
      setClusters(result.decomposition.clusters);
      setCaseSummary(result.decomposition.summary);
      setKnownUnknowns(result.decomposition.knownUnknowns);
      setClaimTemplate(result.decomposition.claimTemplate);
      setElicitationIndex(0);
      setContextAnswers({});
      setContextSelections({});
      setCompileState("idle");
      setCompiledBrief(null);
      window.localStorage.setItem(decompositionSessionKey, JSON.stringify(result));
      window.sessionStorage.setItem(decompositionSessionKey, JSON.stringify(result));
    } catch (error) {
      setCompileState("error");
      setCompileError(error instanceof Error ? error.message : "Recompute failed.");
    } finally {
      setRecomputing(false);
    }
  }

  const currentCluster = clusters[elicitationIndex] ?? null;
  const currentContextQuestion = currentCluster?.contextQuestion ?? null;

  function toggleContextOption(questionId: string, option: string) {
    setContextSelections((current) => {
      const selected = current[questionId] ?? [];
      const next = selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option];
      return { ...current, [questionId]: next };
    });
  }

  async function advanceElicitation() {
    if (elicitationIndex < clusters.length - 1) {
      setElicitationIndex((index) => index + 1);
    } else {
      await finalizeAndCompile();
    }
  }
  
  async function finalizeAndCompile() {
    // Collect the context and compile brief
    const additions = clusters.map((cluster) => {
      const q = cluster.contextQuestion;
      if (!q) return null;
      const selected = contextSelections[q.id] ?? [];
      const typed = contextAnswers[q.id]?.trim();
      const answer = Array.from(new Set([...selected, ...(typed ? [typed] : [])])).join("; ");
      if (!answer) return null;
      return `${q.label}: ${answer}`;
    }).filter(Boolean);

    const nextContext = [decisionContext.trim(), ...additions].filter(Boolean).join("\n");
    const contextualization: ContextualizationEntry[] = clusters.map((cluster) => {
      const question = cluster.contextQuestion;
      const selectedValues = contextSelections[question.id] ?? [];
      const typedAnswer = contextAnswers[question.id]?.trim() ?? "";
      const answer = Array.from(new Set([...selectedValues, ...(typedAnswer ? [typedAnswer] : [])]));
      const answerText = answer.length ? answer.join("; ") : "No answer supplied";
      const researchConsequence = question.effect === "prune"
        ? `Narrow retrieval and screening around ${answerText}.`
        : question.effect === "branch"
          ? `Keep separate evidence paths for ${answerText}.`
          : `Use ${answerText} to test whether evidence transfers to this situation.`;
      return {
        axisId: cluster.id,
        label: cluster.label,
        question: question.question,
        whyItMatters: question.whyItMatters,
        effect: question.effect,
        selectedValues,
        typedAnswer,
        researchConsequence,
      };
    });
    setDecisionContext(nextContext);

    function readPromptOverrides() {
      try {
        return sanitizeAgentPromptOverrides(JSON.parse(window.localStorage.getItem(agentPromptStorageKey) || "{}"));
      } catch {
        return {};
      }
    }

    compileStartedAtRef.current = Date.now();
    setCompileElapsed(0);
    setCompileState("compiling");
    setCompileProgress("Preparing the edited scope for the research compiler");
    setCompileError("");
    try {
      const created = await requestCompile({
        caseId,
        originalQuestion: prompt,
        compiledQuestion: prompt, // simplified for now
        decisionContext: nextContext,
        clusters,
        knownUnknowns,
        dimensionRoles: completeDimensionRoles(clusters, {}),
        promptOverrides: readPromptOverrides(),
        contextualization,
      });
      if (!created?.id || !created?.token) throw new Error("The hosted compiler did not return a saved-run receipt.");
      const receipt: PendingBriefCompile = { caseId, id: created.id as string, token: created.token as string, startedAt: compileStartedAtRef.current, status: "queued" };
      try { window.localStorage.setItem(briefCompileStorageKey, JSON.stringify(receipt)); } catch { /* best effort */ }
      const deadline = Date.now() + 30 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const result = await requestCompile(receipt);
        if (result.status === "busy") continue;
        if (result.status === "failed") throw new Error(result.error || "The hosted research compiler failed.");
        if (result.status === "completed") {
          if (!result.brief?.claims?.length) throw new Error("The hosted compiler returned no validated brief.");
          const completed = { ...receipt, status: "completed" as const, brief: result.brief as ResearchBrief };
          try { window.localStorage.setItem(briefCompileStorageKey, JSON.stringify(completed)); } catch { /* best effort */ }
          finishCompiledBrief(completed.brief, receipt.startedAt);
          return;
        }
        setCompileProgress("Compiling the research contract on Astra");
      }
      throw new Error("This compilation is taking longer than expected. Try again to resume the saved run.");
    } catch (error) {
      setCompileState("error");
      setCompileProgress("");
      setCompileError(error instanceof Error ? error.message : "An unknown error occurred during compilation.");
    }
  }

  function updateClaim(index: number, field: EditableClaimField, value: string) {
    setEditedClaims((current) => current.map((claim, claimIndex) => (
      claimIndex === index ? { ...claim, [field]: value } : claim
    )));
  }

  function confirmAndStartResearch() {
    if (!compiledBrief) return;
    const brief: ResearchBrief = { ...compiledBrief, claims: editedClaims };
    window.localStorage.setItem(researchBriefStorageKey, JSON.stringify(brief));
    window.localStorage.removeItem(briefCompileStorageKey);
    window.localStorage.removeItem("epistack:research-ui-cache:v1");
    window.localStorage.removeItem("epistack:research-ui-cache:v2");
    router.push("/research");
  }

  function backToInterview() {
    setCompileState("idle");
    setCompiledBrief(null);
    setEditedClaims([]);
    setCompileProgress("");
    setCompileError("");
  }

  const mapActions = (
    <div className="map-actions">
      <button
        type="button"
        className="icon-button"
        aria-label="Recompute decomposition and questions"
        data-tooltip="Recompute questions"
        disabled={recomputing}
        onClick={() => void recomputeQuestions()}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Settings"
        aria-expanded={settingsOpen}
        data-tooltip="Settings"
        onClick={() => setSettingsOpen((open) => !open)}
      >⚙︎</button>
      <Link className="icon-button" href="/prompts" aria-label="AI agent prompts" data-tooltip="AI agent prompts">✎</Link>
      {settingsOpen && (
        <BackendSettings
          effort={preferredEffort}
          onEffortChange={(next) => {
            const normalized = normalizeThinkingEffort(next);
            setPreferredEffort(normalized);
            try {
              window.localStorage.setItem(preferencesStorageKey, JSON.stringify({ effort: normalized }));
            } catch {
              // Preference persistence is best-effort.
            }
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );

  if (!ready) return null;
  if (!clusters.length) {
    return (
      <main className="case-layout map-layout">
        <div className="case-bounds">
          <p>No clusters found. Please go back and decompose your question first.</p>
        </div>
      </main>
    );
  }
  if (!clusters.some((cluster) => cluster.contextQuestion)) {
    return (
      <main className="case-layout map-layout">
        <CaseHeader active="contextualize" actions={mapActions} />
        <div className="case-bounds">
          <p>
            This saved decomposition has no interview questions — it was created before the Contextualize
            step existed. Go back and re-decompose your question to generate them.
          </p>
          <a className="primary-button" href="/">Back to decomposition</a>
        </div>
      </main>
    );
  }

  return (
    <main className="case-layout map-layout">
      <CaseHeader active="contextualize" actions={mapActions} />
      <div className="case-bounds map-bounds">
        <div className="map-scroll">
          {recomputing && (
            <div className="compile-overlay">
              <div className="ai-orb thinking"><span /></div>
              <h2>Recomputing</h2>
              <p>Regenerating the decomposition and interview questions on Astra…</p>
            </div>
          )}
          {!recomputing && compileState === "idle" && currentContextQuestion && (
            <section className="elicitation-screen" aria-label="Context interview" style={{ position: 'relative', background: 'none' }}>
              <div className="elicitation-card" key={currentContextQuestion.id}>
                <div className="elicitation-meta">
                  <span>{elicitationIndex + 1} / {clusters.length}</span>
                  <button
                    type="button"
                    className="icon-button context-info"
                    aria-label={`Why this question matters: ${currentContextQuestion.whyItMatters}`}
                    data-tooltip={`${currentContextQuestion.effect} · ${currentContextQuestion.whyItMatters}`}
                    title={`${currentContextQuestion.effect}: ${currentContextQuestion.whyItMatters}`}
                  >?</button>
                </div>
                <h1>{currentContextQuestion.question}</h1>
                <div className="context-options" aria-label="Suggested answers; choose any that apply">
                  {currentContextQuestion.options.map((option) => (
                    <button
                      type="button"
                      className={(contextSelections[currentContextQuestion.id] ?? []).includes(option) ? "selected" : ""}
                      key={option}
                      aria-pressed={(contextSelections[currentContextQuestion.id] ?? []).includes(option)}
                      onClick={() => toggleContextOption(currentContextQuestion.id, option)}
                    >{option}</button>
                  ))}
                </div>
                <input
                  type="text"
                  value={contextAnswers[currentContextQuestion.id] ?? ""}
                  onChange={(event) => setContextAnswers((current) => ({ ...current, [currentContextQuestion.id]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") advanceElicitation();
                  }}
                  placeholder="type your answer…"
                  aria-label={currentContextQuestion.question}
                  autoFocus
                />
                <div className="elicitation-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Previous question"
                    disabled={elicitationIndex === 0}
                    onClick={() => setElicitationIndex((index) => Math.max(0, index - 1))}
                  >←</button>
                  <div className="elicitation-dots" aria-hidden="true">
                    {clusters.map((cluster, index) => <i className={index === elicitationIndex ? "active" : ""} key={cluster.id} />)}
                  </div>
                  <button
                    type="button"
                    className="icon-button elicitation-next"
                    aria-label={elicitationIndex === clusters.length - 1 ? "Finish and compile" : "Next question"}
                    onClick={advanceElicitation}
                  >→</button>
                </div>
              </div>
            </section>
          )}

          {compileState === "review" && compiledBrief && (
            <section className="elicitation-screen" aria-label="Review compiled research brief" style={{ position: 'relative', background: 'none' }}>
              <div className="elicitation-card">
                <div className="elicitation-meta">
                  <span>Review · {editedClaims.length} claim{editedClaims.length === 1 ? "" : "s"}</span>
                  <span>{compiledBrief.briefId}</span>
                </div>
                <h1>Confirm the research claims</h1>
                <p className="mode-note" style={{ marginBottom: 28 }}>
                  Edit any claim before the investigation starts. Only the compact shareable search concepts leave this device.
                </p>
                <section className="contextualization-bridge" aria-labelledby="contextualization-bridge-title">
                  <div className="bridge-heading">
                    <span>Contextualization bridge</span>
                    <strong id="contextualization-bridge-title">How your answers changed the investigation</strong>
                  </div>
                  <div className="contextualization-entries">
                    {compiledBrief.contextualization.map((entry) => (
                      <article key={entry.axisId}>
                        <span>{entry.label} · {entry.effect}</span>
                        <p><b>Your answer:</b> {[...entry.selectedValues, entry.typedAnswer].filter(Boolean).join("; ") || "No answer supplied"}</p>
                        <p><b>Research consequence:</b> {entry.researchConsequence}</p>
                      </article>
                    ))}
                  </div>
                </section>
                {editedClaims.map((claim, index) => (
                  <div className="compiled-claim-card" key={claim.id}>
                    <span>Claim {index + 1} · {claim.kind}</span>
                    <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
                      {editableClaimFields.map((field) => (
                        <label
                          key={field}
                          style={{ display: "grid", gap: 4, color: "var(--green)", fontFamily: "var(--font-geist-mono), monospace", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase" }}
                        >
                          {claimFieldLabels[field]}
                          {field === "modality" ? (
                            <select
                              style={claimInputStyle}
                              value={claim.modality}
                              onChange={(event) => updateClaim(index, field, event.target.value)}
                            >
                              <option value="causal">Causal</option>
                              <option value="associational">Associational</option>
                              <option value="descriptive">Descriptive</option>
                            </select>
                          ) : field === "statement" || field === "decisionLeverage" ? (
                            <textarea
                              style={claimInputStyle}
                              rows={field === "statement" ? 3 : 2}
                              value={String(claim[field] ?? "")}
                              onChange={(event) => updateClaim(index, field, event.target.value)}
                            />
                          ) : (
                            <input
                              style={claimInputStyle}
                              type="text"
                              value={String(claim[field] ?? "")}
                              onChange={(event) => updateClaim(index, field, event.target.value)}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="elicitation-actions" style={{ gridTemplateColumns: "1fr auto", gap: 12 }}>
                  <button type="button" className="icon-button" style={{ width: "auto", padding: "0 18px" }} onClick={backToInterview}>Back</button>
                  <button type="button" className="primary-button" onClick={confirmAndStartResearch}>Confirm and start research</button>
                </div>
              </div>
            </section>
          )}

          {(compileState === "compiling" || compileState === "error") && (
            <div className="compile-overlay">
              <div className="ai-orb thinking"><span /></div>
              <h2>{compileState === "compiling" ? "Compiling brief" : "Error"}</h2>
              <p>{compileProgress}</p>
              {compileState === "compiling" && (
                <div className="compile-timing">
                  <div><strong>{formatDuration(compileElapsed)}</strong><span>elapsed</span></div>
                  <div>
                    <strong>{briefEstimate ? formatDuration(briefRemaining) : "—"}</strong>
                    <span>{briefEstimate ? `est. remaining · ${briefSamples} prior run${briefSamples === 1 ? "" : "s"}` : "collecting samples"}</span>
                  </div>
                </div>
              )}
              {compileError && <p className="error-text" style={{color: 'red'}}>{compileError}</p>}
              {compileState === "error" && (
                <button onClick={backToInterview}>Go back and try again</button>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
