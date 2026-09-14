import type { ContextualizationEntry, ResearchBrief, ResearchClaimFrame } from "./research-brief.ts";
import { defaultResearchEffortStep, researchEffortSteps, type ResearchEffortStep } from "./research-budget.ts";

// Steering is the human's aim for the next search: which claims run, what to hunt
// for, and which interview answers may leave the device as search terms. It never
// changes a run in flight and never stamps a result.

export const claimSteeringStorageKey = "epistack:claim-steering:v1";
export const steeringNoteLimit = 160;
const searchTermLimit = 160;

export const huntDirections = ["support", "disconfirm", "either"] as const;
export type HuntDirection = (typeof huntDirections)[number];

export const huntLabels: Record<HuntDirection, string> = {
  support: "Support",
  disconfirm: "Disconfirm",
  either: "Either",
};

export const huntInstructions: Record<HuntDirection, string> = {
  support: "Prioritize the strongest direct sources that could support this claim. Still report any serious disconfirming source you find.",
  disconfirm: "Prioritize sources that could disconfirm, bound, or correct this claim: null or contrary results, critiques, corrections, and retractions.",
  either: "Search both directions with equal effort and report supporting and disconfirming sources alike.",
};

export const factSockets = ["search", "fit", "ignore"] as const;
export type FactSocket = (typeof factSockets)[number];

export const socketLabels: Record<FactSocket, string> = {
  search: "Search",
  fit: "Fit only",
  ignore: "Ignore",
};

export type SteeringFact = {
  id: string;
  axisId: string;
  label: string;
  value: string;
  origin: "choice" | "typed";
  /** False when the answer matches a local-only fact or looks like a personal identifier. */
  shareable: boolean;
  defaultSocket: FactSocket;
  socket: FactSocket;
};

export type ClaimSteering = {
  parked: boolean;
  hunt: HuntDirection;
  effort: ResearchEffortStep;
  note: string;
  facts: SteeringFact[];
};

export type BriefSteering = {
  version: 1;
  briefId: string;
  claims: Record<string, ClaimSteering>;
};

type SteeringBrief = Pick<
  ResearchBrief,
  "briefId" | "claims" | "contextualization" | "dimensionAssignments" | "parkedDimensions" | "stakeholderProfile"
>;
type SteeringClaim = Pick<
  ResearchClaimFrame,
  "id" | "priority" | "budgetShare" | "axisIds" | "queryUsesAxisIds" | "applicabilityUsesAxisIds"
>;

const identifierPattern =
  /[^\s@]+@[^\s@]+\.[a-z]{2,}|\+?\d[\d\s().-]{7,}\d|\b\d{1,5}\s+\w+\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd)\b/i;

function normalizedText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function isShareableFact(value: string, localOnlyFacts: readonly string[]) {
  if (identifierPattern.test(value)) return false;
  const candidate = normalizedText(value);
  return !localOnlyFacts.some((fact) => {
    const local = normalizedText(fact);
    return (candidate.length >= 6 && local.includes(candidate)) || (local.length >= 6 && candidate.includes(local));
  });
}

export function nextSocket(socket: FactSocket, shareable = true): FactSocket {
  const order: readonly FactSocket[] = shareable ? factSockets : ["fit", "ignore"];
  const index = order.indexOf(socket);
  return order[(index + 1) % order.length];
}

export function topPriorityClaimId(claims: readonly Pick<ResearchClaimFrame, "id" | "priority" | "budgetShare">[]) {
  return claims.slice().sort((a, b) => a.priority - b.priority || b.budgetShare - a.budgetShare)[0]?.id ?? "";
}

export function strongestEffort(efforts: readonly ResearchEffortStep[]): ResearchEffortStep {
  if (!efforts.length) return defaultResearchEffortStep;
  return efforts.reduce((strongest, effort) =>
    researchEffortSteps.indexOf(effort) > researchEffortSteps.indexOf(strongest) ? effort : strongest);
}

function routedSocket(brief: SteeringBrief, claim: SteeringClaim, entry: ContextualizationEntry, origin: SteeringFact["origin"], shareable: boolean): FactSocket {
  const role = brief.dimensionAssignments.find((assignment) => assignment.axisId === entry.axisId)?.role;
  if (role === "parked" || brief.parkedDimensions.some((dimension) => dimension.axisId === entry.axisId)) return "ignore";
  // Free text and private answers never leave the device unless the brief routed a
  // shareable choice into the query.
  if (!shareable || origin === "typed") return "fit";
  return claim.queryUsesAxisIds.includes(entry.axisId) ? "search" : "fit";
}

function claimFacts(brief: SteeringBrief, claim: SteeringClaim): SteeringFact[] {
  const localOnlyFacts = brief.stakeholderProfile.localOnlyFacts;
  return (brief.contextualization ?? [])
    .filter((entry) => claim.axisIds.includes(entry.axisId))
    .flatMap((entry) => {
      const values = [
        ...entry.selectedValues.map((value) => ({ value: value.trim(), origin: "choice" as const })),
        { value: entry.typedAnswer.trim(), origin: "typed" as const },
      ].filter((item, index, items) =>
        item.value && items.findIndex((other) => normalizedText(other.value) === normalizedText(item.value)) === index);
      return values.map((item, index) => {
        const shareable = isShareableFact(item.value, localOnlyFacts);
        const socket = routedSocket(brief, claim, entry, item.origin, shareable);
        return {
          id: `${entry.axisId}:${item.origin}:${index}`,
          axisId: entry.axisId,
          label: entry.label,
          value: item.value,
          origin: item.origin,
          shareable,
          defaultSocket: socket,
          socket,
        };
      });
    });
}

