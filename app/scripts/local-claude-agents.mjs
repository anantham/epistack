#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { renderAgentPrompt, resolveAgentPrompt, sanitizeAgentPromptOverrides } from "../lib/agent-prompts.ts";
import {
  normalizeRecallLane,
  recallLaneDraftSchema,
  recallRequestSchema,
  recallResponseSchema,
  recallToolTraceEventSchema,
} from "../lib/broad-recall.ts";
import {
  adversarialReviewSchema,
  adjudicateDualReview,
  dualReviewPolicyId,
  fullPaperExtractionSchema,
} from "../lib/dual-review.ts";
import {
  buildDimensionAssignments,
  completeDimensionRoles,
  normalizeResearchBriefDraft,
  researchBriefDraftSchema,
  researchBriefSchema,
  researchClaimFrameSchema,
} from "../lib/research-brief.ts";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const storeRoot = process.env.EPISTACK_AGENT_STORE || join(appRoot, ".epistack");
const sourceRoot = join(storeRoot, "sources");
const cacheRoot = join(storeRoot, "agent-cache");
const briefCacheRoot = join(storeRoot, "brief-cache");
const recallCacheRoot = join(storeRoot, "recall-cache");
const port = Number(process.env.EPISTACK_AGENT_PORT || 4317);
const claudeBinary = process.env.EPISTACK_CLAUDE_BIN || "claude";
const primaryModel = process.env.EPISTACK_PRIMARY_CLAUDE_MODEL || "opus";
const adversaryModel = process.env.EPISTACK_ADVERSARY_CLAUDE_MODEL || "sonnet";
const primaryBudget = process.env.EPISTACK_PRIMARY_MAX_USD || "8";
const adversaryBudget = process.env.EPISTACK_ADVERSARY_MAX_USD || "6";
const compilerBudget = process.env.EPISTACK_COMPILER_MAX_USD || "5";
const recallBudget = process.env.EPISTACK_RECALL_MAX_USD || "4";
const researchBriefCompilerCacheContract = "research-brief-compiler-v1";
const broadRecallCacheContract = "broad-recall-v1";

function claimFramesText(claimFrames) {
  return claimFrames.map((frame) => [
    frame.id,
    frame.statement,
    `Kind: ${frame.kind}`,
    `Population: ${frame.population}`,
    `Exposure: ${frame.exposure}`,
    `Comparator: ${frame.comparator}`,
    `Outcome: ${frame.outcome}`,
    `Time horizon: ${frame.timeHorizon}`,
    `Applicability fields: ${frame.applicabilityFields.join(", ")}`,
  ].join("\n")).join("\n\n");
}

function recallClaimFramesText(claimFrames) {
  return claimFrames.map((frame) => [
    frame.id,
    frame.statement,
    `Population: ${frame.population}`,
    `Exposure/action: ${frame.exposure}`,
    `Comparator: ${frame.comparator}`,
    `Outcome: ${frame.outcome}`,
    `Time horizon: ${frame.timeHorizon}`,
    `Decision leverage: ${frame.decisionLeverage}`,
    `Applicability fields: ${frame.applicabilityFields.join(", ")}`,
  ].join("\n")).join("\n\n");
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeXmlEntities(value) {
  const named = new Map([
    ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"],
    ["nbsp", " "], ["minus", "−"], ["ndash", "–"], ["mdash", "—"], ["times", "×"],
  ]);
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named.get(code.toLowerCase()) ?? entity;
  });
}

