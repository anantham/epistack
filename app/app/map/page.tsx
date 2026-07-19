"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  corpusMeta,
  evidenceSources,
  studyInventory,
} from "../../data/eggs-weight-corpus";
import pubmedDiscovery from "../../data/pubmed-discovery.json";
import {
  decompositionSessionKey,
  type BranchStatus,
  type DecompositionCluster,
  type DecompositionResponse,
  type InterpretationAxis as Axis,
  type InterpretationBranch as Branch,
} from "../../lib/decomposition";
import { CaseHeader } from "../components/case-navigation";

const initialAxes: Axis[] = [
  {
    id: "object",
    label: "What counts as an egg?",
    question: "Which food object is actually under investigation?",
    branches: [
      {
        id: "whole-hen",
        label: "Whole hen eggs",
        value: "two whole hen eggs",
        detail: "Yolk and white consumed together; ordinary table eggs.",
        why: "This is the most common dietary interpretation and keeps the exposure coherent.",
        status: "kept",
        relevance: "high",
        origin: "ai",
      },
      {
        id: "whites",
        label: "Egg whites only",
        value: "egg whites",
        detail: "A materially different nutrient profile from whole eggs.",
        why: "Separating the white changes both the intervention and the plausible mechanism.",
        status: "candidate",
        relevance: "medium",
        origin: "ai",
      },
      {
        id: "fertilized",
        label: "Fertilized eggs",
        value: "fertilized hen eggs",
        detail: "A possible interpretation, but not the default food exposure.",
        why: "The original wording does not specify fertilization; retain it as a visible branch.",
        status: "parked",
        relevance: "low",
        origin: "ai",
      },
      {
        id: "other-birds",
        label: "Other bird eggs",
        value: "non-hen bird eggs",
        detail: "Duck, quail, and other eggs should not silently inherit conclusions about hen eggs.",
        why: "Species is a source of construct mismatch even when the everyday label is the same.",
        status: "parked",
        relevance: "low",
        origin: "ai",
      },
    ],
  },
  {
    id: "exposure",
    label: "What does eating mean?",
    question: "Dose, frequency, preparation, and meal position all change the exposure.",
    branches: [
      {
        id: "two-breakfast",
        label: "2 eggs at breakfast, 5×/week",
        value: "at breakfast at least five days per week",
        detail: "A repeated breakfast exposure that can be tested over several weeks.",
        why: "It is concrete enough to match an intervention while remaining a familiar habit.",
        status: "kept",
        relevance: "high",
        origin: "ai",
      },
      {
        id: "one-daily",
        label: "1 egg every day",
        value: "once per day",
        detail: "A lower daily dose that may map to different evidence.",
        why: "Dose should not be generalized without an explicit bridge.",
        status: "candidate",
        relevance: "high",
        origin: "ai",
      },
      {
        id: "occasional",
        label: "Occasional consumption",
        value: "occasionally",
        detail: "A broad observational exposure with weak dose precision.",
        why: "Useful for population evidence, but less useful for a concrete personal decision.",
        status: "candidate",
        relevance: "medium",
        origin: "ai",
      },
      {
        id: "ingredient",
        label: "Eggs inside other foods",
        value: "as an ingredient in mixed foods",
        detail: "Egg exposure confounded with the rest of the recipe.",
        why: "The surrounding food may dominate the outcome and should not be collapsed with whole-egg meals.",
        status: "parked",
        relevance: "low",
        origin: "ai",
      },
    ],
  },
  {
    id: "diet-role",
    label: "Added or substituted?",
    question: "What food or energy does the egg exposure displace?",
    branches: [
      {
        id: "matched-replacement",
        label: "Replaces an energy-matched breakfast",
        value: "instead of an energy-matched egg-free breakfast",
        detail: "Comparison holds breakfast energy approximately constant.",
        why: "Weight effects are uninterpretable without saying what the eggs replace.",
        status: "kept",
        relevance: "high",
        origin: "ai",
      },
      {
        id: "added",
        label: "Added to the usual diet",
        value: "in addition to the usual diet",
        detail: "Increases exposure without specifying displacement.",
        why: "Adding food and replacing food answer different causal questions.",
        status: "candidate",
        relevance: "high",
        origin: "ai",
      },
      {
        id: "protein-replacement",
        label: "Replaces another protein source",
        value: "instead of another breakfast protein",
        detail: "Comparator may be closer in protein and satiety.",
        why: "This tests an egg-specific effect rather than a protein-composition effect.",
        status: "candidate",
        relevance: "high",
        origin: "ai",
      },
    ],
  },
  {
    id: "outcome",
    label: "Good for what?",
    question: "The word “good” hides several outcomes that can move independently.",
    branches: [
      {
        id: "body-weight",
        label: "Body-weight change",
        value: "greater loss of body weight",
        detail: "Change in measured body mass over the selected horizon.",
        why: "This is the user-selected decision target for the first vertical slice.",
        status: "kept",
        relevance: "high",
        origin: "human",
      },
      {
        id: "satiety",
        label: "Satiety and later intake",
        value: "greater satiety and lower later energy intake",
        detail: "Potential mediator rather than the final weight outcome.",
        why: "A short-term effect may explain weight change but does not establish it by itself.",
        status: "candidate",
        relevance: "high",
        origin: "ai",
      },
      {
        id: "body-composition",
        label: "Body composition",
        value: "greater fat loss while preserving lean mass",
        detail: "Weight can hide different changes in fat and lean tissue.",
        why: "Potentially more decision-relevant than scale weight alone.",
        status: "candidate",
        relevance: "medium",
        origin: "ai",
      },
      {
        id: "cardiovascular",
        label: "Cardiovascular health",
        value: "better cardiovascular outcomes",
        detail: "A separate long-horizon outcome family.",
        why: "Important, but it should not be mixed into the weight-loss claim.",
        status: "parked",
        relevance: "medium",
        origin: "ai",
      },
      {
        id: "muscle",
        label: "Muscle gain",
        value: "greater muscle gain",
        detail: "Depends strongly on training and total protein intake.",
        why: "A legitimate interpretation of “good,” but outside this first case slice.",
        status: "parked",
        relevance: "medium",
        origin: "ai",
      },
    ],
  },
  {
    id: "population",
    label: "For whom?",
    question: "Population determines both relevance and transportability.",
    branches: [
      {
        id: "overweight-adults",
        label: "Adults pursuing weight loss",
        value: "adults with overweight or obesity who are actively pursuing weight loss",
        detail: "A population for whom body-weight change is an explicit goal.",
        why: "This makes the decision relevant while avoiding silent extrapolation to everyone.",
        status: "kept",
        relevance: "high",
        origin: "human",
      },
      {
        id: "healthy-weight",
        label: "Adults at a healthy weight",
        value: "generally healthy adults at a stable weight",
        detail: "Maintenance is a different goal from intentional loss.",
        why: "Evidence may not transport between weight maintenance and active dieting.",
        status: "candidate",
        relevance: "medium",
        origin: "ai",
      },
      {
        id: "metabolic-disease",
        label: "Adults with metabolic disease",
        value: "adults with diabetes or dyslipidemia",
        detail: "Baseline risk and physiological response may differ.",
        why: "A clinically important subgroup that deserves its own claim.",
        status: "candidate",
        relevance: "medium",
        origin: "ai",
      },
      {
        id: "children-pregnancy",
        label: "Children or pregnancy",
        value: "children or pregnant people",
        detail: "Different nutritional requirements and risk considerations.",
        why: "High-consequence extrapolation makes this unsuitable for an implicit default.",
        status: "parked",
        relevance: "low",
        origin: "ai",
      },
    ],
  },
  {
    id: "context",
    label: "Under what diet?",
    question: "The same food can play a different role in a different dietary system.",
    branches: [
      {
        id: "energy-restricted",
        label: "Energy-restricted diet",
        value: "while following an energy-restricted diet",
        detail: "Participants are intentionally reducing energy intake.",
        why: "This separates weight-loss efficacy from unrestricted eating behavior.",
        status: "kept",
        relevance: "high",
        origin: "ai",
      },
      {
        id: "ad-libitum",
        label: "Eat freely",
        value: "without prescribed energy restriction",
        detail: "Any weight effect must arise through spontaneous intake or expenditure.",
        why: "This is a distinct causal pathway and should be a separate claim.",
        status: "candidate",
        relevance: "high",
        origin: "ai",
      },
      {
        id: "meal-pattern",
        label: "Specific cultural meal pattern",
        value: "within a specified local meal pattern",
        detail: "Breakfast composition and substitutes vary geographically and culturally.",
        why: "Geography matters when it changes the actual intervention or comparator—not as a decorative demographic field.",
        status: "candidate",
        relevance: "medium",
        origin: "ai",
      },
    ],
  },
  {
    id: "horizon",
    label: "Over what horizon?",
    question: "Immediate appetite and sustained weight change are different outcomes.",
    branches: [
      {
        id: "eight-twelve-weeks",
        label: "8–12 weeks",
        value: "after 8–12 weeks",
        detail: "Long enough to observe short-term weight change and adherence.",
        why: "A bounded intervention horizon is required for a probabilistic claim.",
        status: "kept",
        relevance: "high",
        origin: "ai",
      },
      {
        id: "single-meal",
        label: "One meal or one day",
        value: "over the following 24 hours",
        detail: "Appropriate for satiety and intake, not sustained weight loss.",
        why: "Short-term mechanistic evidence must not be treated as a weight-loss trial.",
        status: "candidate",
        relevance: "medium",
        origin: "ai",
      },
      {
        id: "one-year",
        label: "One year or longer",
        value: "after at least one year",
        detail: "Tests durability, adaptation, and long-term adherence.",
        why: "A short effect may disappear or reverse over longer periods.",
        status: "candidate",
        relevance: "high",
        origin: "ai",
      },
    ],
  },
];