export function defaultBriefSteering(brief: SteeringBrief): BriefSteering {
  const topClaimId = topPriorityClaimId(brief.claims);
  return {
    version: 1,
    briefId: brief.briefId,
    claims: Object.fromEntries(brief.claims.map((claim) => [claim.id, {
      parked: false,
      hunt: "either" as HuntDirection,
      effort: claim.id === topClaimId ? "thorough" as const : defaultResearchEffortStep,
      note: "",
      facts: claimFacts(brief, claim),
    }])),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

/** Restores saved choices onto the brief's current claims and answers; the brief stays the source of facts. */
export function parseBriefSteering(raw: string | null, brief: SteeringBrief): BriefSteering {
  const defaults = defaultBriefSteering(brief);
  let saved: unknown = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    return defaults;
  }
  if (!isRecord(saved) || saved.version !== 1 || saved.briefId !== brief.briefId || !isRecord(saved.claims)) return defaults;
  const savedClaims = saved.claims;
  return {
    ...defaults,
    claims: Object.fromEntries(Object.entries(defaults.claims).map(([claimId, fallback]) => {
      const stored = savedClaims[claimId];
      if (!isRecord(stored)) return [claimId, fallback];
      const storedFacts = Array.isArray(stored.facts) ? stored.facts.filter(isRecord) : [];
      return [claimId, {
        parked: typeof stored.parked === "boolean" ? stored.parked : fallback.parked,
        hunt: isOneOf(huntDirections, stored.hunt) ? stored.hunt : fallback.hunt,
        effort: isOneOf(researchEffortSteps, stored.effort) ? stored.effort : fallback.effort,
        note: typeof stored.note === "string" ? stored.note.slice(0, steeringNoteLimit) : fallback.note,
        facts: fallback.facts.map((fact) => {
          const match = storedFacts.find((candidate) => candidate.id === fact.id);
          const socket = isOneOf(factSockets, match?.socket) ? match.socket : fact.socket;
          return { ...fact, socket: !fact.shareable && socket === "search" ? "fit" : socket };
        }),
      } satisfies ClaimSteering];
    })),
  };
}

export function searchTerms(steering: ClaimSteering) {
  return steering.facts
    .filter((fact) => fact.shareable && fact.socket === "search")
    .map((fact) => fact.value.slice(0, searchTermLimit));
}

/** Answers a reader may use to judge fit. These stay out of outbound search queries. */
export function fitContext(steering: ClaimSteering) {
  return steering.facts
    .filter((fact) => fact.socket !== "ignore")
    .map((fact) => ({ label: fact.label, value: fact.value }));
}

export function recallSteering(steering: ClaimSteering) {
  return {
    hunt: steering.hunt,
    effort: steering.effort,
    searchTerms: searchTerms(steering),
    note: steering.note.trim().slice(0, steeringNoteLimit),
  };
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteTerm(term: string) {
  return /\s/.test(term) ? `"${term}"` : term;
}

function removeTerm(query: string, term: string) {
  const literal = `"?${escapeRegExp(term)}"?`;
  return query
    .replace(new RegExp(`\\s*\\bAND\\s+${literal}|${literal}\\s+AND\\b\\s*|${literal}`, "i"), " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Proposes a query that reflects answers the person moved into or out of Search.
 * Returns null when the chips agree with the query, so a hand edit is never replaced
 * without an explicit click.
 */
export function queryFromChips(query: string, steering: ClaimSteering) {
  const lower = query.toLowerCase();
  const added = steering.facts
    .filter((fact) => fact.shareable && fact.socket === "search" && fact.defaultSocket !== "search")
    .map((fact) => fact.value.slice(0, searchTermLimit))
    .filter((value) => !lower.includes(value.toLowerCase()));
  const removed = steering.facts
    .filter((fact) => fact.socket !== "search" && fact.defaultSocket === "search")
    .map((fact) => fact.value)
    .filter((value) => lower.includes(value.toLowerCase()));
  if (!added.length && !removed.length) return null;
  const withoutRemoved = removed.reduce(removeTerm, query);
  return {
    query: [withoutRemoved.trim(), ...added.map(quoteTerm)].filter(Boolean).join(" AND "),
    added,
    removed,
  };
}

export function steeringPlanSummary(claims: readonly Pick<ResearchClaimFrame, "id">[], steering: BriefSteering) {
  const kept = claims.filter((claim) => !steering.claims[claim.id]?.parked).length;
  const parked = claims.length - kept;
  if (!kept) return "Every claim is parked.";
  return [
    `Web and PubMed for ${kept} ${kept === 1 ? "claim" : "claims"}`,
    parked ? `${parked} parked` : "",
  ].filter(Boolean).join(" · ");
}
