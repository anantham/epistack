import { z } from "zod";
import type {
  DecompositionArtifact,
  InterpretationAxis,
  InterpretationBranch,
  QuestionHighlight,
} from "./decomposition";

const branchSchema = z.object({
  id: z.string().min(1).max(48),
  label: z.string().min(2).max(90),
  value: z.string().min(1).max(220),
  detail: z.string().min(4).max(280),
  why: z.string().min(4).max(280),
  status: z.enum(["kept", "candidate", "parked"]),
  relevance: z.enum(["high", "medium", "low"]),
  origin: z.literal("ai"),
});

const axisSchema = z.object({
  id: z.string().min(1).max(48),
  label: z.string().min(2).max(90),
  question: z.string().min(4).max(240),
  branches: z.array(branchSchema).min(2).max(4),
});

export const decompositionSchema = z.object({
  caseTitle: z.string().min(3).max(90),
  summary: z.string().min(12).max(320),
  highlights: z.array(z.object({
    quote: z.string().min(1).max(180),
    label: z.string().min(2).max(80),
    why: z.string().min(4).max(220),
    axisId: z.string().min(1).max(48),
  })).min(2).max(8),
  axes: z.array(axisSchema).min(3).max(7),
  claimTemplate: z.string().min(12).max(700),
  knownUnknowns: z.array(z.string().min(4).max(220)).min(3).max(8),
});

export const decompositionInstructions = `You are the question-compilation operator in an epistemic research system.

Turn a vague paragraph into a compact, human-editable interpretation map. Do not answer the question and do not retrieve evidence. Your job is to expose ambiguity that would materially change what evidence is relevant.

Rules:
- Identify 3–7 decision-relevant axes. Avoid exhaustive combinatorics and cosmetic distinctions.
- Give each axis 2–4 concrete branches. Exactly one branch per axis must have status "kept" as the most ordinary or decision-useful provisional reading. Other branches are "candidate" or "parked".
- Branches are alternative scopes, not mutually exclusive truth hypotheses.
- Preserve uncertainty. Do not invent details the paragraph does not contain.
- Every highlight quote must be an exact, case-sensitive substring of the submitted paragraph. Link it to an axis id and explain the hidden choice in plain language.
- Use stable lowercase kebab-case ids, unique across axes and within each branch list.
- origin is always "ai". Relevance expresses decision relevance, not truth.
- claimTemplate must be a grammatical, concrete research question containing placeholders written exactly as {{axis-id}}. Use the axis ids you generated. It may use an axis once or omit a low-value axis, but must remain understandable after replacement with each kept branch's value.
- knownUnknowns are attributes worth recording but not yet important enough to become axes.
- Be concise, methodologically neutral, and domain-general.`;

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "question";
}

function branch(
  id: string,
  label: string,
  value: string,
  detail: string,
  why: string,
  status: InterpretationBranch["status"],
  relevance: InterpretationBranch["relevance"],
): InterpretationBranch {
  return { id, label, value, detail, why, status, relevance, origin: "ai" };
}

