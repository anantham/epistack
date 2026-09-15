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
