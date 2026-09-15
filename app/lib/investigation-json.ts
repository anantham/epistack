import { extractJsonSlice } from "./structured-output.ts";

function canonicalEnum(value: unknown, aliases: Record<string, string>) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return aliases[normalized] || value;
}

function canonicalReviewVerdict(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (/\b(reject|den(?:y|ied)|fail|unsupported|not acceptable)\b/.test(normalized)) return "reject";
  if (/\b(revis|conditional|caveat|partial|mixed|qualif)\b/.test(normalized)) return "revise";
  if (/\b(accept|approv|pass|support)\b/.test(normalized)) return "accept";
  return value;
}

function coerceAuditText(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((item) => coerceAuditText(item)).filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    return parts.length ? parts.join(" ") : value;
  }
  if (value && typeof value === "object") {
    const parts = Object.values(value).map((item) => coerceAuditText(item)).filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    return parts.length ? parts.join(" ") : value;
  }
  return value;
}

const distanceValues = new Set(["exact", "near", "far", "indeterminate"]);
const conclusionFitValues = new Set(["matches-results", "broader-than-results", "narrower-than-results", "not-stated"]);

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function boundedString(value: unknown, maxLength: number, fallback: string) {
  const text = stringValue(value);
  return (text || fallback).slice(0, maxLength);
}

function canonicalClaimFrameId(value: unknown) {
  const candidate = stringValue(value)
    .toLocaleLowerCase("en")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate) ? candidate : "unmapped-claim";
}

function legacyRelation(value: unknown) {
  const normalized = stringValue(value).toLocaleLowerCase("en").replace(/[\s_-]+/g, " ");
  if (!normalized) return "not-informative";
  if (normalized === "no difference" || normalized === "no effect" || normalized === "no association") return "not-informative";
  // These are directional findings, but the legacy response does not carry
  // the claim-relative relation. Preserve them as qualifying observations
  // rather than inventing supports/contradicts semantics.
  if (/^(?:egg )?(?:less favorable|more favorable|higher energy intake)/.test(normalized)) return "qualifies";
  return "not-informative";
}

function legacyResultRole(resultType: string) {
  const normalized = resultType.toLocaleLowerCase("en");
  if (normalized.includes("method")) return "methodological";
  if (normalized.includes("explor")) return "exploratory";
  if (normalized.includes("author") || normalized.includes("interpret")) return "author-interpretation";
  return "secondary";
}

function legacyApplicability(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      matched: [],
      mismatched: [],
      unknown: ["The native response did not provide a structured applicability vector."],
      constraintRelaxations: [],
      distance: "indeterminate",
      rationale: "The native response did not provide the structured applicability fields required for an exact scope judgment.",
    };
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([field, raw]) => [field, stringValue(raw)] as const)
    .filter(([, text]) => Boolean(text));
  const matched: string[] = [];
  const mismatched: string[] = [];
  const unknown: string[] = [];
  for (const [field, text] of entries) {
    const item = `${field}: ${text}`.slice(0, 180);
    const normalized = text.toLocaleLowerCase("en");
    if (/(?:not reported|not described|not stated|unknown|unclear|not measured|not available|depends on|cannot be determined)/.test(normalized)) unknown.push(item);
    else if (/(?:unlike|differs?|does not match|not comparable|shorter than|versus target|unlike the target|target user.*(?:unknown|no known)|mismatch|not the target)/.test(normalized)) mismatched.push(item);
    else matched.push(item);
  }
  const rationale = entries.length
    ? entries.map(([field, text]) => `${field}: ${text}`).join(" ").slice(0, 420)
    : "The native response did not provide the structured applicability fields required for an exact scope judgment.";
  return {
    matched: matched.slice(0, 10),
    mismatched: mismatched.slice(0, 10),
    unknown: unknown.slice(0, 10),
    constraintRelaxations: [],
    // The legacy shape has no explicit distance field. Unknown is safer than
    // treating a prose similarity statement as exact applicability.
    distance: "indeterminate",
    rationale,
  };
}