export function jatsToPlainText(xml) {
  return decodeXmlEntities(xml
    .replace(/<\/?(?:p|sec|title|caption|tr|table-wrap|fig|list-item|abstract|article-title|kwd|ack|fn|ref-list)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safePmcNumeric(value) {
  const numeric = String(value || "").replace(/^PMC/i, "");
  return /^\d{4,12}$/.test(numeric) ? numeric : null;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Epistack Evidence Lab/0.1 (local full-text acquisition)" } });
  if (!response.ok) throw new Error(`NCBI returned ${response.status} for ${url.pathname}.`);
  return response.json();
}

async function resolvePmcNumeric(pmid) {
  const url = new URL("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/");
  url.searchParams.set("ids", pmid);
  url.searchParams.set("format", "json");
  url.searchParams.set("tool", "epistack-evidence-lab");
  const payload = await fetchJson(url);
  const record = Array.isArray(payload?.records) ? payload.records[0] : null;
  return safePmcNumeric(record?.pmcid);
}

export async function acquirePmcArtifact(pmid, refresh = false) {
  await mkdir(sourceRoot, { recursive: true });
  const pmcNumeric = await resolvePmcNumeric(pmid);
  if (!pmcNumeric) {
    const error = new Error("No open PMC full text is linked to this PubMed record. Automatic promotion is disabled; use the explicit abstract-only fallback or add a lawful full-text artifact later.");
    error.code = "NO_OPEN_FULL_TEXT";
    throw error;
  }
  const pmcid = `PMC${pmcNumeric}`;
  const localXmlPath = join(sourceRoot, `${pmcid}.xml`);
  const localTextPath = join(sourceRoot, `${pmcid}.txt`);
  let xml;
  let retrievedAt;
  try {
    if (refresh) throw new Error("refresh requested");
    xml = await readFile(localXmlPath, "utf8");
    retrievedAt = (await stat(localXmlPath)).mtime.toISOString();
  } catch {
    const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
    url.searchParams.set("db", "pmc");
    url.searchParams.set("id", pmcNumeric);
    url.searchParams.set("retmode", "xml");
    const response = await fetch(url, { headers: { "User-Agent": "Epistack Evidence Lab/0.1 (local full-text acquisition)" } });
    if (!response.ok) throw new Error(`PMC full-text fetch returned ${response.status}.`);
    xml = await response.text();
    if (!/<article[\s>]/i.test(xml) || xml.length < 5_000) throw new Error("PMC did not return a complete JATS article.");
    retrievedAt = new Date().toISOString();
    await writeFile(localXmlPath, xml, "utf8");
  }
  const plainText = jatsToPlainText(xml);
  await writeFile(localTextPath, plainText, "utf8");
  return {
    artifact: {
      kind: "pmc-jats",
      pmcid,
      canonicalUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
      localXmlPath,
      localTextPath,
      contentHash: hash(xml),
      retrievedAt,
    },
    plainText,
  };
}

function parseJsonText(value) {
  if (typeof value !== "string") return value;
  const stripped = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(stripped);
}

export function parseClaudeStructuredOutput(stdout) {
  const outer = parseJsonText(stdout);
  if (!outer || typeof outer !== "object") throw new Error("Claude CLI did not return a JSON result envelope.");
  if (outer.is_error) throw new Error(typeof outer.result === "string" ? outer.result : "Claude CLI returned an error.");
  const candidate = outer.structured_output ?? outer.result ?? outer;
  return parseJsonText(candidate);
}

async function runClaudeAgent({ name, model, budget, prompt, schema }) {
  const schemaObject = z.toJSONSchema(schema);
  delete schemaObject.$schema;
  const schemaJson = JSON.stringify(schemaObject);
  const args = [
    "-p",
    "--name", name,
    "--model", model,
    "--effort", "max",
    "--output-format", "json",
    "--json-schema", schemaJson,
    "--permission-mode", "dontAsk",
    "--no-session-persistence",
    "--no-chrome",
    "--max-budget-usd", budget,
    "--allowedTools", "Read", "Grep", "WebSearch", "WebFetch",
    "--add-dir", sourceRoot,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBinary, args, { cwd: appRoot, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${name} exceeded the 12-minute local-agent timeout.`));
    }, 12 * 60 * 1000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error.code === "ENOENT"
        ? new Error("Claude CLI is not installed or is not on PATH. Install it and authenticate, then restart npm run agents.")
        : error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `${name} exited with code ${code}.`));
        return;
      }
      try {
        resolve(parseClaudeStructuredOutput(stdout));
      } catch (error) {
        reject(new Error(`${name} returned unusable structured output: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

function toolInputText(input, keys) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 2_000);
  }
  return null;
}

/**
 * Extract only invocation metadata from Claude's actual stream. Fetched page
 * bodies are deliberately not copied into the event log.
 */
export function extractRecallToolTraceEvents(event, lane, pendingTools = new Map(), observedAt = new Date().toISOString()) {
  const events = [];
  if (event?.type === "assistant" && Array.isArray(event?.message?.content)) {
    for (const block of event.message.content) {
      if (block?.type !== "tool_use" || !["WebSearch", "WebFetch"].includes(block.name) || typeof block.id !== "string") continue;
      const requested = recallToolTraceEventSchema.parse({
        id: `${lane}:${block.id}:requested`,
        toolUseId: block.id,
        lane,
        tool: block.name,
        state: "requested",
        query: block.name === "WebSearch" ? toolInputText(block.input, ["query", "search_query", "q"]) : null,
        url: block.name === "WebFetch" ? toolInputText(block.input, ["url", "uri"]) : null,
        observedAt,
        provenance: "claude-cli-stream",
      });
      pendingTools.set(block.id, requested);
      events.push(requested);
    }
  }
  if (event?.type === "user" && Array.isArray(event?.message?.content)) {
    for (const block of event.message.content) {
      if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const requested = pendingTools.get(block.tool_use_id);
      if (!requested) continue;
      const completed = recallToolTraceEventSchema.parse({
        ...requested,
        id: `${lane}:${block.tool_use_id}:${block.is_error === true ? "failed" : "completed"}`,
        state: block.is_error === true ? "failed" : "completed",
        observedAt,
      });
      pendingTools.delete(block.tool_use_id);
      events.push(completed);
    }
  }
  return events;
}

async function runClaudeStreamingAgent({ name, model, budget, prompt, schema, lane, emit }) {
  const schemaObject = z.toJSONSchema(schema);
  delete schemaObject.$schema;
  const args = [
    "-p",
    "--name", name,
    "--model", model,
    "--effort", "max",
    "--verbose",
    "--output-format", "stream-json",
    "--json-schema", JSON.stringify(schemaObject),
    "--permission-mode", "dontAsk",
    "--no-session-persistence",
    "--no-chrome",
    "--safe-mode",
    "--max-budget-usd", budget,
    "--tools", "WebSearch,WebFetch",
    "--allowedTools", "WebSearch,WebFetch",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBinary, args, { cwd: appRoot, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let buffered = "";
    let resultEvent = null;
    const trace = [];
    const seenTraceIds = new Set();
    const pendingTools = new Map();
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${name} exceeded the 12-minute local-agent timeout.`));
    }, 12 * 60 * 1000);
    const processLine = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event?.type === "result") resultEvent = event;
      const observed = extractRecallToolTraceEvents(event, lane, pendingTools);
      for (const traceEvent of observed) {
        if (seenTraceIds.has(traceEvent.id)) continue;
        seenTraceIds.add(traceEvent.id);
        trace.push(traceEvent);
        emit({ type: "tool", event: traceEvent });
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffered += chunk;
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        processLine(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error.code === "ENOENT"
        ? new Error("Claude CLI is not installed or is not on PATH. Install it and authenticate, then restart npm run agents.")
        : error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      processLine(buffered);
      if (code !== 0) {
        reject(new Error(stderr.trim() || resultEvent?.result || `${name} exited with code ${code}.`));
        return;
      }
      try {
        resolve({
          structured: parseClaudeStructuredOutput(JSON.stringify(resultEvent)),
          trace,
          serverToolUse: resultEvent?.usage?.server_tool_use ?? null,
        });
      } catch (error) {
        reject(new Error(`${name} returned unusable structured output: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

function citationFor(record) {
  return [record.title, record.authors, `${record.journal} · ${record.published}`, `PMID ${record.pmid}${record.doi ? ` · DOI ${record.doi}` : ""}`].join("\n");
}

function sourceFor(record, artifact) {
  return {
    pmid: record.pmid,
    title: record.title,
    authors: record.authors,
    journal: record.journal,
    published: record.published,
    doi: record.doi ?? null,
    url: artifact.canonicalUrl,
    abstract: "",
  };
}

function validateInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  const record = value.record;
  if (!record || typeof record !== "object" || !/^\d{5,12}$/.test(String(record.pmid || ""))) throw new Error("A valid PubMed record is required.");
  if (typeof record.title !== "string" || record.title.trim().length < 4) throw new Error("The PubMed title is missing.");
  const parsedClaimFrames = z.array(researchClaimFrameSchema).min(1).max(7).safeParse(value.claimFrames);
  if (!parsedClaimFrames.success) throw new Error("The investigation request is missing the compiled claim frames. Return to Contextualize and compile a research brief first.");
  return {
    record: {
      pmid: String(record.pmid),
      title: record.title.trim(),
      authors: typeof record.authors === "string" ? record.authors : "Authors not returned",
      journal: typeof record.journal === "string" ? record.journal : "Journal not returned",
      published: typeof record.published === "string" ? record.published : "Date not returned",
      doi: typeof record.doi === "string" ? record.doi : null,
      url: typeof record.url === "string" ? record.url : `https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`,
    },
    question: typeof value.question === "string" && value.question.trim() ? value.question.trim().slice(0, 4_000) : "Are eggs good to eat?",
    decisionContext: typeof value.decisionContext === "string" && value.decisionContext.trim() ? value.decisionContext.trim().slice(0, 8_000) : "No personal decision context supplied.",
    claimFrames: parsedClaimFrames.data,
    applicabilityProfile: value.applicabilityProfile && typeof value.applicabilityProfile === "object"
      ? JSON.stringify(value.applicabilityProfile, null, 2).slice(0, 20_000)
      : "No structured applicability profile supplied.",
    promptOverrides: sanitizeAgentPromptOverrides(value.promptOverrides),
    refresh: value.refresh === true,
  };
}

export async function investigateWithClaude(inputValue, emit = () => {}) {
  const input = validateInput(inputValue);
  if (primaryModel.trim().toLowerCase() === adversaryModel.trim().toLowerCase()) throw new Error("Primary and adversarial Claude models must differ. Set EPISTACK_PRIMARY_CLAUDE_MODEL and EPISTACK_ADVERSARY_CLAUDE_MODEL.");
  await mkdir(cacheRoot, { recursive: true });

  emit({ type: "status", phase: "acquiring", label: "Acquiring and hashing PMC full text" });
  const { artifact, plainText } = await acquirePmcArtifact(input.record.pmid, input.refresh);
  const extractorPrompt = resolveAgentPrompt("full-paper-extractor", input.promptOverrides);
  const reviewerPrompt = resolveAgentPrompt("adversarial-reviewer", input.promptOverrides);
  const cacheKey = hash(JSON.stringify({
    contract: dualReviewPolicyId,
    artifactHash: artifact.contentHash,
    question: input.question,
    decisionContext: input.decisionContext,
    claimFrames: input.claimFrames,
    applicabilityProfile: input.applicabilityProfile,
    primaryModel,
    adversaryModel,
    extractorPrompt,
    reviewerPrompt,
  }));
  const cachePath = join(cacheRoot, `${cacheKey}.json`);
  if (!input.refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8"));
      emit({ type: "status", phase: "cache-hit", label: "Reusing the hashed dual-agent run" });
      return { ...cached, cache: { ...cached.cache, status: "hit", key: cacheKey } };
    } catch {
      // A cache miss is the normal first-run path.
    }
  }

  const commonValues = {
    question: input.question,
    decisionContext: input.decisionContext,
    citation: citationFor(input.record),
    artifactTextPath: artifact.localTextPath,
    artifactXmlPath: artifact.localXmlPath,
    artifactHash: artifact.contentHash,
    claimFrames: claimFramesText(input.claimFrames),
    applicabilityProfile: input.applicabilityProfile,
  };
  const primaryPrompt = `${extractorPrompt.instructions}\n\n${renderAgentPrompt(extractorPrompt.taskTemplate, commonValues)}`;
  emit({ type: "status", phase: "extracting", label: `${primaryModel} is decomposing methods, tables, and results` });
  const primaryRaw = await runClaudeAgent({
    name: `epistack-primary-${input.record.pmid}`,
    model: primaryModel,
    budget: primaryBudget,
    prompt: primaryPrompt,
    schema: fullPaperExtractionSchema,
  });
  const primary = fullPaperExtractionSchema.parse(primaryRaw);

  const indexedCandidate = primary.results.map((result, resultIndex) => ({ resultIndex, ...result }));
  const reviewPrompt = `${reviewerPrompt.instructions}\n\n${renderAgentPrompt(reviewerPrompt.taskTemplate, {
    ...commonValues,
    candidateJson: JSON.stringify({ ...primary, results: indexedCandidate }, null, 2),
  })}`;
  emit({ type: "status", phase: "reviewing", label: `${adversaryModel} is trying to falsify ${primary.results.length} result records` });
  const reviewRaw = await runClaudeAgent({
    name: `epistack-adversary-${input.record.pmid}`,
    model: adversaryModel,
    budget: adversaryBudget,
    prompt: reviewPrompt,
    schema: adversarialReviewSchema,
  });
  const review = adversarialReviewSchema.parse(reviewRaw);

  emit({ type: "status", phase: "adjudicating", label: "Checking quotations against the preserved artifact" });
  const adjudicated = adjudicateDualReview({ primary, review, fullText: plainText, artifact, primaryModel, adversaryModel });
  const createdAt = new Date().toISOString();
  const response = {
    source: sourceFor(input.record, artifact),
    artifact: { ...artifact, localXmlPath: relative(appRoot, artifact.localXmlPath), localTextPath: relative(appRoot, artifact.localTextPath) },
    primaryCandidate: primary,
    candidate: adjudicated.candidate,
    review,
    decisions: adjudicated.decisions,
    promotion: {
      policyId: adjudicated.policyId,
      eligible: adjudicated.eligible,
      acceptedCount: adjudicated.acceptedCount,
      rejectedCount: adjudicated.rejectedCount,
      reasons: adjudicated.reasons,
    },
    models: { primary: primaryModel, adversary: adversaryModel },
    verificationStatus: "ai-cross-checked-full-text",
    cache: { status: input.refresh ? "bypass" : "miss", key: cacheKey, createdAt },
  };
  await writeFile(cachePath, JSON.stringify(response, null, 2), "utf8");
  return response;
}

function cleanCompilerInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  const axes = Array.isArray(value.axes) ? value.axes : [];
  const clusters = Array.isArray(value.clusters) ? value.clusters : [];
  if (!axes.length || !axes.every((axis) => axis && typeof axis.id === "string" && typeof axis.label === "string" && Array.isArray(axis.branches))) {
    throw new Error("The edited interpretation map is missing its dimensions.");
  }
  const originalQuestion = typeof value.originalQuestion === "string" ? value.originalQuestion.trim().slice(0, 5_000) : "";
  const compiledQuestion = typeof value.compiledQuestion === "string" ? value.compiledQuestion.trim().slice(0, 5_000) : "";
  if (originalQuestion.length < 8 || compiledQuestion.length < 8) throw new Error("Both the original and compiled questions are required.");
  const dimensionRoles = completeDimensionRoles(axes, value.dimensionRoles && typeof value.dimensionRoles === "object" ? value.dimensionRoles : {});
  return {
    caseId: typeof value.caseId === "string" && value.caseId.trim() ? value.caseId.trim().slice(0, 120) : `case-${hash(originalQuestion).slice(0, 12)}`,
    originalQuestion,
    compiledQuestion,
    decisionContext: typeof value.decisionContext === "string" ? value.decisionContext.trim().slice(0, 8_000) : "",
    axes,
    clusters,
    knownUnknowns: Array.isArray(value.knownUnknowns) ? value.knownUnknowns.filter((item) => typeof item === "string").slice(0, 20) : [],
    dimensionRoles,
    dimensionAssignments: buildDimensionAssignments({ axes, clusters, dimensionRoles }),
    prior: Number.isFinite(value.prior) ? Math.max(0.01, Math.min(0.99, Number(value.prior))) : 0.5,
    promptOverrides: sanitizeAgentPromptOverrides(value.promptOverrides),
    refresh: value.refresh === true,
  };
}

export async function compileResearchBriefWithClaude(inputValue, emit = () => {}) {
  const input = cleanCompilerInput(inputValue);
  await mkdir(briefCacheRoot, { recursive: true });
  const compilerPrompt = resolveAgentPrompt("research-brief-compiler", input.promptOverrides);
  const basePrompt = renderAgentPrompt(compilerPrompt.taskTemplate, {
    question: input.originalQuestion,
    compiledQuestion: input.compiledQuestion,
    decisionContext: input.decisionContext || "No personal context supplied. Preserve this as an explicit limitation.",
    dimensionAssignmentsJson: JSON.stringify(input.dimensionAssignments, null, 2),
    axesJson: JSON.stringify(input.axes, null, 2),
    knownUnknownsJson: JSON.stringify(input.knownUnknowns, null, 2),
  });
  const cacheKey = hash(JSON.stringify({
    contract: researchBriefCompilerCacheContract,
    model: primaryModel,
    input: {
      caseId: input.caseId,
      originalQuestion: input.originalQuestion,
      compiledQuestion: input.compiledQuestion,
      decisionContext: input.decisionContext,
      axes: input.axes,
      dimensionAssignments: input.dimensionAssignments,
      knownUnknowns: input.knownUnknowns,
      prior: input.prior,
    },
    compilerPrompt,
  }));
  const cachePath = join(briefCacheRoot, `${cacheKey}.json`);
  if (!input.refresh) {
    try {
      const cached = researchBriefSchema.parse(JSON.parse(await readFile(cachePath, "utf8")));
      emit({ type: "status", phase: "cache-hit", label: "Reusing the exact compiled research brief" });
      return { brief: cached, model: primaryModel, cache: { status: "hit", key: cacheKey, createdAt: cached.generatedAt } };
    } catch {
      // A cache miss or stale schema proceeds to a fresh compiler run.
    }
  }

  let draft = null;
  let validation = "";
  for (let attempt = 0; attempt < 2 && !draft; attempt += 1) {
    emit({
      type: "status",
      phase: attempt === 0 ? "compiling" : "repairing",
      label: attempt === 0 ? `${primaryModel} is allocating claims and retrieval budgets` : "Repairing the structured research contract",
    });
    const task = attempt === 0
      ? basePrompt
      : renderAgentPrompt(compilerPrompt.repairTemplate || "{{basePrompt}}", { basePrompt, validation });
    const raw = await runClaudeAgent({
      name: `epistack-brief-${hash(input.originalQuestion).slice(0, 10)}-${attempt + 1}`,
      model: primaryModel,
      budget: compilerBudget,
      prompt: `${compilerPrompt.instructions}\n\n${task}`,
      schema: researchBriefDraftSchema,
    });
    const parsed = researchBriefDraftSchema.safeParse(raw);
    if (parsed.success) draft = normalizeResearchBriefDraft(parsed.data, input.axes.map((axis) => axis.id));
    else validation = parsed.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  }
  if (!draft) throw new Error(`The research brief compiler returned an incomplete contract after two attempts${validation ? `: ${validation}` : "."}`);

  emit({ type: "status", phase: "validating", label: "Checking traceability, privacy boundaries, and token allocation" });
  const generatedAt = new Date().toISOString();
  const brief = researchBriefSchema.parse({
    ...draft,
    schemaVersion: "0.2.0",
    briefId: `brief-${cacheKey.slice(0, 24)}`,
    caseId: input.caseId,
    originalQuestion: input.originalQuestion,
    compiledQuestion: input.compiledQuestion,
    decisionContext: input.decisionContext,
    dimensionAssignments: input.dimensionAssignments,
    privacy: {
      localContextPolicy: "The full decision context stays in this device-local brief and may be read by the local Claude companion; it is not sent to PubMed.",
      outboundQueryPolicy: "Only each claim's compact searchQuery and publication filters leave the local workflow during discovery.",
    },
    generatedAt,
    compiledBy: `local Claude · ${primaryModel}`,
  });
  await writeFile(cachePath, JSON.stringify(brief, null, 2), "utf8");
  return { brief, model: primaryModel, cache: { status: input.refresh ? "bypass" : "miss", key: cacheKey, createdAt: generatedAt } };
}

function cleanRecallInput(value) {
  const parsed = recallRequestSchema.parse(value);
  return {
    ...parsed,
    compiledQuestion: parsed.compiledQuestion || parsed.question,
    promptOverrides: sanitizeAgentPromptOverrides(parsed.promptOverrides),
  };
}

export async function discoverRecallWithClaude(inputValue, emit = () => {}) {
  const input = cleanRecallInput(inputValue);
  await mkdir(recallCacheRoot, { recursive: true });
  const specialistPrompt = resolveAgentPrompt("broad-recall-specialist", input.promptOverrides);
  const cacheKey = hash(JSON.stringify({
    contract: broadRecallCacheContract,
    model: primaryModel,
    question: input.question,
    compiledQuestion: input.compiledQuestion,
    claims: input.claims,
    applicabilityProfile: input.applicabilityProfile,
    specialistPrompt,
  }));
  const cachePath = join(recallCacheRoot, `${cacheKey}.json`);
  if (!input.refresh) {
    try {
      const cached = recallResponseSchema.parse(JSON.parse(await readFile(cachePath, "utf8")));
      emit({ type: "status", phase: "cache-hit", label: "Reusing the exact lead-discovery run" });
      return recallResponseSchema.parse({
        ...cached,
        cache: { ...cached.cache, status: "hit" },
      });
    } catch {
      // A miss or stale schema proceeds to a fresh discovery run.
    }
  }

  const lanes = ["broad-recall", "applicability"];
  const commonValues = {
    question: input.question,
    compiledQuestion: input.compiledQuestion,
    claimFrames: recallClaimFramesText(input.claims),
    applicabilityProfile: JSON.stringify(input.applicabilityProfile, null, 2),
  };
  const laneRuns = await Promise.all(lanes.map(async (lane) => {
    emit({
      type: "status",
      phase: lane,
      lane,
      label: lane === "broad-recall"
        ? `${primaryModel} is searching for broad and disconfirming leads`
        : `${primaryModel} is searching for transportability leads`,
    });
    const task = renderAgentPrompt(specialistPrompt.taskTemplate, { ...commonValues, lane });
    const run = await runClaudeStreamingAgent({
      name: `epistack-${lane}-${cacheKey.slice(0, 10)}`,
      model: primaryModel,
      budget: recallBudget,
      prompt: `${specialistPrompt.instructions}\n\n${task}`,
      schema: recallLaneDraftSchema,
      lane,
      emit,
    });
    const draft = recallLaneDraftSchema.parse(run.structured);
    const validClaimIds = new Set(input.claims.map((claim) => claim.id));
    const invalidClaimIds = draft.leads.flatMap((lead) => lead.claimIds).filter((claimId) => !validClaimIds.has(claimId));
    if (invalidClaimIds.length) {
      throw new Error(`${lane} returned unknown claim ids: ${Array.from(new Set(invalidClaimIds)).join(", ")}.`);
    }
    return { lane, draft, trace: run.trace, serverToolUse: run.serverToolUse };
  }));

  const toolTrace = laneRuns.flatMap((run) => run.trace);
  const normalized = laneRuns.map((run) => normalizeRecallLane(run.lane, run.draft, toolTrace));
  const leads = normalized.flatMap((result) => result.leads);
  const capturedToolEvents = toolTrace.filter((event) => event.state === "requested").length;
  const generatedAt = new Date().toISOString();
  const response = recallResponseSchema.parse({
    schemaVersion: "0.1.0",
    status: "lead-only",
    question: input.question,
    compiledQuestion: input.compiledQuestion,
    generatedAt,
    model: primaryModel,
    lanes: normalized.map((result) => result.lane),
    leads,
    toolTrace,
    observability: capturedToolEvents
      ? {
        mode: "cli-tool-events",
        capturedToolEvents,
        boundary: "The local companion observed WebSearch and WebFetch invocation inputs and completion states in Claude CLI's stream. It cannot observe the search engine's ranking, omitted candidates, or guarantee that an accessible page was complete.",
      }
      : {
        mode: "model-reported-only",
        capturedToolEvents: 0,
        boundary: "No WebSearch or WebFetch invocation inputs were present in the Claude CLI stream. Lead queries are model-reported and must not be described as observed execution traces.",
      },
    cache: {
      status: input.refresh ? "bypass" : "miss",
      key: cacheKey,
      createdAt: generatedAt,
    },
  });
  await writeFile(cachePath, JSON.stringify(response, null, 2), "utf8");
  return response;
}

const configuredBrowserOrigins = new Set(
  String(process.env.EPISTACK_ALLOWED_BROWSER_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        const parsed = new URL(value);
        return /^https?:$/.test(parsed.protocol) ? [parsed.origin] : [];
      } catch {
        return [];
      }
    }),
);

function allowedBrowserOrigin(origin) {
  return !origin
    || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)
    || configuredBrowserOrigins.has(origin);
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedBrowserOrigin(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.headers["access-control-request-private-network"] === "true" && allowedBrowserOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  response.setHeader("Vary", "Origin");
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 300_000) throw new Error("Request body exceeds 300 KB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createLocalAgentServer() {
  return createServer(async (request, response) => {
    setCors(request, response);
    if (!allowedBrowserOrigin(request.headers.origin)) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: "This browser origin is not authorized for the local Claude companion. Run the web app locally or add its exact origin to EPISTACK_ALLOWED_BROWSER_ORIGINS and restart npm run agents.",
      }));
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        service: "epistack-local-claude",
        policyId: dualReviewPolicyId,
        models: { primary: primaryModel, adversary: adversaryModel },
        capabilities: ["research-brief-compiler", "lead-only-broad-recall", "full-paper-extraction", "adversarial-review"],
        store: relative(appRoot, storeRoot),
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/compile-brief") {
      response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
      const emit = (event) => response.write(`${JSON.stringify(event)}\n`);
      try {
        const payload = await compileResearchBriefWithClaude(await readBody(request), emit);
        emit({ type: "complete", payload });
      } catch (error) {
        emit({
          type: "error",
          code: "RESEARCH_BRIEF_FAILURE",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        response.end();
      }
      return;
    }
    if (request.method === "POST" && request.url === "/recall") {
      response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
      const emit = (event) => response.write(`${JSON.stringify(event)}\n`);
      try {
        const payload = await discoverRecallWithClaude(await readBody(request), emit);
        emit({ type: "complete", payload });
      } catch (error) {
        emit({
          type: "error",
          code: "RECALL_DISCOVERY_FAILURE",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        response.end();
      }
      return;
    }
    if (request.method === "POST" && request.url === "/investigate") {
      response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
      const emit = (event) => response.write(`${JSON.stringify(event)}\n`);
      try {
        const payload = await investigateWithClaude(await readBody(request), emit);
        emit({ type: "complete", payload });
      } catch (error) {
        emit({
          type: "error",
          code: typeof error?.code === "string" ? error.code : "LOCAL_AGENT_FAILURE",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        response.end();
      }
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createLocalAgentServer();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Epistack local Claude companion listening at http://127.0.0.1:${port}\n`);
    process.stdout.write(`Primary ${primaryModel} · adversary ${adversaryModel} · policy ${dualReviewPolicyId}\n`);
  });
}
