import { evidenceSources, type EvidenceSource } from "./eggs-weight-corpus.ts";

export type EvidenceRelation =
  | "supports"
  | "contradicts"
  | "qualifies"
  | "undercuts"
  | "bounds"
  | "not-informative";

export type VerificationStatus = "source-checked" | "review-extracted" | "abstract-only";
export type ScopeMatch = "direct" | "partial" | "indirect";
export type ResultRole = "primary" | "secondary" | "exploratory" | "methodological" | "author-interpretation";

export type ClaimFrame = {
  id: string;
  shortLabel: string;
  statement: string;
  population: string;
  exposure: string;
  comparator: string;
  outcome: string;
  timeHorizon: string;
  modality: "causal" | "associational";
};

export type EvidenceFamily = {
  id: string;
  label: string;
  reason: string;
  sourceIds: string[];
  dependsOn?: string[];
};

export type AtomicResult = {
  id: string;
  sourceId: EvidenceSource["id"];
  studyId: string;
  analysisId: string;
  claimId: ClaimFrame["id"];
  evidenceFamilyId: EvidenceFamily["id"];
  relation: EvidenceRelation;
  scopeMatch: ScopeMatch;
  role: ResultRole;
  result: string;
  estimate?: string;
  sourcePassage?: string;
  locator: string;
  rationale: string;
  verification: VerificationStatus;
};

export const claimFrames: ClaimFrame[] = [
  {
    id: "weight-superiority",
    shortLabel: "Greater weight loss",
    statement:
      "Among adults with overweight or obesity following an energy-restricted diet, substituting two whole eggs at breakfast for an energy-matched egg-free breakfast causes greater weight loss.",
    population: "Adults with overweight or obesity pursuing weight loss",
    exposure: "Two whole eggs at breakfast at least five days per week",
    comparator: "Energy-matched egg-free breakfast",
    outcome: "Between-group difference in body-weight loss",
    timeHorizon: "At least eight weeks",
    modality: "causal",
  },
  {
    id: "free-living-weight-loss",
    shortLabel: "Weight loss without restriction",
    statement:
      "Adding an egg breakfast without an energy-restriction programme causes weight loss compared with an energy-matched egg-free breakfast.",
    population: "Free-living adults with overweight or obesity",
    exposure: "Egg breakfast added without prescribed energy restriction",
    comparator: "Energy-matched egg-free breakfast",
    outcome: "Between-group difference in body weight",
    timeHorizon: "Eight weeks or longer",
    modality: "causal",
  },
  {
    id: "acute-satiety",
    shortLabel: "Acute satiety",
    statement:
      "Compared with an isoenergetic higher-carbohydrate breakfast, an egg breakfast reduces hunger or subsequent energy intake over the following day.",
    population: "Adults, especially those with overweight or obesity",
    exposure: "Egg-based breakfast",
    comparator: "Isoenergetic higher-carbohydrate breakfast",
    outcome: "Hunger and subsequent energy intake",
    timeHorizon: "Same day to 36 hours",
    modality: "causal",
  },
  {
    id: "short-term-ldl",
    shortLabel: "Short-term LDL safety",
    statement:
      "During energy restriction, eating two eggs for breakfast five days per week does not worsen LDL cholesterol relative to breakfast cereal over six months.",
    population: "Adults with overweight or obesity without diagnosed diabetes",
    exposure: "Two eggs for breakfast, five days per week",
    comparator: "Breakfast cereal during similar energy restriction",
    outcome: "Change in LDL cholesterol",
    timeHorizon: "Six months",
    modality: "causal",
  },
];

export const evidenceFamilies: EvidenceFamily[] = [
  {
    id: "trial-vander-wal-2008",
    label: "Vander Wal 2008 four-arm trial",
    reason: "All reported contrasts share the same participants, intervention delivery, investigators, and study-level biases.",
    sourceIds: ["vander-wal-2008"],
  },
  {
    id: "trial-keogh-2020",
    label: "Keogh 2020 six-month trial",
    reason: "Weight, lipids, glucose, and vitamin-D analyses are multiple outcomes from one randomized sample, not independent studies.",
    sourceIds: ["keogh-2020-weight"],
  },
  {
    id: "review-emrani-2023",
    label: "Emrani 2023 synthesis",
    reason: "The pooled and subgroup results reuse the review's included trials and share review-level inclusion and analysis decisions.",
    sourceIds: ["emrani-2023"],
    dependsOn: ["trial-vander-wal-2008", "trial-keogh-2020"],
  },
  {
    id: "trial-keogh-satiety-2020",
    label: "Keogh 2020 acute crossover trial",
    reason: "Hunger and intake endpoints arise from the same participants and test meals.",
    sourceIds: ["keogh-2020-satiety"],
  },
  {
    id: "trial-zhu-2022",
    label: "Zhu 2022 crossover experiments",
    reason: "Appetite, hormone, fullness, and intake endpoints are repeated outcomes within two closely related experiments.",
    sourceIds: ["zhu-2022"],
  },
  {
    id: "trial-maki-2020",
    label: "Maki 2020 crossover trial",
    reason: "Body-weight and dietary-intake findings share the same crossover sample and exposure periods.",
    sourceIds: ["maki-2020"],
  },
];