const originalPrompt =
  "Are eggs good to eat? Bad to eat? Great in moderation? How can we tell? Does it vary across people, and what predicts this? What else should we be paying attention to here?";

const eggsClaimTemplate =
  "Among {{population}}, does consuming {{object}} {{exposure}} {{diet-role}}, {{context}}, cause {{outcome}} {{horizon}}?";

const eggsUnknowns = [
  "Comparator composition and total energy",
  "Adherence to breakfast and diet assignment",
  "Preparation method and added cooking energy",
  "Baseline metabolic risk and medication use",
  "Egg feed, housing, shell color, and certification",
];

const eggsClusters: DecompositionCluster[] = [
  {
    id: "object-cues",
    label: "Object or construct",
    axisId: "object",
    highlightQuotes: ["eggs"],
    latentVariable: "Which kind of egg or egg-derived food is the exposure?",
    rationale: "The everyday noun can refer to whole eggs, whites, ingredients, or eggs from other species.",
    ingestionRequirements: {
      requiredFields: ["egg type", "whole egg versus component", "species"],
      searchConcepts: ["whole egg", "egg white", "hen egg"],
      mismatchRisks: ["Evidence about egg components may be generalized to whole eggs."],
    },
  },
  {
    id: "exposure-cues",
    label: "Dose and frequency",
    axisId: "exposure",
    highlightQuotes: ["eat", "moderation"],
    latentVariable: "Dose, frequency, preparation, and duration of egg consumption",
    rationale: "The verb names an exposure while moderation implies an unspecified amount and cadence; together they motivate a dose/frequency axis.",
    ingestionRequirements: {
      requiredFields: ["eggs per serving", "servings per week", "intervention duration", "preparation"],
      searchConcepts: ["daily egg intake", "eggs per week", "dose response"],
      mismatchRisks: ["Trials using incompatible doses may be combined as if they tested the same exposure."],
    },
  },
  {
    id: "outcome-cues",
    label: "Outcome construct",
    axisId: "outcome",
    highlightQuotes: ["good", "Bad", "Great"],
    latentVariable: "Which benefit or harm makes eggs good or bad?",
    rationale: "Evaluative language hides distinct outcomes such as weight, satiety, cardiovascular risk, and muscle gain.",
    ingestionRequirements: {
      requiredFields: ["outcome definition", "measurement instrument", "effect size", "timepoint"],
      searchConcepts: ["benefit outcomes", "adverse outcomes", "validated measures"],
      mismatchRisks: ["Evidence for one outcome may be presented as an overall health verdict."],
    },
  },
  {
    id: "population-cues",
    label: "Population and effect modification",
    axisId: "population",
    highlightQuotes: ["across people", "predicts this"],
    latentVariable: "Who the result applies to and which characteristics modify it",
    rationale: "The question explicitly anticipates heterogeneity, so population and effect modifiers must be preserved during ingestion.",
    ingestionRequirements: {
      requiredFields: ["eligibility criteria", "baseline health", "demographics", "subgroup results"],
      searchConcepts: ["effect modification", "subgroup", "metabolic risk"],
      mismatchRisks: ["Average effects may erase clinically important heterogeneity."],
    },
  },
];

