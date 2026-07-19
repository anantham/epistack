export type EvidenceDirection = "supports" | "challenges" | "mixed" | "context";
export type RiskOfBias = "low" | "some-concerns" | "high" | "not-assessed";

export type StudyInventoryItem = {
  id: string;
  citation: string;
  refId: number;
  country: string;
  design: "Parallel" | "Cross-over";
  participants: string;
  durationWeeks: number;
  healthStatus: string;
  intervention: string;
  comparator: string;
  result: string;
  direction: EvidenceDirection;
  riskOfBias: RiskOfBias;
};

export type EvidenceSource = {
  id: string;
  title: string;
  authors: string;
  year: number;
  sourceType: string;
  url: string;
  doi: string;
  pmid?: string;
  pmcid?: string;
  direction: EvidenceDirection;
  directness: "direct" | "mechanism" | "context";
  population: string;
  intervention: string;
  comparator: string;
  duration: string;
  sample: string;
  finding: string;
  locator: string;
  funding: string;
  riskOfBias: RiskOfBias;
  transparency: string[];
  limitations: string[];
};

export const corpusMeta = {
  id: "eggs-weight-loss-v1",
  compiledClaim:
    "Among adults with overweight or obesity pursuing weight loss, does consuming two whole hen eggs at breakfast at least five days per week instead of an energy-matched egg-free breakfast, while following an energy-restricted diet, cause greater weight loss?",
  reviewCoverage: "Controlled adult clinical trials published from 1981 through April 23, 2023",
  updateCoverage: "Targeted PubMed and web update search through July 19, 2026",
  primaryReview: "Emrani et al. 2023, PROSPERO CRD42022308045",
  searchPolicy:
    "Use the systematic review as the study spine, then search forward for claim-matched trials, contradictions, mechanisms, registrations, corrections, and funding disclosures.",
  caveat:
    "This is a broad claim-matched corpus, not a guarantee that every relevant page on the internet has been found. Discovery records are not treated as evidence until a human verifies the source and extraction.",
};

const riskByRef: Record<number, RiskOfBias> = {
  22: "high", 23: "high", 32: "high", 33: "some-concerns", 34: "high",
  35: "high", 36: "some-concerns", 37: "high", 38: "low", 39: "some-concerns",
  40: "high", 41: "not-assessed", 42: "high", 43: "some-concerns", 44: "high",
  45: "high", 46: "high", 47: "some-concerns", 48: "high", 49: "high",
  50: "high", 51: "high", 52: "high", 53: "high", 54: "high", 55: "high",
  56: "high", 57: "high", 58: "high", 59: "high", 60: "high", 61: "some-concerns",
};

function study(
  id: string,
  citation: string,
  refId: number,
  country: string,
  design: StudyInventoryItem["design"],
  participants: string,
  durationWeeks: number,
  healthStatus: string,
  intervention: string,
  comparator: string,
  result: string,
  direction: EvidenceDirection,
): StudyInventoryItem {
  return {
    id, citation, refId, country, design, participants, durationWeeks, healthStatus,
    intervention, comparator, result, direction, riskOfBias: riskByRef[refId] ?? "not-assessed",
  };
}

