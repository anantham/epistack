export const researchTelemetryStorageKey = "epistack:research-telemetry:v1";

const sampleLimit = 60;
export const provisionalSampleThreshold = 3;

export type ResearchStage = "recall" | "pubmed" | "full-text";

const researchStages: ResearchStage[] = ["recall", "pubmed", "full-text"];

// Until this browser has timed runs, estimates fall back to the request
// timeouts, so a first estimate is an upper bound rather than a guess.
const provisionalStageMs: Record<ResearchStage, number> = {
  recall: 120_000,
  pubmed: 8_000,
  "full-text": 150_000,
};

export type ResearchTelemetrySample = {
  stage: ResearchStage;
  effort: string;
  model: string;
  totalMs: number;
  costUsd: number;
  at: string;
};

export type ResearchTelemetry = {
  version: 1;
  samples: ResearchTelemetrySample[];
};

export type ResearchStageEstimate = {
  samples: number;
  estimateMs: number;
  provisional: boolean;
};

export const emptyResearchTelemetry: ResearchTelemetry = { version: 1, samples: [] };

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isStage(value: unknown): value is ResearchStage {
  return typeof value === "string" && (researchStages as string[]).includes(value);
}

function normalizeSample(sample: ResearchTelemetrySample): ResearchTelemetrySample {
  return {
    stage: sample.stage,
    effort: typeof sample.effort === "string" && sample.effort.trim() ? sample.effort.trim() : "standard",
    model: typeof sample.model === "string" ? sample.model.slice(0, 200) : "unknown",
    totalMs: sample.totalMs,
    costUsd: typeof sample.costUsd === "number" && Number.isFinite(sample.costUsd) && sample.costUsd >= 0 ? sample.costUsd : 0,
    at: typeof sample.at === "string" ? sample.at : "",
  };
}

export function parseResearchTelemetry(raw: string | null): ResearchTelemetry {
  try {
    const parsed = JSON.parse(raw || "null") as Partial<ResearchTelemetry> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.samples)) return emptyResearchTelemetry;
    const samples = parsed.samples
      .filter((sample): sample is ResearchTelemetrySample => Boolean(sample) && isStage(sample.stage) && finitePositive(sample.totalMs))
      .map(normalizeSample)
      .slice(-sampleLimit);
    return { version: 1, samples };
  } catch {
    return emptyResearchTelemetry;
  }
}

export function appendResearchTelemetrySample(store: ResearchTelemetry, sample: ResearchTelemetrySample): ResearchTelemetry {
  if (!isStage(sample.stage) || !finitePositive(sample.totalMs)) return store;
  return { version: 1, samples: [...store.samples, normalizeSample(sample)].slice(-sampleLimit) };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Median time for this stage at this effort; provisional until enough runs were timed. */
export function researchStageEstimate(store: ResearchTelemetry, stage: ResearchStage, effort: string): ResearchStageEstimate {
  const sameStage = store.samples.filter((sample) => sample.stage === stage);
  const matching = sameStage.filter((sample) => sample.effort === effort);
  const matchingMedian = median(matching.map((sample) => sample.totalMs));
  if (matching.length >= provisionalSampleThreshold && matchingMedian !== null) {
    return { samples: matching.length, estimateMs: matchingMedian, provisional: false };
  }
  const stageMedian = median(sameStage.map((sample) => sample.totalMs));
  return { samples: matching.length, estimateMs: stageMedian ?? provisionalStageMs[stage], provisional: true };
}
