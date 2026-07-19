"use client";

import { useMemo, useRef, useState } from "react";
import {
  claimRead,
  corpusMeta,
  evidenceSources,
  studyInventory,
  type EvidenceDirection,
} from "../data/eggs-weight-corpus";
import pubmedDiscovery from "../data/pubmed-discovery.json";

type BranchStatus = "kept" | "candidate" | "parked";

type Branch = {
  id: string;
  label: string;
  value: string;
  detail: string;
  why: string;
  status: BranchStatus;
  relevance: "high" | "medium" | "low";
  origin: "ai" | "human";
};

type Axis = {
  id: string;
  label: string;
  question: string;
  branches: Branch[];
};

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

function selectedBranch(axis: Axis) {
  return axis.branches.find((branch) => branch.status === "kept");
}

function buildQuestion(axes: Axis[]) {
  const get = (axisId: string) =>
    selectedBranch(axes.find((axis) => axis.id === axisId)!)?.value ?? "[unresolved]";

  return `Among ${get("population")}, does consuming ${get("object")} ${get("exposure")} ${get("diet-role")}, ${get("context")}, cause ${get("outcome")} ${get("horizon")}?`;
}

export default function Home() {
  const branchSequence = useRef(0);
  const [prompt, setPrompt] = useState(originalPrompt);
  const [axes, setAxes] = useState(initialAxes);
  const [isDecomposed, setIsDecomposed] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [focused, setFocused] = useState({ axisId: "object", branchId: "whole-hen" });
  const [showRationale, setShowRationale] = useState(true);
  const [newBranches, setNewBranches] = useState<Record<string, string>>({});
  const [claimCreated, setClaimCreated] = useState(false);
  const [prior, setPrior] = useState(50);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [evidenceFilter, setEvidenceFilter] = useState<"all" | EvidenceDirection>("all");
  const [showAllStudies, setShowAllStudies] = useState(false);
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [showAllDiscoveries, setShowAllDiscoveries] = useState(false);

  const activeQuestion = useMemo(() => buildQuestion(axes), [axes]);
  const activeAxis = axes.find((axis) => axis.id === focused.axisId) ?? axes[0];
  const activeBranch =
    activeAxis.branches.find((branch) => branch.id === focused.branchId) ?? activeAxis.branches[0];
  const branchCount = axes.reduce((sum, axis) => sum + axis.branches.length, 0);
  const parkedCount = axes.reduce(
    (sum, axis) => sum + axis.branches.filter((branch) => branch.status === "parked").length,
    0,
  );
  const filteredSources = evidenceFilter === "all"
    ? evidenceSources
    : evidenceSources.filter((source) => source.direction === evidenceFilter);
  const displayedStudies = showAllStudies ? studyInventory : studyInventory.slice(0, 8);
  const filteredDiscoveries = useMemo(() => {
    const query = discoveryQuery.trim().toLowerCase();
    if (!query) return pubmedDiscovery.records;
    return pubmedDiscovery.records.filter((record) =>
      [record.title, record.journal, record.published, ...record.authors]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [discoveryQuery]);
  const displayedDiscoveries = showAllDiscoveries
    ? filteredDiscoveries
    : filteredDiscoveries.slice(0, 12);

  function decompose() {
    setIsThinking(true);
    setClaimCreated(false);
    window.setTimeout(() => {
      setIsThinking(false);
      setIsDecomposed(true);
    }, 350);
  }

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
      caseId: "eggs-weight-loss",
      originalPrompt: prompt,
      interpretationPolicy: {
        note: "Branches are candidate scopes, not mutually exclusive truth hypotheses.",
        selectedBy: "human",
        unselectedBehavior: "parked, never silently deleted",
      },
      axes,
      compiledClaim: claimCreated
        ? {
            statement: activeQuestion,
            prior: prior / 100,
            priorType: "analysis-neutral placeholder",
            evidenceState: "claim-matched corpus attached; formal belief update not yet performed",
          }
        : null,
      evidenceCorpus: {
        id: corpusMeta.id,
        sourceIds: evidenceSources.map((source) => source.id),
        controlledTrialInventoryCount: studyInventory.length,
        pubmedDiscoveryCount: pubmedDiscovery.recordsFetched,
        pubmedQuery: pubmedDiscovery.query,
        policy: pubmedDiscovery.evidencePolicy,
      },
      openUnknowns: [
        "Preparation method and added cooking energy",
        "Comparator macronutrient composition",
        "Adherence to the assigned breakfast and energy restriction",
        "Egg size and nutrient composition",
        "Whether production method or feed is decision-relevant",
        "Transportability across dietary cultures and baseline metabolic risk",
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  function exportArtifact() {
    const blob = new Blob([JSON.stringify(artifact(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "eggs-question-artifact.json";
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
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Epistack home">
          <span className="wordmark-mark">E</span>
          <span>Epistack</span>
        </a>
        <nav className="stage-nav" aria-label="Investigation stages">
          <a className="stage active" href="#top"><b>1</b> Frame</a>
          <a className="stage ready" href="#evidence"><b>2</b> Evidence</a>
          <span className="stage"><b>3</b> Assess</span>
          <span className="stage"><b>4</b> Synthesize</span>
        </nav>
        <button className="quiet-button" onClick={exportArtifact}>Export JSON</button>
      </header>

      <section className="prompt-section" id="top">
        <div className="eyebrow">Question compiler · Eggs case</div>
        <h1>Turn a vague question into something evidence can answer.</h1>
        <p className="lede">
          AI proposes the space. You decide what matters. Nothing is silently discarded.
        </p>
        <label className="prompt-box">
          <span>Starting question</span>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} />
        </label>
        <div className="prompt-actions">
          <button className="primary-button" onClick={decompose} disabled={isThinking || !prompt.trim()}>
            {isThinking ? "Mapping interpretations…" : isDecomposed ? "Re-run decomposition" : "Decompose question"}
          </button>
          <span className="mode-note">Offline decomposition fixture · live evidence corpus attached</span>
        </div>
      </section>

      {isDecomposed && (
        <>
          <section className="map-section" aria-labelledby="map-title">
            <div className="section-heading">
              <div>
                <div className="eyebrow">AI proposal · Human editable</div>
                <h2 id="map-title">Interpretation map</h2>
              </div>
              <div className="map-stats" aria-label="Map status">
                <span><b>{axes.length}</b> axes</span>
                <span><b>{branchCount}</b> branches</span>
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
                  <section className="axis" key={axis.id} aria-labelledby={`axis-${axis.id}`}>
                    <div className="axis-heading">
                      <span className="axis-number">{String(axisIndex + 1).padStart(2, "0")}</span>
                      <div>
                        <h3 id={`axis-${axis.id}`}>{axis.label}</h3>
                        <p>{axis.question}</p>
                      </div>
                    </div>
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
                  <p>P(the egg breakfast causes greater weight loss than the selected comparator)</p>
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

          <section className="evidence-section" id="evidence" aria-labelledby="evidence-title">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Claim-matched corpus · Human review required</div>
                <h2 id="evidence-title">What the evidence actually says</h2>
              </div>
              <div className="map-stats" aria-label="Evidence corpus status">
                <span><b>{studyInventory.length}</b> trial records</span>
                <span><b>{evidenceSources.length}</b> deep extractions</span>
                <span><b>{pubmedDiscovery.recordsFetched}</b> discoveries</span>
              </div>
            </div>

            <div className="evidence-overview">
              <article className="current-read">
                <span className="read-status">Current read · {claimRead.status}</span>
                <h3>{claimRead.summary}</h3>
                <p>
                  This is a provisional interpretation of the corpus, not a medical recommendation and not a completed probability update.
                </p>
              </article>
              <div className="crux-panel">
                <div>
                  <span>Load-bearing evidence</span>
                  <ul>{claimRead.loadBearing.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div>
                  <span>What would change the answer?</span>
                  <ul>{claimRead.cruxes.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              </div>
            </div>

            <div className="corpus-boundary">
              <div>
                <span>Coverage</span>
                <strong>{corpusMeta.reviewCoverage}</strong>
                <small>{corpusMeta.updateCoverage}</small>
              </div>
              <p>{corpusMeta.caveat}</p>
            </div>

            <div className="evidence-toolbar" aria-label="Filter evidence">
              <span>Show relationship to claim</span>
              <div>
                {(["all", "supports", "challenges", "mixed", "context"] as const).map((filter) => (
                  <button
                    key={filter}
                    className={evidenceFilter === filter ? "active" : ""}
                    onClick={() => setEvidenceFilter(filter)}
                  >
                    {filter === "all" ? "All" : filter[0].toUpperCase() + filter.slice(1)}
                    <b>
                      {filter === "all"
                        ? evidenceSources.length
                        : evidenceSources.filter((source) => source.direction === filter).length}
                    </b>
                  </button>
                ))}
              </div>
            </div>

            <div className="source-grid">
              {filteredSources.map((source) => (
                <article className="source-card" key={source.id}>
                  <div className="source-card-topline">
                    <span className={`direction ${source.direction}`}>{source.direction}</span>
                    <span>{source.directness} · {source.sourceType}</span>
                  </div>
                  <h3>{source.title}</h3>
                  <p className="source-byline">{source.authors} · {source.year} · {source.sample}</p>
                  <p className="source-finding">{source.finding}</p>
                  <dl className="pico-grid">
                    <div><dt>Population</dt><dd>{source.population}</dd></div>
                    <div><dt>Exposure</dt><dd>{source.intervention}</dd></div>
                    <div><dt>Comparator</dt><dd>{source.comparator}</dd></div>
                    <div><dt>Duration</dt><dd>{source.duration}</dd></div>
                  </dl>
                  <details>
                    <summary>Inspect quality and provenance</summary>
                    <div className="quality-block">
                      <p><b>Risk of bias:</b> {source.riskOfBias.replace("-", " ")}</p>
                      <p><b>Funding:</b> {source.funding}</p>
                      <p><b>Locator:</b> {source.locator}</p>
                      <div><b>Transparency</b><ul>{source.transparency.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      <div><b>Limitations</b><ul>{source.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>
                    </div>
                  </details>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Open source <span aria-hidden="true">↗</span>
                  </a>
                </article>
              ))}
            </div>

            <section className="inventory" aria-labelledby="inventory-title">
              <div className="inventory-heading">
                <div>
                  <div className="eyebrow">Systematic-review spine</div>
                  <h3 id="inventory-title">All {studyInventory.length} controlled-trial records</h3>
                  <p>Transcribed from the 2023 review’s study table. Arrows describe the reported direction, not our confidence.</p>
                </div>
                <button onClick={() => setShowAllStudies((value) => !value)}>
                  {showAllStudies ? "Show first 8" : `Show all ${studyInventory.length}`}
                </button>
              </div>
              <div className="inventory-table-wrap">
                <table>
                  <thead><tr><th>Study</th><th>Population</th><th>Exposure → comparator</th><th>Duration</th><th>Reported</th><th>RoB</th></tr></thead>
                  <tbody>
                    {displayedStudies.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.citation}</strong><small>{item.country} · {item.design}</small></td>
                        <td>{item.healthStatus}<small>{item.participants}</small></td>
                        <td>{item.intervention}<small>vs {item.comparator}</small></td>
                        <td>{item.durationWeeks} wk</td>
                        <td><span className={`inventory-result ${item.direction}`}>{item.result}</span></td>
                        <td><span className={`risk ${item.riskOfBias}`}>{item.riskOfBias.replace("-", " ")}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="search-audit">
              <div>
                <span>Reproducible discovery trail</span>
                <strong>{pubmedDiscovery.countReportedByPubMed} PubMed matches</strong>
                <small>Fetched {pubmedDiscovery.fetchedAt.slice(0, 10)}</small>
              </div>
              <div>
                <p>{pubmedDiscovery.evidencePolicy}</p>
                <code>{pubmedDiscovery.query}</code>
              </div>
            </div>

            <section className="discovery-inbox" aria-labelledby="discovery-title">
              <div className="discovery-heading">
                <div>
                  <div className="eyebrow">Unassessed intake queue</div>
                  <h3 id="discovery-title">PubMed discoveries</h3>
                  <p>
                    These records matched the search, but matching is not endorsement. Open, screen, extract, and verify before promotion into evidence.
                  </p>
                </div>
                <label>
                  <span>Search {pubmedDiscovery.recordsFetched} records</span>
                  <input
                    type="search"
                    placeholder="Title, author, journal, or year"
                    value={discoveryQuery}
                    onChange={(event) => setDiscoveryQuery(event.target.value)}
                  />
                </label>
              </div>
              <div className="discovery-list">
                {displayedDiscoveries.map((record) => (
                  <article key={record.pmid}>
                    <div>
                      <span className="unassessed">Unassessed</span>
                      <small>{record.published} · {record.journal}</small>
                    </div>
                    <h4>{record.title}</h4>
                    <p>{record.authors.slice(0, 4).join(", ")}{record.authors.length > 4 ? " et al." : ""}</p>
                    <div className="discovery-meta">
                      <span>PMID {record.pmid}</span>
                      {record.doi && <span>DOI {record.doi}</span>}
                      {record.publicationTypes.slice(0, 2).map((type) => <span key={type}>{type}</span>)}
                    </div>
                    <a href={record.url} target="_blank" rel="noreferrer">Screen source ↗</a>
                  </article>
                ))}
              </div>
              <div className="discovery-footer">
                <span>Showing {displayedDiscoveries.length} of {filteredDiscoveries.length} matching records</span>
                {filteredDiscoveries.length > 12 && (
                  <button onClick={() => setShowAllDiscoveries((value) => !value)}>
                    {showAllDiscoveries ? "Show first 12" : `Show all ${filteredDiscoveries.length}`}
                  </button>
                )}
              </div>
            </section>
          </section>

          <section className="unknowns-section" aria-labelledby="unknowns-title">
            <div>
              <div className="eyebrow">Preserved uncertainty</div>
              <h2 id="unknowns-title">Known unknowns—not automatic branches</h2>
              <p>
                Record attributes such as preparation, egg size, feed, housing, and geography. Expand them only when evidence or a plausible mechanism suggests they could change the answer.
              </p>
            </div>
            <ul>
              <li><span>High</span> Comparator composition and total energy</li>
              <li><span>High</span> Adherence to breakfast and diet assignment</li>
              <li><span>Medium</span> Preparation method and added cooking energy</li>
              <li><span>Medium</span> Baseline metabolic risk and medication use</li>
              <li><span>Unclear</span> Egg feed, housing, shell color, and certification</li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