// Study-level inventory transcribed from Table 1 of Emrani et al. 2023.
// The review separately analyzed the diet and no-diet comparisons in Vander
// Wal 2008; this inventory keeps them together as one publication record.
export const studyInventory: StudyInventoryItem[] = [
  study("daly-2022", "Daly et al. 2022", 60, "Australia", "Parallel", "Men and women", 12, "Healthy", "7 or 12 whole eggs/week", "2 eggs/week", "Weight ↔", "challenges"),
  study("njike-2021", "Njike et al. 2021", 61, "USA", "Cross-over", "Men and women", 6, "Metabolic syndrome", "2 eggs/week", "No egg", "Weight ↔ · BMI ↔ · waist ↔", "challenges"),
  study("keogh-2020", "Keogh et al. 2020", 40, "Australia", "Parallel", "Men and women", 24, "Otherwise healthy; overweight/obesity", "10 whole eggs/week", "Breakfast cereal", "Weight ↔", "challenges"),
  study("maki-2020", "Maki et al. 2020", 42, "USA", "Cross-over", "Men and women", 4, "Metabolic syndrome/prediabetes", "12 whole eggs/week", "Energy-matched higher-carbohydrate breakfast", "Weight ↔", "challenges"),
  study("dibella-2020", "DiBella et al. 2020", 35, "USA", "Cross-over", "Men and women", 4, "Metabolic syndrome", "21 whole eggs/week", "Choline supplement", "Weight ↔ · BMI ↔ · waist ↔", "challenges"),
  study("shakoor-2020", "Shakoor et al. 2020", 48, "Pakistan", "Cross-over", "Men and women", 5, "Metabolic syndrome", "14 whole eggs/week", "No egg", "BMI ↔", "challenges"),
  study("aljohi-2019", "Aljohi et al. 2019", 32, "USA", "Parallel", "Men and women", 48, "Healthy", "Up to 12 whole eggs/week", "No egg", "BMI ↔", "challenges"),
  study("fuller-2018", "Fuller et al. 2018", 37, "Australia", "Parallel", "Men and women", 24, "Prediabetes/type 2 diabetes", "12 whole eggs/week", "Fewer than 2 eggs/week", "Waist ↔ · fat-free mass ↔", "challenges"),
  study("missimer-2017", "Missimer et al. 2017", 43, "USA", "Cross-over", "Men and women", 4, "Healthy", "12 whole eggs/week", "Daily oatmeal", "Weight ↔ · BMI ↔ · waist ↔", "challenges"),
  study("dimarco-2017", "DiMarco et al. 2017", 36, "USA", "Cross-over", "Men and women", 4, "Healthy", "7, 14, or 21 whole eggs/week", "No egg", "BMI ↔ · waist ↔", "challenges"),
  study("fuller-2016", "Fuller et al. 2016", 38, "Australia", "Parallel", "Men and women", 12, "Prediabetes/type 2 diabetes", "12 whole eggs/week", "Fewer than 2 eggs/week", "Weight ↔ · waist ↔ · fat-free mass ↔", "challenges"),
  study("njike-2016", "Njike et al. 2016", 22, "USA", "Cross-over", "Men and women", 12, "Type 2 diabetes", "10–14 whole eggs/week", "No egg", "Weight ↑ · BMI ↑ · waist ↔", "challenges"),
  study("clayton-2015", "Clayton et al. 2015", 34, "USA", "Parallel", "Men and women", 12, "Healthy", "Egg breakfasts; 14 whole eggs/week", "Bagel breakfasts", "Weight ↔ · fat-free mass ↔", "challenges"),
  study("katz-2015", "Katz et al. 2015", 23, "USA", "Cross-over", "Men and women", 6, "Coronary artery disease", "2 eggs daily", "High-carbohydrate breakfast", "Weight ↔ · BMI ↔", "challenges"),
  study("ballesteros-2015", "Ballesteros et al. 2015", 33, "Mexico", "Cross-over", "Men and women", 5, "Type 2 diabetes", "7 whole eggs/week", "Oatmeal with lactose-free milk", "Weight ↔ · BMI ↔", "challenges"),
  study("burns-whitmore-2014", "Burns-Whitmore et al. 2014", 51, "USA", "Cross-over", "Men and women", 8, "Healthy", "6 whole eggs/week", "Walnuts 6 times/week", "Weight ↔", "challenges"),
  study("rueda-2013", "Rueda & Khosla 2013", 46, "USA", "Parallel", "Men and women", 14, "Healthy university students", "At least 10 whole eggs/week", "No egg", "Weight ↔", "challenges"),
  study("putadechakum-2013", "Putadechakum et al. 2013", 45, "Thailand", "Cross-over", "Men and women", 4, "Hyperlipidemia", "7 or 21 whole eggs/week", "No egg", "Weight ↔ · BMI ↔ · waist ↔ · fat-free mass ↔", "challenges"),
  study("techakriengkrai-2012", "Techakriengkrai et al. 2012", 52, "Thailand", "Cross-over", "Women", 4, "Hypercholesterolemia", "21 whole eggs/week", "7 eggs/week", "Weight ↔ · BMI ↔", "challenges"),
  study("pearce-2011", "Pearce et al. 2011", 44, "Australia", "Parallel", "Men and women", 12, "Type 2 diabetes", "High-protein diet; 14 whole eggs/week", "High-protein diet; lean meat, chicken, or fish", "Weight ↔", "challenges"),
  study("vislocky-2009", "Vislocky et al. 2009", 49, "USA", "Parallel", "Men and women", 8, "Healthy", "12 whole eggs/week", "No egg", "Weight ↔ · fat-free mass ↔", "challenges"),
  study("harman-2008", "Harman et al. 2008", 50, "UK", "Parallel", "Men and women", 12, "Healthy", "14 whole eggs/week", "No egg", "Weight ↔", "challenges"),
  study("vander-wal-2008", "Vander Wal et al. 2008", 58, "USA", "Parallel", "Men and women", 8, "Otherwise healthy; overweight/obesity", "14 whole eggs/week, with or without a 1,000 kcal deficit", "Bagel breakfast under the same diet assignment", "Benefit only in the energy-restricted comparison", "supports"),
  study("katz-2005", "Katz et al. 2005", 39, "USA", "Cross-over", "Men and women", 6, "Healthy", "14 whole eggs/week", "60 g uncooked whole oats", "BMI ↔", "challenges"),
  study("tannock-2005", "Tannock et al. 2005", 53, "USA", "Cross-over", "Men and women", 4, "Healthy", "14 or 28 whole eggs/week", "No egg", "Weight ↔", "challenges"),
  study("chakrabarty-2004", "Chakrabarty et al. 2004", 54, "India", "Cross-over", "Men and women", 8, "Healthy", "7 whole eggs/week", "No egg", "Weight ↔ · BMI ↔", "challenges"),
  study("chakrabarty-2002", "Chakrabarty et al. 2002", 55, "India", "Cross-over", "Men and women", 8, "Healthy", "7 whole eggs/week", "No egg", "Weight ↔ · BMI ↔", "challenges"),
  study("schnohr-1994", "Schnohr et al. 1994", 56, "Denmark", "Cross-over", "Men and women", 6, "Healthy", "14 whole eggs/week", "Usual diet", "Weight ↔", "challenges"),
  study("lehtimaki-1992", "Lehtimaki et al. 1992", 41, "Finland", "Parallel", "Men and women", 3, "Healthy", "21 whole eggs/week", "No egg", "Weight ↔", "challenges"),
  study("edington-1987", "Edington et al. 1987", 57, "UK", "Cross-over", "Men and women", 8, "Healthy or hyperlipidemia", "7 whole eggs/week", "2 eggs/week", "Weight ↔", "challenges"),
  study("sacks-1984", "Sacks et al. 1984", 47, "USA", "Cross-over", "Men and women", 3, "Healthy", "7 whole eggs/week", "No egg", "Weight ↔", "challenges"),
  study("flaim-1981", "Flaim et al. 1981", 59, "USA", "Parallel", "Men", 5, "Healthy", "28 whole eggs/week", "No egg", "Weight ↑", "challenges"),
];

