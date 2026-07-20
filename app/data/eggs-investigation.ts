import { atomicResults, evidenceFamilies } from "./eggs-result-ledger.ts";
import { evidenceSources } from "./eggs-weight-corpus.ts";

export type ResearchLaneId = "effectiveness" | "satiety" | "safety";

export type ResearchLane = {
  id: ResearchLaneId;
  label: string;
  question: string;
  focus: string;
  defaultQuery: string;
  crux: string;
  inclusionRule: string;
  knownSourceIds: string[];
};

export const researchLanes: ResearchLane[] = [
  {
    id: "effectiveness",
    label: "Weight-loss superiority",
    question: "Do eggs outperform a named breakfast comparator for weight loss?",
    focus: "Separate substitution from addition, energy restriction from free living, and within-arm change from a between-group effect.",
    defaultQuery: "(egg OR eggs) AND breakfast AND (weight loss OR body weight) AND (randomized OR trial)",
    crux: "Does a longer, closely matched trial reproduce the favorable eight-week egg-versus-bagel result?",
    inclusionRule: "Controlled human studies and systematic reviews with an explicit egg exposure, comparator, and weight outcome.",
    knownSourceIds: ["vander-wal-2008", "keogh-2020-weight", "emrani-2023"],
  },
  {
    id: "satiety",
    label: "Satiety and the comparator",
    question: "When eggs change hunger or later intake, what did they replace?",
    focus: "Track meal energy, protein matching, crossover structure, hunger measures, and later food intake separately.",
    defaultQuery: "(egg OR eggs) AND breakfast AND (satiety OR hunger OR energy intake) AND (randomized OR crossover)",
    crux: "Is the apparent satiety effect specific to eggs or largely explained by protein and the carbohydrate-heavy comparator?",
    inclusionRule: "Controlled human meal studies reporting hunger, fullness, appetite hormones, or subsequent energy intake.",
    knownSourceIds: ["keogh-2020-satiety", "zhu-2022", "maki-2020"],
  },
  {
    id: "safety",
    label: "Cardiometabolic boundary",
    question: "What harms are actually bounded for this person and dose?",
    focus: "Keep short-term lipid biomarkers distinct from clinical events, and average response distinct from high-risk subgroups.",
    defaultQuery: "(egg OR eggs) AND (LDL OR cholesterol OR cardiometabolic) AND (randomized OR trial OR meta-analysis)",
    crux: "Does represented short-term LDL evidence transport to an individual with unknown baseline lipids and long-term risk?",
    inclusionRule: "Human comparative studies or reviews reporting LDL, ApoB, diabetes, or cardiovascular outcomes with egg exposure quantified.",
    knownSourceIds: ["keogh-2020-weight", "maki-2020", "fuller-2018"],
  },
];

export const researchCapabilities = [
  {
    id: "pubmed",
    label: "PubMed discovery",
    status: "live" as const,
    detail: "Runs the human-editable lane queries against PubMed and returns fresh discovery leads.",
  },
  {
    id: "result-ledger",
    label: "Atomic-result ledger",
    status: "live" as const,
    detail: "Known load-bearing sources open into scoped results, locators, relations, and dependence families.",
  },
  {
    id: "abstract-extraction",
    label: "Abstract result extraction",
    status: "live" as const,
    detail: "Remains available only as an explicit fallback with a human promotion gate.",
  },
  {
    id: "full-text",
    label: "Dual-model full-text review",
    status: "live" as const,
    detail: "A local Opus process extracts from hashed PMC full text; a fresh Sonnet process attacks every result before policy-gated promotion.",
  },
  {
    id: "triangulation",
    label: "Web triangulation",
    status: "placeholder" as const,
    detail: "Next: search registries, critiques, corrections, data repositories, journalism, and relevant first-person reports.",
  },
  {
    id: "updates",
    label: "Retraction and correction watch",
    status: "placeholder" as const,
    detail: "Later: subscribe sources and propagate reviewed update events through affected results and decisions.",
  },
];

export const knownSourceByPmid = new Map(
  evidenceSources
    .filter((source) => source.pmid)
    .map((source) => [source.pmid as string, source]),
);

export function laneAudit(lane: ResearchLane) {
  const sourceIds = new Set(lane.knownSourceIds);
  const results = atomicResults.filter((result) => sourceIds.has(result.sourceId));
  const promotedSources = new Set(results.map((result) => result.sourceId));
  const families = new Set(results.map((result) => result.evidenceFamilyId));
  return {
    sourceCount: promotedSources.size,
    resultCount: results.length,
    familyCount: families.size,
    checkedCount: results.filter((result) => result.verification === "source-checked").length,
  };
}

export const verticalSliceAudit = {
  lanes: researchLanes.length,
  sources: new Set(atomicResults.map((result) => result.sourceId)).size,
  results: atomicResults.length,
  families: evidenceFamilies.length,
};
