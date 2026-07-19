"use client";

import { useEffect, useMemo, useState } from "react";
import { atomicResults, evidenceFamilies } from "../../data/eggs-result-ledger";

type Replacement = "refined-breakfast" | "protein-matched" | "skip-breakfast" | "adding" | "unknown";
type Goal = "satiety" | "weight" | "training" | "lipids";
type RiskContext = "none-known" | "high-ldl" | "diabetes" | "allergy" | "unknown";

type SavedWorkspace = {
  prompt?: string;
  decisionContext?: string;
  result?: { caseId?: string; prompt?: string } | null;
};

const replacementOptions: Array<{ id: Replacement; label: string }> = [
  { id: "refined-breakfast", label: "Refined-carb breakfast" },
  { id: "protein-matched", label: "Protein-matched breakfast" },
  { id: "skip-breakfast", label: "Skipping breakfast" },
  { id: "adding", label: "Adding eggs; replacing nothing" },
  { id: "unknown", label: "I have not named it" },
];

const goalOptions: Array<{ id: Goal; label: string }> = [
  { id: "satiety", label: "Satiety and adherence" },
  { id: "weight", label: "Weight loss" },
  { id: "training", label: "Training nutrition" },
  { id: "lipids", label: "Lipid safety" },
];

const riskOptions: Array<{ id: RiskContext; label: string }> = [
  { id: "none-known", label: "No known constraint" },
  { id: "high-ldl", label: "High LDL / hyper-response concern" },
  { id: "diabetes", label: "Diabetes or metabolic condition" },
  { id: "allergy", label: "Egg allergy" },
  { id: "unknown", label: "Not checked" },
];

function decisionFor(replacement: Replacement, goal: Goal, risk: RiskContext, farmChecked: boolean) {
  if (risk === "allergy") {
    return {
      stance: "Do not run the food trial.",
      action: "An allergy is an action constraint, not an uncertainty for this evidence graph to average away. Choose a feasible non-egg comparator.",
      stability: "Stable unless the allergy classification itself changes under appropriate clinical review.",
      next: "Identify a protein option compatible with the allergy and the same breakfast objective.",
    };
  }
  if (risk === "high-ldl" || risk === "diabetes" || risk === "unknown") {
    return {
      stance: "The represented evidence is not sufficient for an unsupervised health conclusion.",
      action: "Resolve baseline clinical context before using the general egg trials as permission. A preference trial cannot establish lipid or long-term safety.",
      stability: "Unstable: target-population applicability is currently load-bearing.",
      next: risk === "unknown" ? "Check whether a relevant medical or lipid constraint exists." : "Review the dose and monitoring plan with an appropriate clinician.",
    };
  }
  if (replacement === "unknown") {
    return {
      stance: "Do not decide until the counterfactual is named.",
      action: "Eggs replacing a refined breakfast, replacing a protein-matched meal, and being added on top are different interventions. The current graph cannot combine them.",
      stability: "Unstable: the unnamed comparator can reverse the practical interpretation.",
      next: "Write down the exact breakfast, ingredients, quantity, and calories that two eggs would displace.",
    };
  }
  if (replacement === "adding") {
    return {
      stance: "Do not expect an egg-specific weight-loss advantage from addition.",
      action: "The represented free-living result does not support adding an egg breakfast as a weight-loss intervention. Reframe the action as a substitution or justify the additional intake for another goal.",
      stability: "Stable against the current weight-loss claim; other nutrition goals remain outside this result.",
      next: "Name what would be displaced, or state that extra energy intake is intentional.",
    };
  }
  if (replacement === "skip-breakfast") {
    return {
      stance: "The egg-specific ledger does not identify the better action.",
      action: "The extracted egg comparisons are mostly against another breakfast, not against skipping breakfast. Do not borrow the cereal or bagel result for this contrast.",
      stability: "Unstable because the desired comparator is missing from the promoted result set.",
      next: "Promote controlled breakfast-versus-no-breakfast evidence and assess whether it transports to your routine.",
    };
  }

  const proteinMatched = replacement === "protein-matched";
  const farmBoundary = farmChecked
    ? "Local handling and feasibility were checked separately from the clinical literature."
    : "Farm handling, price, feed, freshness, and welfare remain unexamined primary facts.";
  if (goal === "weight") {
    return {
      stance: "A reversible trial may test adherence, not egg-specific weight loss.",
      action: `Substitute two eggs for the named breakfast only if the meal fits the intended energy plan. ${farmBoundary}`,
      stability: "Stable against claiming superior weight loss; unstable with respect to personal adherence and the exact replacement meal.",
      next: proteinMatched ? "Test preference and adherence; the satiety advantage is less supported against a protein-matched meal." : "Record hunger and later intake without treating six days of scale weight as causal evidence.",
    };
  }
  if (goal === "lipids") {
    return {
      stance: "Short-term LDL harm is partly bounded, not personally settled.",
      action: `The represented six-month trial did not show differential LDL worsening, but one family cannot establish individual or long-term safety. ${farmBoundary}`,
      stability: "Unstable to baseline lipids, dose response, and individual hyper-response.",
      next: "Define an appropriate clinical monitoring horizon; a six-day subjective log cannot answer this outcome.",
    };
  }
  return {
    stance: proteinMatched ? "A strong egg-specific satiety advantage is not established." : "A short substitution trial is reasonable if feasibility matters.",
    action: `${proteinMatched ? "Use the trial to compare preference, tolerance, and adherence—not to confirm a presumed protein advantage." : "Measure whether replacing the refined breakfast changes hunger, later intake, preference, and adherence."} ${farmBoundary}`,
    stability: proteinMatched ? "Unstable: the closest protein-matched evidence is less favorable." : "Conditionally stable for a short usability test, not a universal health claim.",
    next: "Predefine the breakfast, six planned days, hunger scale, later intake, symptoms, and stopping condition.",
  };
}