export const evidenceSources: EvidenceSource[] = [
  {
    id: "emrani-2023", title: "The effect of whole egg consumption on weight and body composition in adults: a systematic review and meta-analysis of clinical trials",
    authors: "Emrani, Beigrezaei, Zademohammadi & Salehi-Abargouei", year: 2023, sourceType: "Systematic review and meta-analysis",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10353215/", doi: "10.1186/s13643-023-02277-3", pmid: "37461099", pmcid: "PMC10353215",
    direction: "mixed", directness: "direct", population: "Adults in 32 controlled clinical trials", intervention: "Whole-egg consumption", comparator: "No egg, fewer eggs, or another food/supplement",
    duration: "3–48 weeks", sample: "1,117 participants in the body-weight meta-analysis",
    finding: "No overall body-weight effect: WMD +0.234 kg (95% CI −0.207 to +0.675; p=.299), with high heterogeneity (I²=84.7%). Calorie-restricted subgroups showed lower BMI, but subgroup results are exploratory.",
    locator: "Results, Table 4; Discussion; risk-of-bias Tables 2–3", funding: "Nutrition and Food Security Research Center, Shahid Sadoughi University of Medical Sciences; authors declared no competing interests.",
    riskOfBias: "some-concerns", transparency: ["PROSPERO CRD42022308045", "PRISMA workflow", "Search terms supplied", "Open-access full text"],
    limitations: ["Only one included randomized trial was rated low risk overall", "High heterogeneity", "Publication bias detected for body weight", "Weight was often a secondary outcome", "Cooking method often unreported"],
  },
  {
    id: "vander-wal-2008", title: "Egg breakfast enhances weight loss", authors: "Vander Wal, Gupta, Khosla & Dhurandhar", year: 2008, sourceType: "Randomized four-arm trial",
    url: "https://pubmed.ncbi.nlm.nih.gov/18679412/", doi: "10.1038/ijo.2008.130", pmid: "18679412", pmcid: "PMC2755181",
    direction: "supports", directness: "direct", population: "Adults aged 25–60 with BMI 25–50", intervention: "Two eggs at breakfast, at least 5 days/week", comparator: "Energy- and weight-matched bagel breakfast",
    duration: "8 weeks", sample: "152 completers across four arms",
    finding: "Within energy-restricted arms, egg breakfast produced 2.63 vs 1.59 kg mean weight loss (p<.05). Without energy restriction, egg and bagel groups did not differ.",
    locator: "Abstract results; full-text Results and Conclusions", funding: "American Egg Board.", riskOfBias: "high",
    transparency: ["Open-access full text", "Funding disclosed", "Comparator energy matched"],
    limitations: ["Industry funded", "Short duration", "Four-arm subgroup comparison", "No intensive adherence monitoring", "Review rated high overall risk of bias"],
  },
  {
    id: "keogh-2020-weight", title: "No Difference in Weight Loss, Glucose, Lipids and Vitamin D of Eggs for Breakfast Compared with Cereal for Breakfast during Energy Restriction",
    authors: "Keogh & Clifton", year: 2020, sourceType: "Randomized parallel trial", url: "https://pubmed.ncbi.nlm.nih.gov/33261155/", doi: "10.3390/ijerph17238827", pmid: "33261155", pmcid: "PMC7730050",
    direction: "challenges", directness: "direct", population: "Adults with overweight/obesity; mean age 56, mean BMI 34", intervention: "Two eggs at breakfast, 5 days/week, with energy restriction", comparator: "Breakfast cereal with similar prescribed energy restriction",
    duration: "24 weeks", sample: "110 started; 76 completed",
    finding: "Completers lost 8.1 kg with eggs and 7.3 kg with cereal; the between-diet effect was not significant (p=.56).",
    locator: "Abstract and Results", funding: "Trial and manuscript funded entirely by Australian Eggs Ltd.", riskOfBias: "high",
    transparency: ["Open-access full text", "Funding disclosed", "Longer follow-up than the 2008 trial"],
    limitations: ["31% attrition", "Industry funded", "Pandemic prevented final DEXA measurement", "Review rated high overall risk of bias"],
  },
  {
    id: "fuller-2018", title: "Effect of a high-egg diet on cardiometabolic risk factors in people with type 2 diabetes: the DIABEGG Study—randomized weight-loss and follow-up phase",
    authors: "Fuller et al.", year: 2018, sourceType: "Randomized parallel trial", url: "https://pubmed.ncbi.nlm.nih.gov/29741558/", doi: "10.1093/ajcn/nqy048", pmid: "29741558",
    direction: "challenges", directness: "direct", population: "128 adults with prediabetes or type 2 diabetes", intervention: "At least 12 eggs/week plus 2.1 MJ/day energy restriction", comparator: "Fewer than 2 eggs/week with macronutrient-matched diet",
    duration: "12 months total; 3-month weight-loss phase", sample: "128 randomized",
    finding: "From months 3–12, both high- and low-egg groups lost 3.1 kg; between-group p=.48.",
    locator: "Abstract results", funding: "Australian Egg Corporation supported the study; the paper reports no funder role in design, conduct, or analysis.", riskOfBias: "high",
    transparency: ["Funding role reported", "12-month follow-up", "Macronutrient-matched diet"],
    limitations: ["Metabolic-risk population differs from the default claim", "Egg dose was weekly rather than fixed breakfast substitution", "Review rated high overall risk of bias"],
  },
  {
    id: "rueda-2013", title: "Impact of Breakfasts (with or without Eggs) on Body Weight Regulation and Blood Lipids in University Students over a 14-Week Semester",
    authors: "Rueda & Khosla", year: 2013, sourceType: "Randomized parallel trial", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3875930/", doi: "10.3390/nu5125097", pmid: "24352089", pmcid: "PMC3875930",
    direction: "challenges", directness: "context", population: "73 university freshmen", intervention: "Egg breakfast at least 5 days/week", comparator: "Non-egg breakfast",
    duration: "14 weeks", sample: "73 assigned; 39 egg, 34 non-egg",
    finding: "Mean weight increased 0.73 kg overall, with no between-group difference.", locator: "Abstract results", funding: "No funding statement captured in the extracted record; authors declared no conflict of interest.", riskOfBias: "high",
    transparency: ["Open-access full text", "Conflict statement"],
    limitations: ["Not an energy-restricted weight-loss population", "Young student population", "Review rated high overall risk of bias"],
  },
  {
    id: "keogh-2020-satiety", title: "Energy Intake and Satiety Responses of Eggs for Breakfast in Overweight and Obese Adults—A Crossover Study",
    authors: "Keogh & Clifton", year: 2020, sourceType: "Randomized crossover meal study", url: "https://pubmed.ncbi.nlm.nih.gov/32756313/", doi: "10.3390/ijerph17155583", pmid: "32756313", pmcid: "PMC7432073",
    direction: "supports", directness: "mechanism", population: "50 adults with overweight/obesity", intervention: "Eggs and toast breakfast", comparator: "Isoenergetic cereal, milk, and juice breakfast",
    duration: "Two test days", sample: "50 completed both visits", finding: "Subsequent energy intake was 4,518 vs 5,283 kJ after egg vs cereal breakfast (p=.001); hunger was also lower.", locator: "Abstract; Methods; Results",
    funding: "Australian Eggs Ltd.; authors stated the funder had no role in design, analysis, interpretation, writing, or publication decision.", riskOfBias: "some-concerns",
    transparency: ["Open-access full text", "Funder role stated", "Isoenergetic breakfast"],
    limitations: ["Acute surrogate outcome, not weight loss", "Breakfasts differed substantially in protein, fat, carbohydrate, and fibre", "Industry funded"],
  },
  {
    id: "zhu-2022", title: "Greater protein quality of an egg breakfast may be inadequate to induce satiety during weight loss, compared with a cereal breakfast of equal protein quantity",
    authors: "Zhu et al.", year: 2022, sourceType: "Two randomized crossover trials", url: "https://pubmed.ncbi.nlm.nih.gov/36237122/", doi: "10.1080/09637486.2022.2133097", pmid: "36237122",
    direction: "challenges", directness: "mechanism", population: "Women with overweight/obesity", intervention: "Egg breakfast during reduced-calorie counselling", comparator: "Cereal breakfast matched for energy density and protein quantity",
    duration: "Two 2-week experiments", sample: "30 women", finding: "No significant difference in most appetite, hormone, or intake outcomes; one experiment found greater fullness but not lower lunch intake.", locator: "Abstract results",
    funding: "Not yet verified from full text.", riskOfBias: "not-assessed", transparency: ["Randomized crossover design", "Protein quantity matched"],
    limitations: ["Short duration", "Mechanistic outcomes", "Women only", "Funding and preregistration not yet verified"],
  },
  {
    id: "ratliff-2010", title: "Consuming eggs for breakfast influences plasma glucose and ghrelin, while reducing energy intake during the next 24 hours in adult men",
    authors: "Ratliff et al.", year: 2010, sourceType: "Randomized crossover meal study", url: "https://pubmed.ncbi.nlm.nih.gov/20226994/", doi: "10.1016/j.nutres.2010.01.002", pmid: "20226994",
    direction: "supports", directness: "mechanism", population: "Men aged 20–70", intervention: "Egg breakfast", comparator: "Isoenergetic bagel breakfast",
    duration: "Two test days separated by one week", sample: "21 men", finding: "Participants consumed fewer kilocalories after the egg breakfast over the following 24 hours; glucose, insulin, and ghrelin responses also differed.", locator: "Abstract results",
    funding: "Not yet verified from full text.", riskOfBias: "not-assessed", transparency: ["Randomized crossover design", "Isoenergetic comparison"],
    limitations: ["Small sample", "Men only", "Acute surrogate outcome", "Macronutrient profiles differed markedly", "Funding not yet verified"],
  },
  {
    id: "vander-wal-2005", title: "Short-term effect of eggs on satiety in overweight and obese subjects",
    authors: "Vander Wal et al.", year: 2005, sourceType: "Randomized crossover meal study", url: "https://pubmed.ncbi.nlm.nih.gov/16373948/", doi: "10.1080/07315724.2005.10719497", pmid: "16373948",
    direction: "supports", directness: "mechanism", population: "Women aged 25–60 with BMI at least 25", intervention: "Egg breakfast", comparator: "Isoenergetic equal-weight bagel breakfast",
    duration: "Two test days two weeks apart", sample: "30 women", finding: "Lunch energy intake was 2,406 vs 3,091 kJ after egg vs bagel breakfast (p<.0001), with lower reported intake over the next 36 hours.", locator: "Abstract results",
    funding: "Not yet verified from full text.", riskOfBias: "not-assessed", transparency: ["Randomized crossover design", "Comparator energy and weight matched"],
    limitations: ["Small sample", "Women only", "Acute outcome", "Self-reported intake after laboratory lunch", "Funding not yet verified"],
  },
  {
    id: "maki-2020", title: "Effects of substituting eggs for high-carbohydrate breakfast foods on the cardiometabolic risk-factor profile in adults at risk for type 2 diabetes mellitus",
    authors: "Maki et al.", year: 2020, sourceType: "Randomized crossover trial", url: "https://pubmed.ncbi.nlm.nih.gov/32152513/", doi: "10.1038/s41430-020-0599-2", pmid: "32152513", pmcid: "PMC7214271",
    direction: "challenges", directness: "context", population: "30 adults with overweight/obesity and prediabetes or metabolic syndrome", intervention: "Two eggs/day, 6 days/week", comparator: "Energy-matched higher-carbohydrate non-egg breakfasts",
    duration: "Two 4-week conditions", sample: "30 provided data", finding: "Weight change did not differ, even though non-study energy intake was 149 kcal/day higher during the egg condition.", locator: "Abstract results",
    funding: "Not yet independently verified in this corpus.", riskOfBias: "high", transparency: ["Open-access full text", "Randomized crossover design", "Energy-matched study foods"],
    limitations: ["Short duration", "Weight was not the main outcome", "Higher non-study energy intake during egg condition", "Review rated high overall risk of bias"],
  },
  {
    id: "sievert-2019", title: "Effect of breakfast on weight and energy intake: systematic review and meta-analysis of randomised controlled trials",
    authors: "Sievert et al.", year: 2019, sourceType: "Systematic review and meta-analysis", url: "https://www.bmj.com/content/364/bmj.l42", doi: "10.1136/bmj.l42", pmid: "30700403", pmcid: "PMC6352874",
    direction: "context", directness: "context", population: "Adults in 13 breakfast-consumption trials", intervention: "Advice or assignment to eat breakfast", comparator: "Skipping breakfast",
    duration: "2–16 weeks", sample: "13 randomized trials", finding: "Breakfast assignment was associated with 0.44 kg more weight (95% CI 0.07–0.82) and 260 kcal/day higher intake, but evidence quality was low and heterogeneous.", locator: "Abstract results; risk-of-bias section",
    funding: "No specific funding; fellowships disclosed. Authors declared no relevant financial relationships. Data and analysis code shared on OSF.", riskOfBias: "some-concerns",
    transparency: ["PROSPERO CRD42017057687", "Open data and code", "Independent duplicate extraction", "No specific study funding"],
    limitations: ["Not egg-specific", "All trials had high or unclear risk in at least one domain", "Short follow-up", "High heterogeneity for energy intake"],
  },
];

export const claimRead = {
  status: "uncertain",
  summary:
    "Egg breakfasts can increase short-term satiety relative to some high-carbohydrate comparators, but the better claim-matched long-term evidence does not consistently show greater weight loss.",
  loadBearing: [
    "The 2008 positive result is short, industry-funded, and rated high risk of bias.",
    "The closer six-month replication found no between-diet difference and had substantial attrition.",
    "The 2023 synthesis found no overall weight effect and very high heterogeneity.",
  ],
  cruxes: [
    "Is the comparator a bagel/refined-carbohydrate meal, cereal, another protein-rich meal, or simply no egg?",
    "Is the egg breakfast substituted within a fixed energy prescription or added to the existing diet?",
    "Do acute satiety effects persist long enough to change free-living adherence and total energy intake?",
    "How much should industry funding and high risk of bias discount the positive evidence?",
  ],
};