function selectedBranch(axis: Axis) {
  return axis.branches.find((branch) => branch.status === "kept");
}

function buildQuestion(axes: Axis[], template: string) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, axisId: string) => {
    const axis = axes.find((item) => item.id === axisId);
    return axis ? selectedBranch(axis)?.value ?? "[unresolved]" : "[unresolved]";
  });
}

export default function InterpretationMapPage() {
  const branchSequence = useRef(0);
  const [ready, setReady] = useState(false);
  const [prompt, setPrompt] = useState(originalPrompt);
  const [axes, setAxes] = useState(initialAxes);
  const [claimTemplate, setClaimTemplate] = useState(eggsClaimTemplate);
  const [knownUnknowns, setKnownUnknowns] = useState(eggsUnknowns);
  const [clusters, setClusters] = useState(eggsClusters);
  const [caseId, setCaseId] = useState("eggs-weight-loss");
  const [caseSummary, setCaseSummary] = useState("The original eggs case fixture is ready for human review.");
  const [sourceMode, setSourceMode] = useState("fixture");
  const [focused, setFocused] = useState({ axisId: "object", branchId: "whole-hen" });
  const [showRationale, setShowRationale] = useState(true);
  const [newBranches, setNewBranches] = useState<Record<string, string>>({});
  const [claimCreated, setClaimCreated] = useState(false);
  const [prior, setPrior] = useState(50);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.sessionStorage.getItem(decompositionSessionKey);
      if (stored) {
        try {
          const response = JSON.parse(stored) as DecompositionResponse;
          const nextAxes = response.decomposition.axes;
          setPrompt(response.prompt);
          setAxes(nextAxes);
          setClaimTemplate(response.decomposition.claimTemplate);
          setKnownUnknowns(response.decomposition.knownUnknowns);
          setClusters(response.decomposition.clusters);
          setCaseId(response.caseId);
          setCaseSummary(response.decomposition.summary);
          setSourceMode(response.mode === "ai" ? response.model : "local fallback");
          setFocused({
            axisId: nextAxes[0].id,
            branchId: (selectedBranch(nextAxes[0]) ?? nextAxes[0].branches[0]).id,
          });
        } catch {
          window.sessionStorage.removeItem(decompositionSessionKey);
        }
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const activeQuestion = useMemo(() => buildQuestion(axes, claimTemplate), [axes, claimTemplate]);
  const activeAxis = axes.find((axis) => axis.id === focused.axisId) ?? axes[0];
  const activeBranch =
    activeAxis.branches.find((branch) => branch.id === focused.branchId) ?? activeAxis.branches[0];
  const branchCount = axes.reduce((sum, axis) => sum + axis.branches.length, 0);
  const parkedCount = axes.reduce(
    (sum, axis) => sum + axis.branches.filter((branch) => branch.status === "parked").length,
    0,
  );

  function updateStatus(axisId: string, branchId: string, status: BranchStatus) {
    setAxes((current) =>
      current.map((axis) => {
        if (axis.id !== axisId) return axis;
        return {
          ...axis,
          branches: axis.branches.map((branch) => {
            if (status === "kept" && branch.id !== branchId && branch.status === "kept") {
              return { ...branch, status: "candidate" };
            }
            return branch.id === branchId ? { ...branch, status } : branch;
          }),
        };
      }),
    );
    setFocused({ axisId, branchId });
    setClaimCreated(false);
  }

  function updateFocusedBranch(patch: Partial<Branch>) {
    setAxes((current) =>
      current.map((axis) =>
        axis.id === activeAxis.id
          ? {
              ...axis,
              branches: axis.branches.map((branch) =>
                branch.id === activeBranch.id ? { ...branch, ...patch, origin: "human" } : branch,
              ),
            }
          : axis,
      ),
    );
  }

  function addBranch(axisId: string) {
    const label = newBranches[axisId]?.trim();
    if (!label) return;
    branchSequence.current += 1;
    const id = `human-${branchSequence.current}`;
    setAxes((current) =>
      current.map((axis) =>
        axis.id === axisId
          ? {
              ...axis,
              branches: [
                ...axis.branches,
                {
                  id,
                  label,
                  value: label.toLowerCase(),
                  detail: "Human-added interpretation; refine before compiling.",
                  why: "Added by the investigator because the AI proposal omitted it.",
                  status: "candidate",
                  relevance: "medium",
                  origin: "human",
                },
              ],
            }
          : axis,
      ),
    );
    setNewBranches((current) => ({ ...current, [axisId]: "" }));
    setFocused({ axisId, branchId: id });
  }

  function artifact() {
    return {
      schemaVersion: "0.1.0",
      caseId,
      originalPrompt: prompt,
      interpretationPolicy: {
        note: "Branches are candidate scopes, not mutually exclusive truth hypotheses.",
        selectedBy: "human",
        unselectedBehavior: "parked, never silently deleted",
      },
      axes,
      decompositionTrace: clusters,
      compiledClaim: claimCreated
        ? {
            statement: activeQuestion,
            prior: prior / 100,
            priorType: "analysis-neutral placeholder",
            evidenceState: caseId === "eggs-weight-loss"
              ? "claim-matched eggs corpus attached; formal belief update not yet performed"
              : "no evidence corpus attached; framing only",
          }
        : null,
      evidenceCorpus: caseId === "eggs-weight-loss"
        ? {
            id: corpusMeta.id,
            sourceIds: evidenceSources.map((source) => source.id),
            controlledTrialInventoryCount: studyInventory.length,
            pubmedDiscoveryCount: pubmedDiscovery.recordsFetched,
            pubmedQuery: pubmedDiscovery.query,
            policy: pubmedDiscovery.evidencePolicy,
          }
        : null,
      openUnknowns: knownUnknowns,
      generatedAt: new Date().toISOString(),
    };
  }

  function exportArtifact() {
    const blob = new Blob([JSON.stringify(artifact(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${caseId}-question-artifact.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveSnapshot() {
    setSaveState("saving");
    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(artifact()),
      });
      if (!response.ok) throw new Error("Save failed");
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <main>
      <CaseHeader active="frame" onExport={exportArtifact} />

      {!ready ? (
        <section className="map-arrival" aria-live="polite">
          <div className="ai-orb thinking" aria-hidden="true"><span /></div>
          <p>Assembling the interpretation map…</p>
        </section>
      ) : (
        <>
          <section className="map-section" aria-labelledby="map-title">
            <div className="section-heading">
              <div>
                <div className="eyebrow">AI proposal · Human editable · {sourceMode}</div>
                <h2 id="map-title">Interpretation map</h2>
                <p className="map-summary">{caseSummary}</p>
              </div>
              <div className="map-stats" aria-label="Map status">
                <span><b>{axes.length}</b> axes</span>
                <span><b>{branchCount}</b> branches</span>
                <span><b>{clusters.length}</b> traces</span>
                <span><b>{parkedCount}</b> parked</span>
              </div>
            </div>

            <div className="root-node">
              <span>Original question</span>
              <strong>{prompt}</strong>
            </div>

            <div className="branch-rail" aria-hidden="true" />

            <div className="workspace">
              <div className="axis-list">
                {axes.map((axis, axisIndex) => (
                  <section
                    className="axis axis-arrival"
                    key={axis.id}
                    aria-labelledby={`axis-${axis.id}`}
                    style={{ animationDelay: `${axisIndex * 90}ms` }}
                  >
                    <div className="axis-heading">
                      <span className="axis-number">{String(axisIndex + 1).padStart(2, "0")}</span>
                      <div>
                        <h3 id={`axis-${axis.id}`}>{axis.label}</h3>
                        <p>{axis.question}</p>
                      </div>
                    </div>
                    {clusters.filter((cluster) => cluster.axisId === axis.id).map((cluster) => (
                      <details className="axis-trace" key={cluster.id}>
                        <summary>
                          Derived from {cluster.highlightQuotes.map((quote) => `“${quote}”`).join(" + ")} → {cluster.latentVariable}
                        </summary>
                        <div>
                          <p>{cluster.rationale}</p>
                          <span>Evidence ingestion must retain</span>
                          <ul>{cluster.ingestionRequirements.requiredFields.map((field) => <li key={field}>{field}</li>)}</ul>
                          <span>Mismatch risk</span>
                          <p>{cluster.ingestionRequirements.mismatchRisks.join(" ")}</p>
                        </div>
                      </details>
                    ))}
                    <div className="branch-grid">
                      {axis.branches.map((branch) => {
                        const selected = focused.axisId === axis.id && focused.branchId === branch.id;
                        return (
                          <button
                            key={branch.id}
                            className={`branch ${branch.status} ${selected ? "focused" : ""}`}
                            onClick={() => setFocused({ axisId: axis.id, branchId: branch.id })}
                            aria-pressed={selected}
                          >
                            <span className="branch-status" aria-hidden="true" />
                            <span className="branch-copy">
                              <strong>{branch.label}</strong>
                              <small>{branch.origin === "human" ? "Human" : "AI"} · {branch.relevance} relevance</small>
                            </span>
                            <span className="branch-action" aria-hidden="true">›</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="add-branch">
                      <input
                        aria-label={`Add an interpretation to ${axis.label}`}
                        placeholder="Add a missing interpretation"
                        value={newBranches[axis.id] ?? ""}
                        onChange={(event) =>
                          setNewBranches((current) => ({ ...current, [axis.id]: event.target.value }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") addBranch(axis.id);
                        }}
                      />
                      <button onClick={() => addBranch(axis.id)}>Add</button>
                    </div>
                  </section>
                ))}
              </div>

              <aside className="inspector" aria-label="Selected interpretation inspector">
                <div className="inspector-kicker">Inspect branch</div>
                <div className="inspector-origin">
                  <span className={`origin-dot ${activeBranch.origin}`} />
                  {activeBranch.origin === "human" ? "Human authored" : "AI proposed"}
                </div>
                <label>
                  <span>Interpretation</span>
                  <input
                    value={activeBranch.label}
                    onChange={(event) => updateFocusedBranch({ label: event.target.value })}
                  />
                </label>
                <label>
                  <span>Meaning in the compiled question</span>
                  <textarea
                    rows={3}
                    value={activeBranch.value}
                    onChange={(event) => updateFocusedBranch({ value: event.target.value })}
                  />
                </label>
                <p className="branch-detail">{activeBranch.detail}</p>
                <button className="rationale-toggle" onClick={() => setShowRationale((value) => !value)}>
                  {showRationale ? "Hide" : "Show"} AI rationale
                </button>
                {showRationale && <p className="rationale">{activeBranch.why}</p>}
                <div className="relevance-row">
                  <span>Decision relevance</span>
                  <select
                    value={activeBranch.relevance}
                    onChange={(event) =>
                      updateFocusedBranch({ relevance: event.target.value as Branch["relevance"] })
                    }
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div className="inspector-actions">
                  <button
                    className={activeBranch.status === "kept" ? "keep active" : "keep"}
                    onClick={() => updateStatus(activeAxis.id, activeBranch.id, "kept")}
                  >
                    ✓ Keep as active
                  </button>
                  <button
                    className={activeBranch.status === "parked" ? "park active" : "park"}
                    onClick={() => updateStatus(activeAxis.id, activeBranch.id, "parked")}
                  >
                    — Park branch
                  </button>
                </div>
                <p className="inspector-note">
                  Parking removes a branch from the active question but preserves it for later review.
                </p>
              </aside>
            </div>
          </section>

          <section className="compile-section" aria-labelledby="compile-title">
            <div className="section-heading compact">
              <div>
                <div className="eyebrow">Selected path</div>
                <h2 id="compile-title">Concrete research question</h2>
              </div>
              <span className="human-badge">Human-approved scope</span>
            </div>
            <div className="compiled-question">{activeQuestion}</div>
            {!claimCreated ? (
              <button className="primary-button" onClick={() => setClaimCreated(true)}>
                Create probabilistic claim
              </button>
            ) : (
              <div className="prior-panel">
                <div>
                  <span className="prior-label">Analysis prior</span>
                  <strong>{prior}%</strong>
                  <p>P(the compiled claim is true within its stated scope)</p>
                </div>
                <label>
                  <span>Neutral starting value</span>
                  <input
                    type="range"
                    min="1"
                    max="99"
                    value={prior}
                    onChange={(event) => setPrior(Number(event.target.value))}
                  />
                </label>
                <div className="prior-warning">
                  This is an analysis placeholder, not an empirical prior. The interpretation branches above do not share this probability mass.
                </div>
              </div>
            )}
            <div className="artifact-actions">
              <button onClick={saveSnapshot} disabled={saveState === "saving"}>
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved snapshot" : "Save snapshot"}
              </button>
              <button onClick={exportArtifact}>Download artifact</button>
              {saveState === "error" && <span>Database unavailable; download still works.</span>}
            </div>
          </section>

          <section className="unknowns-section" aria-labelledby="unknowns-title">
            <div>
              <div className="eyebrow">Preserved uncertainty</div>
              <h2 id="unknowns-title">Known unknowns—not automatic branches</h2>
              <p>
                Keep these visible as limitations. Promote one into a full interpretation axis only when evidence or a plausible mechanism suggests it could change the answer.
              </p>
            </div>
            <ul>
              {knownUnknowns.map((unknown, index) => (
                <li key={unknown}><span>{index < 2 ? "High" : index < 4 ? "Medium" : "Unclear"}</span>{unknown}</li>
              ))}
            </ul>
          </section>

          <section className="route-handoff" aria-label="Continue investigation">
            <div>
              <div className="eyebrow">Next workspace</div>
              <h2>{caseId === "eggs-weight-loss" ? "Now inspect evidence against this framing." : "The framing artifact is ready for research."}</h2>
              <p>
                {caseId === "eggs-weight-loss"
                  ? "Your selected frame remains explicit; the evidence workspace keeps source review focused and separate."
                  : "This prototype does not attach the eggs evidence corpus to an unrelated question. Save or export this map before beginning a claim-matched evidence search."}
              </p>
            </div>
            <a className="primary-link" href={caseId === "eggs-weight-loss" ? "/evidence" : "/"}>
              {caseId === "eggs-weight-loss" ? "Continue to evidence →" : "Compile another question →"}
            </a>
          </section>
        </>
      )}
    </main>
  );
}