export function DecisionWorkbench() {
  const [replacement, setReplacement] = useState<Replacement>("unknown");
  const [goal, setGoal] = useState<Goal>("satiety");
  const [risk, setRisk] = useState<RiskContext>("unknown");
  const [farmChecked, setFarmChecked] = useState(false);
  const [decisionContext, setDecisionContext] = useState("");
  const [workspace, setWorkspace] = useState<SavedWorkspace>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const read = useMemo(() => decisionFor(replacement, goal, risk, farmChecked), [replacement, goal, risk, farmChecked]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("epistack:workspace:v1") || "{}") as SavedWorkspace;
      setWorkspace(saved);
      if (typeof saved.decisionContext === "string") setDecisionContext(saved.decisionContext);
    } catch {
      // The decision surface remains usable without a framing cache.
    }
  }, []);

  async function saveSnapshot() {
    setSaveState("saving");
    try {
      const originalPrompt = workspace.prompt || workspace.result?.prompt || "Are eggs good to eat for my next breakfast decision?";
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: workspace.result?.caseId,
          originalPrompt,
          compiledClaim: { statement: read.stance },
          decisionEpisode: {
            question: "Should I buy 12 eggs from a local Muttichur farmer and substitute two per day next week?",
            replacement,
            goal,
            riskContext: risk,
            farmFactsChecked: farmChecked,
            suppliedContext: decisionContext,
            synthesis: read,
            evidenceBasis: { resultRelationships: atomicResults.length, evidenceFamilies: evidenceFamilies.length },
          },
        }),
      });
      if (!response.ok) throw new Error("Snapshot could not be saved");
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <section className="decision-workbench" aria-labelledby="decision-workbench-title">
      <header>
        <div>
          <span>Live decision episode · Human-controlled</span>
          <h2 id="decision-workbench-title">Should I buy 12 local eggs and substitute two per day next week?</h2>
        </div>
        <div className="decision-basis-count"><b>{atomicResults.length}</b><span>result relations</span><b>{evidenceFamilies.length}</b><span>families</span></div>
      </header>

      <div className="decision-controls">
        <fieldset>
          <legend>What will the eggs replace?</legend>
          {replacementOptions.map((option) => (
            <button key={option.id} className={replacement === option.id ? "active" : ""} onClick={() => setReplacement(option.id)} aria-pressed={replacement === option.id}>{option.label}</button>
          ))}
        </fieldset>
        <fieldset>
          <legend>What is the main objective?</legend>
          {goalOptions.map((option) => (
            <button key={option.id} className={goal === option.id ? "active" : ""} onClick={() => setGoal(option.id)} aria-pressed={goal === option.id}>{option.label}</button>
          ))}
        </fieldset>
        <fieldset>
          <legend>Which safety context applies?</legend>
          {riskOptions.map((option) => (
            <button key={option.id} className={risk === option.id ? "active" : ""} onClick={() => setRisk(option.id)} aria-pressed={risk === option.id}>{option.label}</button>
          ))}
        </fieldset>
      </div>

      <label className="decision-context-input">
        <span>Context inherited from framing · Edit freely</span>
        <textarea value={decisionContext} onChange={(event) => setDecisionContext(event.target.value)} rows={3} placeholder="Age, location, training, current breakfast, constraints, preferences, realistic alternatives…" />
      </label>
      <label className="farm-check">
        <input type="checkbox" checked={farmChecked} onChange={(event) => setFarmChecked(event.target.checked)} />
        <span>I separately checked price, freshness, handling, feed/certification claims, and whether this farmer is a feasible source.</span>
      </label>

      <article className="computed-decision" aria-live="polite">
        <span>Current conditional policy</span>
        <h3>{read.stance}</h3>
        <p>{read.action}</p>
        <dl>
          <div><dt>Decision stability</dt><dd>{read.stability}</dd></div>
          <div><dt>Highest-value next information</dt><dd>{read.next}</dd></div>
        </dl>
        <footer>
          <button className="primary-button" onClick={saveSnapshot} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving…" : "Save decision snapshot"}</button>
          <span>{saveState === "saved" ? "Saved with its context and evidence counts." : saveState === "error" ? "Could not save; the live decision remains visible." : "Saving records what this decision rested on."}</span>
        </footer>
      </article>
    </section>
  );
}