function normalizeLegacyResult(record: Record<string, unknown>) {
  const legacyType = stringValue(record.resultType);
  const legacyClaim = record.claimFrameId ?? record.claimFrame;
  const legacyPolarity = record.relationPolarity;
  const legacyShape = Boolean(legacyType || record.claimFrame || legacyPolarity);
  if (!legacyShape) return;

  const claimFrameId = canonicalClaimFrameId(legacyClaim);
  const resultText = boundedString(record.resultText, 520, "No directly reported result was supplied for this segment.");
  const applicability = record.applicability;
  const structuredApplicability = applicability && typeof applicability === "object" && !Array.isArray(applicability)
    && Array.isArray((applicability as Record<string, unknown>).matched)
    ? applicability
    : legacyApplicability(applicability);
  const timeHorizon = stringValue(record.timeHorizon)
    || (applicability && typeof applicability === "object" && !Array.isArray(applicability)
      ? stringValue((applicability as Record<string, unknown>).timeHorizon)
      : "")
    || "Not stated in this segment.";

  record.analysisLabel = boundedString(record.analysisLabel, 160, `${claimFrameId} · ${legacyType || "reported result"}`);
  record.analysisType = boundedString(record.analysisType, 100, legacyType || "reported result");
  record.outcome = boundedString(record.outcome, 220, legacyType || resultText);
  record.timeHorizon = boundedString(timeHorizon, 120, "Not stated in this segment.");
  record.resultRole = stringValue(record.resultRole) ? record.resultRole : legacyResultRole(legacyType || "");
  record.resultText = resultText;
  record.estimate = boundedString(record.estimate, 220, "Not stated in this segment.");
  record.exactExcerpt = boundedString(record.exactExcerpt, 420, "");
  record.locator = boundedString(record.locator, 180, "Source segment");
  record.claimFrameId = claimFrameId;
  record.relation = stringValue(record.relation) ? record.relation : legacyRelation(legacyPolarity);
  record.scopeMatch = stringValue(record.scopeMatch) ? record.scopeMatch : "indirect";
  record.applicability = structuredApplicability;
  record.rationale = boundedString(record.rationale, 420, resultText);
}

/**
 * Normalize common model aliases while preserving an explicit unknown value
 * for enum fields whose semantics cannot be inferred safely. This is used for
 * both the native bounded-chunk path and the alternate structured path.
 */
export function normalizeInvestigationJson(text: string) {
  const slice = extractJsonSlice(text);
  if (!slice) return text;
  try {
    const value = JSON.parse(slice) as Record<string, unknown>;
    const results = Array.isArray(value.results) ? value.results : [];
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const record = result as Record<string, unknown>;
      normalizeLegacyResult(record);
      record.rationale = coerceAuditText(record.rationale);
      record.resultRole = canonicalEnum(record.resultRole, {
        "primary result": "primary",
        "secondary result": "secondary",
        "exploratory result": "exploratory",
        "methodological result": "methodological",
        "author interpretation": "author-interpretation",
      });
      record.relation = canonicalEnum(record.relation, {
        "not informative": "not-informative",
      });
      record.scopeMatch = canonicalEnum(record.scopeMatch, {
        "exact match": "direct",
        "partial match": "partial",
        "indirect match": "indirect",
      });
      const applicability = record.applicability;
      if (applicability && typeof applicability === "object") {
        const vector = applicability as Record<string, unknown>;
        vector.rationale = coerceAuditText(vector.rationale);
        const distance = canonicalEnum(vector.distance, {
          "exact match": "exact",
          close: "near",
          similar: "near",
          "near exact": "near",
          distant: "far",
          mismatch: "far",
          unknown: "indeterminate",
          uncertain: "indeterminate",
          unclear: "indeterminate",
          "not known": "indeterminate",
        });
        vector.distance = typeof distance === "string" && distanceValues.has(distance)
          ? distance
          : "indeterminate";
      }
    }
    const reviews = Array.isArray(value.reviews) ? value.reviews : [];
    for (const review of reviews) {
      if (!review || typeof review !== "object") continue;
      const record = review as Record<string, unknown>;
      record.rationale = coerceAuditText(record.rationale);
      record.verdict = canonicalReviewVerdict(record.verdict);
    }
    const conclusionFit = canonicalEnum(value.conclusionFit, {
      "matches result": "matches-results",
      "broader than result": "broader-than-results",
      "narrower than result": "narrower-than-results",
      "not stated": "not-stated",
    });
    value.conclusionFit = typeof conclusionFit === "string" && conclusionFitValues.has(conclusionFit)
      ? conclusionFit
      : "not-stated";
    return JSON.stringify(value);
  } catch {
    return text;
  }
}
