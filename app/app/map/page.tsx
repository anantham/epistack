"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  decompositionSessionKey,
  type DecompositionResponse,
  type DecompositionCluster
} from "../../lib/decomposition";
import {
  completeDimensionRoles,
  researchBriefStorageKey
} from "../../lib/research-brief";
import { CaseHeader } from "../components/case-navigation";

const localClaudeCompanionUrl = "http://127.0.0.1:4317";

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
  
  const [compileState, setCompileState] = useState<"idle" | "compiling" | "complete" | "error">("idle");
  const [compileProgress, setCompileProgress] = useState("");
  const [compileError, setCompileError] = useState("");

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
    setDecisionContext(nextContext);
    
    // Now trigger compile
    setCompileState("compiling");
    setCompileProgress("Preparing the edited scope for the research compiler");
    setCompileError("");
    try {
      const response = await fetch(`${localClaudeCompanionUrl}/compile-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          originalQuestion: prompt,
          compiledQuestion: prompt, // simplified for now
          decisionContext: nextContext,
          clusters,
          knownUnknowns,
          dimensionRoles: completeDimensionRoles(clusters, {}),
          prior: 0.5,
          refresh: false,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffered = "";
      let completed: any = null;
      let compilerError = "";
      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line);
          if (event.type === "status") setCompileProgress(event.label || "Compiling the research contract");
          if (event.type === "error") compilerError = event.message || "The local research compiler failed.";
          if (event.type === "complete" && event.payload) {
            completed = { brief: event.payload.brief, cache: event.payload.cache };
          }
        } catch {}
      };
      while (true) {
        const { done, value } = await reader.read();
        buffered += decoder.decode(value, { stream: !done });
        const lines = buffered.split("\n");
        buffered = lines.pop() || "";
        lines.forEach(consumeLine);
        if (done) break;
      }
      if (buffered.trim()) consumeLine(buffered);
      if (compilerError) throw new Error(compilerError);
      
      if (!completed?.brief) throw new Error("The local research compiler ended without a complete brief.");
      window.localStorage.setItem(researchBriefStorageKey, JSON.stringify(completed.brief));
      window.localStorage.removeItem("epistack:research-ui-cache:v1");
      window.localStorage.removeItem("epistack:research-ui-cache:v2");
      
      setCompileState("complete");
      setCompileProgress("Research brief compiled and stored locally");
      window.setTimeout(() => router.push("/research"), 450);
    } catch (error) {
      setCompileState("error");
      setCompileProgress("");
      setCompileError(error instanceof Error ? error.message : "An unknown error occurred during compilation.");
    }
  }

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

  return (
    <main className="case-layout map-layout">
      <CaseHeader active="contextualize" />
      <div className="case-bounds map-bounds">
        <div className="map-scroll">
          {compileState === "idle" && currentContextQuestion && (
            <section className="elicitation-screen" aria-label="Context interview" style={{ position: 'relative', background: 'none' }}>
              <div className="elicitation-card" key={currentContextQuestion.id}>
                <div className="elicitation-meta">
                  <span>{elicitationIndex + 1} / {clusters.length}</span>
                  <button
                    type="button"
                    className="icon-button context-info"
                    aria-label={`Why this question matters: ${currentContextQuestion.whyItMatters}`}
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

          {compileState !== "idle" && (
            <div className="compile-overlay">
              <div className="ai-orb thinking"><span /></div>
              <h2>{compileState === "compiling" ? "Compiling brief" : compileState === "complete" ? "Complete" : "Error"}</h2>
              <p>{compileProgress}</p>
              {compileError && <p className="error-text" style={{color: 'red'}}>{compileError}</p>}
              {compileState === "error" && (
                <button onClick={() => setCompileState("idle")}>Go back and try again</button>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
