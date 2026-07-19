"use client";

import { useMemo, useState } from "react";
import type {
  DecompositionResponse,
  QuestionHighlight,
} from "../lib/decomposition";
import { decompositionSessionKey } from "../lib/decomposition";
import { CaseHeader } from "./components/case-navigation";

const exampleQuestion =
  "Are eggs good to eat? Bad to eat? Great in moderation? How can we tell? Does it vary across people, and what predicts this? What else should we be paying attention to here?";

type AnalysisPhase = "idle" | "analyzing" | "highlighting" | "transitioning" | "error";

type TextSegment = {
  text: string;
  highlightIndex: number | null;
};

function locateHighlights(prompt: string, highlights: QuestionHighlight[]): TextSegment[] {
  const locations = highlights
    .map((highlight, highlightIndex) => ({
      start: prompt.indexOf(highlight.quote),
      end: prompt.indexOf(highlight.quote) + highlight.quote.length,
      highlightIndex,
    }))
    .filter((item) => item.start >= 0)
    .sort((a, b) => a.start - b.start);

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const location of locations) {
    if (location.start < cursor) continue;
    if (location.start > cursor) {
      segments.push({ text: prompt.slice(cursor, location.start), highlightIndex: null });
    }
    segments.push({
      text: prompt.slice(location.start, location.end),
      highlightIndex: location.highlightIndex,
    });
    cursor = location.end;
  }
  if (cursor < prompt.length) segments.push({ text: prompt.slice(cursor), highlightIndex: null });
  return segments.length ? segments : [{ text: prompt, highlightIndex: null }];
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function Home() {
  const [prompt, setPrompt] = useState(exampleQuestion);
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [result, setResult] = useState<DecompositionResponse | null>(null);
  const [activeHighlight, setActiveHighlight] = useState(-1);
  const [error, setError] = useState("");

  const segments = useMemo(
    () => locateHighlights(prompt, result?.decomposition.highlights ?? []),
    [prompt, result],
  );
  const currentHighlight = result?.decomposition.highlights[activeHighlight] ?? null;
  const busy = phase === "analyzing" || phase === "highlighting" || phase === "transitioning";

  async function analyze() {
    if (!prompt.trim() || busy) return;
    setError("");
    setResult(null);
    setActiveHighlight(-1);
    setPhase("analyzing");

    try {
      const response = await fetch("/api/decompose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const payload = await response.json() as DecompositionResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The decomposition could not be generated.");

      setResult(payload);
      setPhase("highlighting");
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const highlightDelay = reducedMotion ? 90 : 850;
      for (let index = 0; index < payload.decomposition.highlights.length; index += 1) {
        setActiveHighlight(index);
        await wait(highlightDelay);
      }

      window.sessionStorage.setItem(decompositionSessionKey, JSON.stringify(payload));
      setPhase("transitioning");
      await wait(reducedMotion ? 80 : 900);
      window.location.assign("/map");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decomposition could not be generated.");
      setPhase("error");
    }
  }

  return (
    <main>
      <CaseHeader active="frame" />
      <section className={"analysis-shell " + (phase === "transitioning" ? "leaving" : "")}>
        <div className="analysis-intro">
          <div className="eyebrow">Question compiler · AI-assisted framing</div>
          <h1>Let the AI show you what your question is hiding.</h1>
          <p className="lede">
            Submit any research question or paragraph. Epistack marks the phrases carrying hidden choices before it builds an editable interpretation map.
          </p>
        </div>

        <div className={"analysis-workbench " + (busy ? "is-reading" : "")}>
          <div className="analysis-main">
            <div className="analysis-label-row">
              <span>Starting question</span>
              <span className="analysis-mode">
                {result?.mode === "ai" ? result.model : result?.mode === "local-fallback" ? "Local fallback" : "AI SDK · structured output"}
              </span>
            </div>

            {phase === "idle" || phase === "error" ? (
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={8}
                maxLength={5000}
                aria-label="Starting research question"
              />
            ) : (
              <div className="annotated-question" aria-label="AI analysis of the submitted question">
                {segments.map((segment, index) => {
                  const seen = segment.highlightIndex !== null && segment.highlightIndex <= activeHighlight;
                  const active = segment.highlightIndex === activeHighlight;
                  return segment.highlightIndex === null ? (
                    <span key={index}>{segment.text}</span>
                  ) : (
                    <mark
                      className={active ? "active" : seen ? "seen" : ""}
                      key={index}
                    >
                      {segment.text}
                    </mark>
                  );
                })}
                {phase === "analyzing" && <span className="reading-caret" aria-hidden="true" />}
              </div>
            )}

            <div className="analysis-actions">
              <button className="primary-button" onClick={analyze} disabled={busy || prompt.trim().length < 12}>
                {phase === "analyzing"
                  ? "Reading the question…"
                  : phase === "highlighting"
                    ? "Mapping hidden choices…"
                    : phase === "transitioning"
                      ? "Opening interpretation map…"
                      : "Map this question"}
              </button>
              <span>{prompt.length.toLocaleString()} / 5,000 characters</span>
            </div>
            {error && <p className="analysis-error" role="alert">{error}</p>}
          </div>

          <aside className="analysis-narrator" aria-live="polite" aria-atomic="true">
            <div className={"ai-orb " + (busy ? "thinking" : "")} aria-hidden="true"><span /></div>
            <div>
              <span className="narrator-kicker">
                {phase === "idle" || phase === "error" ? "How this works" : "AI is reading"}
              </span>
              <h2>
                {phase === "analyzing" && "Finding words that change what evidence would count."}
                {phase === "highlighting" && (currentHighlight?.label || "Making hidden choices visible.")}
                {phase === "transitioning" && "The map is ready. Moving into the editing workspace."}
                {(phase === "idle" || phase === "error") && "First inspect the wording. Then generate the map."}
              </h2>
              <p>
                {phase === "highlighting"
                  ? currentHighlight?.why
                  : phase === "analyzing"
                    ? "The model is not answering yet. It is identifying constructs, populations, outcomes, comparators, contexts, and time horizons."
                    : phase === "transitioning"
                      ? "Each highlighted ambiguity is now connected to a reviewable interpretation axis."
                      : "The transition is deliberately paced so you can spot-check why each branch exists before seeing the full graph."}
              </p>
              {result?.warning && <div className="fallback-warning">{result.warning}</div>}
            </div>
            <div className="analysis-progress" aria-hidden="true">
              <span style={{ width: phase === "analyzing" ? "24%" : phase === "highlighting" && result ? String(((activeHighlight + 1) / result.decomposition.highlights.length) * 76 + 24) + "%" : phase === "transitioning" ? "100%" : "0%" }} />
            </div>
          </aside>
        </div>

        <div className="analysis-principles" aria-label="Decomposition principles">
          <span><b>01</b> Exact phrases are highlighted</span>
          <span><b>02</b> Branches remain human-editable</span>
          <span><b>03</b> No ambiguity is treated as probability mass</span>
        </div>
      </section>
    </main>
  );
}