export const atomicResults: AtomicResult[] = [
  {
    id: "vander-wal-diet-weight",
    sourceId: "vander-wal-2008",
    studyId: "vander-wal-2008",
    analysisId: "diet-arms-weight",
    claimId: "weight-superiority",
    evidenceFamilyId: "trial-vander-wal-2008",
    relation: "supports",
    scopeMatch: "direct",
    role: "primary",
    result: "Within the energy-restricted arms, the egg group lost more weight than the bagel group over eight weeks.",
    estimate: "−2.63 kg vs −1.59 kg; p<.05",
    sourcePassage: "65% greater weight loss",
    locator: "Abstract, Results; ED versus BD contrast",
    rationale: "This is the closest reported contrast to the compiled weight-loss claim.",
    verification: "source-checked",
  },
  {
    id: "vander-wal-free-living-weight",
    sourceId: "vander-wal-2008",
    studyId: "vander-wal-2008",
    analysisId: "free-living-arms-weight",
    claimId: "free-living-weight-loss",
    evidenceFamilyId: "trial-vander-wal-2008",
    relation: "contradicts",
    scopeMatch: "direct",
    role: "primary",
    result: "Without prescribed energy restriction, the egg and bagel groups did not differ on weight-related outcomes.",
    sourcePassage: "No significant differences between the E and B groups",
    locator: "Abstract, Results; E versus B contrast",
    rationale: "The same publication reports a null result when eggs are not embedded in an energy-deficit programme.",
    verification: "source-checked",
  },
  {
    id: "vander-wal-body-fat",
    sourceId: "vander-wal-2008",
    studyId: "vander-wal-2008",
    analysisId: "diet-arms-body-fat",
    claimId: "weight-superiority",
    evidenceFamilyId: "trial-vander-wal-2008",
    relation: "qualifies",
    scopeMatch: "partial",
    role: "secondary",
    result: "The egg-diet arm had a larger percentage reduction in body fat, but the between-group result was not statistically significant.",
    estimate: "16% greater reduction; not significant",
    locator: "Abstract, Results; secondary body-fat outcome",
    rationale: "A favorable secondary direction does not establish a body-composition benefit.",
    verification: "source-checked",
  },
  {
    id: "vander-wal-conclusion",
    sourceId: "vander-wal-2008",
    studyId: "vander-wal-2008",
    analysisId: "author-conclusion",
    claimId: "weight-superiority",
    evidenceFamilyId: "trial-vander-wal-2008",
    relation: "qualifies",
    scopeMatch: "partial",
    role: "author-interpretation",
    result: "The authors conclude that eggs enhance weight loss only when combined with an energy-deficit diet and not in free-living conditions.",
    locator: "Abstract, Conclusions",
    rationale: "The interpretation is narrower than a general claim that eggs cause weight loss.",
    verification: "source-checked",
  },
  {
    id: "keogh-weight-between-group",
    sourceId: "keogh-2020-weight",
    studyId: "keogh-2020-weight",
    analysisId: "six-month-weight",
    claimId: "weight-superiority",
    evidenceFamilyId: "trial-keogh-2020",
    relation: "contradicts",
    scopeMatch: "direct",
    role: "primary",
    result: "Both energy-restricted groups lost substantial weight, but the egg and cereal groups did not differ.",
    estimate: "−8.1 kg vs −7.3 kg; diet effect p=.56",
    sourcePassage: "there was no differential effect of diet",
    locator: "Abstract, Results; six-month primary outcome",
    rationale: "This longer, closely matched trial does not reproduce egg-specific weight-loss superiority.",
    verification: "source-checked",
  },
  {
    id: "keogh-within-arm-loss",
    sourceId: "keogh-2020-weight",
    studyId: "keogh-2020-weight",
    analysisId: "six-month-weight",
    claimId: "weight-superiority",
    evidenceFamilyId: "trial-keogh-2020",
    relation: "not-informative",
    scopeMatch: "direct",
    role: "primary",
    result: "Participants assigned to eggs lost weight from baseline, but the cereal group did too.",
    estimate: "Time effect p<.001",
    locator: "Abstract, Results; within-group time effect",
    rationale: "A within-arm improvement cannot establish that eggs caused greater loss than the comparator.",
    verification: "source-checked",
  },
  {
    id: "keogh-ldl",
    sourceId: "keogh-2020-weight",
    studyId: "keogh-2020-weight",
    analysisId: "six-month-lipids",
    claimId: "short-term-ldl",
    evidenceFamilyId: "trial-keogh-2020",
    relation: "supports",
    scopeMatch: "direct",
    role: "secondary",
    result: "Total and LDL cholesterol did not worsen differentially during the six-month egg intervention.",
    sourcePassage: "There were no adverse effects on LDL-cholesterol",
    locator: "Abstract and Discussion; secondary lipid outcomes",
    rationale: "This bears on short-term biomarker safety, not long-term cardiovascular events.",
    verification: "source-checked",
  },
  {
    id: "keogh-vitamin-d",
    sourceId: "keogh-2020-weight",
    studyId: "keogh-2020-weight",
    analysisId: "post-hoc-vitamin-d",
    claimId: "weight-superiority",
    evidenceFamilyId: "trial-keogh-2020",
    relation: "not-informative",
    scopeMatch: "indirect",
    role: "exploratory",
    result: "A post-hoc vitamin-D interaction in participants with obesity was reported, but it does not test egg-specific weight loss.",
    locator: "Abstract and Discussion; post-hoc analysis",
    rationale: "A secondary exploratory benefit should not be allowed to rhetorically outweigh the null primary weight result.",
    verification: "source-checked",
  },
  {
    id: "emrani-pooled-weight",
    sourceId: "emrani-2023",
    studyId: "emrani-2023-review",
    analysisId: "pooled-body-weight",
    claimId: "weight-superiority",
    evidenceFamilyId: "review-emrani-2023",
    relation: "bounds",
    scopeMatch: "partial",
    role: "primary",
    result: "The pooled clinical-trial estimate did not show an overall body-weight benefit from whole-egg consumption.",
    estimate: "WMD +0.234 kg; 95% CI −0.207 to +0.675; p=.299",
    locator: "Results, Table 4",
    rationale: "The synthesis bounds the average effect, but its included interventions and comparators are broader than the compiled claim.",
    verification: "review-extracted",
  },
  {
    id: "emrani-calorie-subgroup",
    sourceId: "emrani-2023",
    studyId: "emrani-2023-review",
    analysisId: "calorie-restriction-subgroup",
    claimId: "weight-superiority",
    evidenceFamilyId: "review-emrani-2023",
    relation: "supports",
    scopeMatch: "partial",
    role: "exploratory",
    result: "Calorie-restricted subgroups showed a lower BMI with whole eggs, but the subgroup analysis was exploratory.",
    locator: "Results, subgroup analysis; Discussion",
    rationale: "The favorable subgroup is relevant but cannot be counted as independent from the overall synthesis or its included trials.",
    verification: "review-extracted",
  },
  {
    id: "emrani-heterogeneity",
    sourceId: "emrani-2023",
    studyId: "emrani-2023-review",
    analysisId: "pooled-body-weight",
    claimId: "weight-superiority",
    evidenceFamilyId: "review-emrani-2023",
    relation: "undercuts",
    scopeMatch: "partial",
    role: "methodological",
    result: "Very high between-study heterogeneity makes a single pooled average hard to transport to a particular breakfast decision.",
    estimate: "I²=84.7%",
    locator: "Results, Table 4; Discussion",
    rationale: "This undercuts confidence in treating the pooled estimate as one stable, universal effect.",
    verification: "review-extracted",
  },
  {
    id: "emrani-risk-of-bias",
    sourceId: "emrani-2023",
    studyId: "emrani-2023-review",
    analysisId: "risk-of-bias-assessment",
    claimId: "weight-superiority",
    evidenceFamilyId: "review-emrani-2023",
    relation: "undercuts",
    scopeMatch: "partial",
    role: "methodological",
    result: "Only one included randomized trial was rated low risk of bias overall, and publication bias was detected for body weight.",
    locator: "Risk-of-bias Tables 2–3; Discussion",
    rationale: "The quantity of included studies should not be mistaken for the quantity of independently credible evidence.",
    verification: "review-extracted",
  },
  {
    id: "keogh-acute-intake",
    sourceId: "keogh-2020-satiety",
    studyId: "keogh-2020-satiety",
    analysisId: "same-day-energy-intake",
    claimId: "acute-satiety",
    evidenceFamilyId: "trial-keogh-satiety-2020",
    relation: "supports",
    scopeMatch: "direct",
    role: "primary",
    result: "Participants consumed less energy after the egg-and-toast breakfast than after the cereal breakfast.",
    estimate: "4,518 vs 5,283 kJ; p=.001",
    locator: "Abstract and Results",
    rationale: "The randomized crossover contrast directly bears on short-term intake, not durable weight loss.",
    verification: "review-extracted",
  },
  {
    id: "keogh-acute-hunger",
    sourceId: "keogh-2020-satiety",
    studyId: "keogh-2020-satiety",
    analysisId: "same-day-hunger",
    claimId: "acute-satiety",
    evidenceFamilyId: "trial-keogh-satiety-2020",
    relation: "supports",
    scopeMatch: "direct",
    role: "secondary",
    result: "Reported hunger was lower following the egg breakfast.",
    locator: "Abstract and Results",
    rationale: "This is a related endpoint from the same participants and must not be counted as an independent replication.",
    verification: "review-extracted",
  },
  {
    id: "zhu-appetite-null",
    sourceId: "zhu-2022",
    studyId: "zhu-2022",
    analysisId: "appetite-and-intake",
    claimId: "acute-satiety",
    evidenceFamilyId: "trial-zhu-2022",
    relation: "contradicts",
    scopeMatch: "direct",
    role: "primary",
    result: "Most appetite, hormone, and intake outcomes did not differ when breakfast protein quantity was matched.",
    locator: "Abstract, Results",
    rationale: "Matching protein quantity weakens the inference that an egg-specific property reliably drives satiety.",
    verification: "abstract-only",
  },
  {
    id: "zhu-fullness-without-intake",
    sourceId: "zhu-2022",
    studyId: "zhu-2022",
    analysisId: "fullness-subresult",
    claimId: "acute-satiety",
    evidenceFamilyId: "trial-zhu-2022",
    relation: "qualifies",
    scopeMatch: "direct",
    role: "secondary",
    result: "One experiment found greater fullness after eggs without a corresponding reduction in lunch intake.",
    locator: "Abstract, Results",
    rationale: "Subjective fullness and behavioral intake moved differently within the same source.",
    verification: "abstract-only",
  },
  {
    id: "maki-weight-null",
    sourceId: "maki-2020",
    studyId: "maki-2020",
    analysisId: "four-week-weight",
    claimId: "free-living-weight-loss",
    evidenceFamilyId: "trial-maki-2020",
    relation: "contradicts",
    scopeMatch: "partial",
    role: "secondary",
    result: "Body-weight change did not differ between egg and higher-carbohydrate breakfast periods.",
    locator: "Abstract, Results",
    rationale: "The short trial is not a direct long-term weight-loss test, but it does not support automatic weight loss from egg substitution.",
    verification: "abstract-only",
  },
  {
    id: "maki-non-study-energy",
    sourceId: "maki-2020",
    studyId: "maki-2020",
    analysisId: "non-study-energy-intake",
    claimId: "acute-satiety",
    evidenceFamilyId: "trial-maki-2020",
    relation: "contradicts",
    scopeMatch: "partial",
    role: "secondary",
    result: "Reported energy intake from non-study foods was higher during the egg condition without a corresponding body-weight difference.",
    estimate: "+149 kcal/day from non-study foods",
    locator: "Abstract and full-text Results",
    rationale: "This cuts against treating lower later intake as a reliable consequence of every egg breakfast comparator.",
    verification: "review-extracted",
  },
];

export const sourcesWithResults = evidenceSources.filter((source) =>
  atomicResults.some((result) => result.sourceId === source.id),
);

export function getSource(sourceId: string) {
  return evidenceSources.find((source) => source.id === sourceId);
}

export function getClaim(claimId: string) {
  return claimFrames.find((claim) => claim.id === claimId);
}

export function getEvidenceFamily(familyId: string) {
  return evidenceFamilies.find((family) => family.id === familyId);
}

export function resultsForSource(sourceId: string) {
  return atomicResults.filter((result) => result.sourceId === sourceId);
}

export function sourceRelationshipSummary(results: AtomicResult[]) {
  const relations = new Set(results.map((result) => result.relation));
  if (relations.size === 1) return results[0]?.relation ?? "not-informative";
  return "mixed" as const;
}

export function relationCounts(results: AtomicResult[]) {
  return results.reduce<Record<EvidenceRelation, number>>((counts, result) => {
    counts[result.relation] += 1;
    return counts;
  }, {
    supports: 0,
    contradicts: 0,
    qualifies: 0,
    undercuts: 0,
    bounds: 0,
    "not-informative": 0,
  });
}