function fallbackHighlights(prompt: string, axes: InterpretationAxis[]): QuestionHighlight[] {
  const expressions = [
    /\b(good|bad|great|best|better|worse|safe|dangerous|effective|successful)\b/gi,
    /\b(should|can|could|does|do|is|are)\b/gi,
    /\b(for whom|how much|how often|in moderation|over time|what predicts this)\b/gi,
  ];
  const matches: Array<{ quote: string; index: number }> = [];
  for (const expression of expressions) {
    for (const match of prompt.matchAll(expression)) {
      if (match.index !== undefined && !matches.some((item) => item.index === match.index)) {
        matches.push({ quote: match[0], index: match.index });
      }
    }
  }
  if (matches.length < 2) {
    for (const match of prompt.matchAll(/\b[A-Za-z][A-Za-z'-]{4,}\b/g)) {
      if (match.index !== undefined && !matches.some((item) => item.index === match.index)) {
        matches.push({ quote: match[0], index: match.index });
      }
      if (matches.length >= 4) break;
    }
  }
  return matches
    .sort((a, b) => a.index - b.index)
    .slice(0, 6)
    .map((match, index) => ({
      quote: match.quote,
      label: axes[index % axes.length].label,
      why: axes[index % axes.length].question,
      axisId: axes[index % axes.length].id,
    }));
}

export function createFallbackDecomposition(prompt: string): DecompositionArtifact {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  const subject = oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
  const axes: InterpretationAxis[] = [
    {
      id: "subject",
      label: "What exactly is being discussed?",
      question: "Which concrete object, action, policy, or proposition is the real subject?",
      branches: [
        branch("literal-subject", "Literal reading", subject, "Use the subject exactly as the question states it.", "This preserves the submitted wording before adding narrower constructs.", "kept", "high"),
        branch("narrow-construct", "Narrow construct", "a precisely defined version of the subject", "Replace the everyday label with a measurable construct.", "Evidence can only match a construct that has operational boundaries.", "candidate", "high"),
        branch("broader-system", "Broader system", "the surrounding system that contains the subject", "Treat the named subject as one component of a larger system.", "System context may dominate the named component.", "parked", "medium"),
      ],
    },
    {
      id: "population",
      label: "For whom or where?",
      question: "What population, jurisdiction, site, or stakeholder should the answer apply to?",
      branches: [
        branch("named-population", "Most directly named group", "the population or setting most directly implied by the question", "Use the narrowest group supported by the wording.", "This avoids silent universalization.", "kept", "high"),
        branch("general-population", "General population", "a broad general population", "Ask whether the answer travels beyond the implied group.", "Broader transport requires additional evidence.", "candidate", "medium"),
        branch("high-risk-group", "High-impact subgroup", "a plausibly higher-impact or higher-risk subgroup", "Surface a subgroup for whom the decision has different stakes.", "Average effects can hide consequential heterogeneity.", "candidate", "high"),
      ],
    },
    {
      id: "comparator",
      label: "Compared with what?",
      question: "What alternative, baseline, or counterfactual makes the claim meaningful?",
      branches: [
        branch("status-quo", "Status quo", "the current or ordinary alternative", "Use the ordinary baseline implied by the question.", "Most practical questions compare against what happens otherwise.", "kept", "high"),
        branch("no-action", "No action or exposure", "no action, exposure, or intervention", "Use absence as the counterfactual.", "This isolates whether the named subject changes outcomes at all.", "candidate", "high"),
        branch("best-alternative", "Strong alternative", "the strongest plausible alternative", "Compare with a serious competing option.", "A weak comparator can make a mediocre option look good.", "candidate", "high"),
      ],
    },
    {
      id: "outcome",
      label: "What would count as good or bad?",
      question: "Which measurable outcome carries the conclusion?",
      branches: [
        branch("decision-outcome", "Decision-relevant outcome", "a measurable outcome that directly matters to the decision", "Prefer an outcome tied to the user's decision.", "Proxy improvements may not change what anyone should do.", "kept", "high"),
        branch("proximal-outcome", "Near-term proxy", "a nearer-term proxy or mechanism", "Measure an earlier signal on the causal path.", "Useful for mechanism, but not equivalent to the final outcome.", "candidate", "medium"),
        branch("unintended-effects", "Unintended effects", "important benefits, harms, and distributional effects", "Include outcomes outside the intended target.", "Net value can reverse when omitted effects are counted.", "candidate", "high"),
      ],
    },
    {
      id: "context",
      label: "Under what conditions?",
      question: "Which surrounding conditions, implementation details, or co-exposures may change the answer?",
      branches: [
        branch("ordinary-context", "Ordinary conditions", "ordinary real-world conditions", "Start with the context most readers would assume.", "This makes the first claim recognizable and testable.", "kept", "high"),
        branch("controlled-context", "Controlled conditions", "controlled or ideal implementation conditions", "Ask about efficacy under tighter control.", "Efficacy and real-world effectiveness are different claims.", "candidate", "medium"),
        branch("adverse-context", "Adverse conditions", "plausibly adverse or failure-prone conditions", "Stress-test the claim under credible failure conditions.", "Robust conclusions should name where they break.", "candidate", "high"),
      ],
    },
    {
      id: "horizon",
      label: "Over what time?",
      question: "What time horizon is long enough for the outcome and short enough to study?",
      branches: [
        branch("decision-horizon", "Decision horizon", "a time horizon relevant to the decision", "Use the period over which action would actually be evaluated.", "Immediate and durable effects should not be conflated.", "kept", "high"),
        branch("short-term", "Short term", "the short term", "Focus on immediate response or feasibility.", "Short studies can establish mechanism without durability.", "candidate", "medium"),
        branch("long-term", "Long term", "the long term", "Focus on persistence, adaptation, and delayed effects.", "Some important outcomes only emerge after adaptation.", "candidate", "high"),
      ],
    },
  ];

  return {
    caseTitle: oneLine.split(/[?.!]/)[0].slice(0, 86) || "Untitled question",
    summary: "A local, domain-general decomposition is shown because a model connection is not configured. It is editable and preserves the same artifact contract as an AI-generated map.",
    highlights: fallbackHighlights(prompt, axes),
    axes,
    claimTemplate: "For {{population}}, does {{subject}}, under {{context}}, lead to {{outcome}} over {{horizon}}, compared with {{comparator}}?",
    knownUnknowns: [
      "Whether the everyday terms map cleanly to measurable constructs",
      "Whether the available evidence matches the intended population and setting",
      "Whether important outcomes or stakeholder perspectives are missing",
      "Whether sources share data, incentives, or assumptions",
      "What new evidence would be most likely to change the conclusion",
    ],
  };
}

export function sanitizeDecomposition(
  artifact: DecompositionArtifact,
  prompt: string,
): DecompositionArtifact {
  const axisIds = new Set(artifact.axes.map((axis) => axis.id));
  const fallback = createFallbackDecomposition(prompt);
  const highlights = artifact.highlights.filter(
    (highlight) => prompt.includes(highlight.quote) && axisIds.has(highlight.axisId),
  );
  const axes = artifact.axes.map((axis) => {
    let keptSeen = false;
    const branches = axis.branches.map((item, index) => {
      const keep = item.status === "kept" && !keptSeen;
      if (keep) keptSeen = true;
      return {
        ...item,
        status: keep ? "kept" as const : item.status === "kept" ? "candidate" as const : item.status,
        origin: "ai" as const,
        id: item.id || `${slug(axis.id)}-${index + 1}`,
      };
    });
    if (!keptSeen && branches[0]) branches[0] = { ...branches[0], status: "kept" };
    return { ...axis, branches };
  });

  return {
    ...artifact,
    axes,
    highlights: highlights.length >= 2 ? highlights : fallback.highlights,
  };
}
