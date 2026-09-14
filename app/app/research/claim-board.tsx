"use client";

import type { ReactNode } from "react";
import type { ResearchClaimFrame } from "../../lib/research-brief";
import {
  huntDirections,
  huntLabels,
  nextSocket,
  queryFromChips,
  socketLabels,
  steeringNoteLimit,
  type BriefSteering,
  type ClaimSteering,
} from "../../lib/claim-steering";
import { researchBudgetProfiles, researchEffortSteps, type ResearchEffortStep } from "../../lib/research-budget";

type SegmentedProps<T extends string> = {
  name: string;
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
};

function Segmented<T extends string>({ name, legend, options, labels, value, onChange }: SegmentedProps<T>) {
  return (
    <fieldset className="segmented">
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <label className={value === option ? "active" : ""} key={option}>
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
            <span>{labels[option]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const keepOptions = ["keep", "park"] as const;
const keepLabels: Record<(typeof keepOptions)[number], string> = { keep: "Keep", park: "Park" };
const effortLabels = Object.fromEntries(
  researchEffortSteps.map((step) => [step, researchBudgetProfiles[step].label]),
) as Record<ResearchEffortStep, string>;

type ClaimCardProps = {
  claim: ResearchClaimFrame;
  steering: ClaimSteering;
  query: string;
  /** The socket explanation is shown once, on the first kept card. */
  showSocketHelp: boolean;
  onSteeringChange: (claimId: string, next: ClaimSteering) => void;
  onQueryChange: (claimId: string, query: string) => void;
};

function ClaimCard({ claim, steering, query, showSocketHelp, onSteeringChange, onQueryChange }: ClaimCardProps) {
  const update = (patch: Partial<ClaimSteering>) => onSteeringChange(claim.id, { ...steering, ...patch });
  const queryOffer = queryFromChips(query, steering);

  return (
    <article className={`claim-card ${steering.parked ? "parked" : ""}`} id={`claim-card-${claim.id}`}>
      <div className="claim-card-header">
        <div>
          <span className="claim-card-kind">{claim.kind} claim</span>
          <h3>{claim.shortLabel}</h3>
          <p>{claim.statement}</p>
        </div>
        <Segmented
          name={`keep-${claim.id}`}
          legend="This search"
          options={keepOptions}
          labels={keepLabels}
          value={steering.parked ? "park" : "keep"}
          onChange={(value) => update({ parked: value === "park" })}
        />
      </div>

      {steering.parked ? (
        <p className="claim-card-parked">Parked. No searches run for this claim until you keep it again.</p>
      ) : (
        <>
          <div className="claim-card-controls">
            <Segmented
              name={`hunt-${claim.id}`}
              legend="Hunt for"
              options={huntDirections}
              labels={huntLabels}
              value={steering.hunt}
              onChange={(hunt) => update({ hunt })}
            />
            <Segmented
              name={`effort-${claim.id}`}
              legend="Effort"
              options={researchEffortSteps}
              labels={effortLabels}
              value={steering.effort}
              onChange={(effort) => update({ effort })}
            />
          </div>

          <div className="claim-facts">
            <span className="claim-field-label">Your answers</span>
            {steering.facts.length ? (
              <ul className="fact-chips">
                {steering.facts.map((fact) => (
                  <li key={fact.id}>
                    <button
                      type="button"
                      className={`fact-chip ${fact.socket}`}
                      title={fact.shareable ? fact.label : `${fact.label} · stays on this device`}
                      aria-label={`${fact.label}: ${fact.value}. ${socketLabels[fact.socket]}${fact.shareable ? "" : ", stays on this device"}. Select to change.`}
                      onClick={() => update({
                        facts: steering.facts.map((candidate) => candidate.id === fact.id
                          ? { ...candidate, socket: nextSocket(candidate.socket, candidate.shareable) }
                          : candidate),
                      })}
                    >
                      <span>{fact.value}</span>
                      <b>{socketLabels[fact.socket]}</b>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="claim-card-empty">No interview answers are linked to this claim.</p>
            )}
            {showSocketHelp && (
              <small>
                Select an answer to switch it between Search, Fit only, and Ignore. Search answers go into web searches.
                Fit-only answers stay out of searches and are used when a paper is read, to judge whether it applies to
                you. Private answers can never be searched.
              </small>
            )}
          </div>

          <label className="claim-query">
            <span className="claim-field-label">Search query</span>
            <textarea
              rows={2}
              value={query}
              spellCheck={false}
              onChange={(event) => onQueryChange(claim.id, event.target.value)}
            />
          </label>
          {queryOffer && (
            <button
              type="button"
              className="claim-link-button"
              onClick={() => onQueryChange(claim.id, queryOffer.query)}
            >
              Update query from your answers
              {queryOffer.added.length > 0 && ` · add ${queryOffer.added.join(", ")}`}
              {queryOffer.removed.length > 0 && ` · remove ${queryOffer.removed.join(", ")}`}
            </button>
          )}

          <label className="claim-note">
            <span className="claim-field-label">
              Steering note <small>{steering.note.length}/{steeringNoteLimit}</small>
            </span>
            <input
              type="text"
              maxLength={steeringNoteLimit}
              value={steering.note}
              placeholder="For example: prefer trials that match my dose"
              onChange={(event) => update({ note: event.target.value })}
            />
          </label>
        </>
      )}
    </article>
  );
}

export type ClaimBoardProps = {
  claims: ResearchClaimFrame[];
  steering: BriefSteering;
  queries: Record<string, string>;
  locked: boolean;
  budgetExhausted: boolean;
  planSummary: string;
  budget: ReactNode;
  onSteeringChange: (claimId: string, next: ClaimSteering) => void;
  onQueryChange: (claimId: string, query: string) => void;
  onSearch: () => void;
};

export function ClaimBoard({
  claims,
  steering,
  queries,
  locked,
  budgetExhausted,
  planSummary,
  budget,
  onSteeringChange,
  onQueryChange,
  onSearch,
}: ClaimBoardProps) {
  const keptClaims = claims.filter((claim) => steering.claims[claim.id] && !steering.claims[claim.id].parked);
  const keptCount = keptClaims.length;
  const helpClaimId = keptClaims.find((claim) => steering.claims[claim.id].facts.length > 0)?.id;
  const searchLabel = locked
    ? "Searching…"
    : keptCount === 0
      ? "Keep a claim to search"
      : `Search ${keptCount} claim${keptCount === 1 ? "" : "s"}`;

  return (
    <section className="claim-board" aria-labelledby="claim-board-title">
      <header className="claim-board-header">
        <div>
          <h2 id="claim-board-title">Aim the search</h2>
          <p>
            One card per claim in your brief. Park what you don&apos;t need, choose what to hunt for, and decide which of
            your answers go into the search.
          </p>
        </div>
        <div className="claim-board-launch">
          <button
            type="button"
            className="primary-button"
            onClick={onSearch}
            disabled={locked || keptCount === 0 || budgetExhausted}
          >
            {searchLabel}
          </button>
          <small>{locked ? "Changes apply to the next search." : planSummary}</small>
        </div>
      </header>
      {budget}
      <fieldset className="claim-cards" disabled={locked}>
        <legend className="sr-only">Claims to search</legend>
        {claims.map((claim) => {
          const claimSteering = steering.claims[claim.id];
          if (!claimSteering) return null;
          return (
            <ClaimCard
              key={claim.id}
              claim={claim}
              steering={claimSteering}
              query={queries[claim.id] ?? claim.retrieval.searchQuery}
              showSocketHelp={claim.id === helpClaimId}
              onSteeringChange={onSteeringChange}
              onQueryChange={onQueryChange}
            />
          );
        })}
      </fieldset>
    </section>
  );
}
