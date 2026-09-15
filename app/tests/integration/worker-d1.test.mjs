import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { networkInterfaces, tmpdir } from "node:os";
import test from "node:test";

// Run this script from the app package (the npm script's cwd), so the spawned
// Vite/Workers process uses the same project-local Wrangler state.
const appRoot = process.cwd();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fetchWithTimeout = (url, init = {}, timeoutMs = 5_000) => fetch(url, {
  ...init,
  signal: AbortSignal.timeout(timeoutMs),
});

function workerReachableHost() {
  const addresses = Object.values(networkInterfaces()).flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  return addresses.find((address) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address))
    || addresses[0]
    || "127.0.0.1";
}

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function makeIntegrationProject(mockUrl) {
  const root = await mkdtemp(join(tmpdir(), "epistack-worker-d1-"));
  const excluded = new Set([".dev.vars", ".wrangler", ".vite", ".vinext", "dist", "node_modules"]);
  for (const entry of await readdir(appRoot)) {
    if (excluded.has(entry)) continue;
    await symlink(join(appRoot, entry), join(root, entry));
  }
  await symlink(join(appRoot, "node_modules"), join(root, "node_modules"));
  await writeFile(join(root, ".dev.vars"), [
    `LYRA_PUBLIC_GATEWAY_URL=${mockUrl}`,
    "LYRA_API_KEY=integration-test-key",
    "JOBS_TICK_TOKEN=integration-jobs-token",
  ].join("\n"));
  return root;
}

function json(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function stageOutput(stage) {
  if (stage === 0) {
    return {
      caseTitle: "Egg decision",
      summary: "A bounded decision map for an everyday egg question.",
      dimensions: [
        { id: "health-outcome", label: "Health outcome" },
        { id: "dose-preparation", label: "Dose and preparation" },
      ],
    };
  }
  if (stage === 1) {
    return {
      traces: [
        {
          dimensionId: "health-outcome",
          label: "Health outcome",
          quotes: ["good to eat"],
          latentVariable: "The outcome that makes eggs useful or harmful.",
          rationale: "The evaluative phrase hides several outcomes that can diverge.",
        },
        {
          dimensionId: "dose-preparation",
          label: "Dose and preparation",
          quotes: ["eat", "moderation"],
          latentVariable: "Amount, frequency, and cooking method.",
          rationale: "The action and qualifier define the exposure being compared.",
        },
      ],
    };
  }
  return {
    enrichments: [
      {
        dimensionId: "health-outcome",
        requiredFields: ["health goal", "relevant medical context"],
        searchConcepts: ["cardiovascular outcomes", "protein adequacy"],
        mismatchRisks: ["A general result may not fit the person's baseline risk."],
        contextQuestion: {
          id: "health-context",
          label: "Health context",
          question: "What health outcome matters most for this decision?",
          whyItMatters: "Different outcomes can point to different evidence.",
          effect: "match",
          options: ["General health", "Cholesterol or heart health"],
        },
      },
      {
        dimensionId: "dose-preparation",
        requiredFields: ["eggs per day", "cooking method"],
        searchConcepts: ["dose response", "fried versus boiled"],
        mismatchRisks: ["Studies may test a different dose or preparation."],
        contextQuestion: {
          id: "dose-context",
          label: "Routine",
          question: "How many eggs do you usually eat, and how are they prepared?",
          whyItMatters: "The evidence must match the exposure being considered.",
          effect: "match",
          options: ["One or two daily", "Less often"],
        },
      },
    ],
    claimTemplate: "For {{health-outcome}} and {{dose-preparation}}, what does the evidence show?",
    knownUnknowns: ["How preparation changes the relevant outcome."],
  };
}

async function startMockAstra(host, failureStatus = null) {
  const receipts = new Map();
  const requests = [];
  let nextReceipt = 0;
  const server = createServer(async (request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.headers.authorization !== "Bearer integration-test-key") {
      json(response, { error: "unauthorized" }, 401);
      return;
    }
    const body = await new Promise((resolve) => {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => resolve(raw ? JSON.parse(raw) : null));
    });
    if (request.method === "POST" && request.url === "/v1/responses") {
      if (failureStatus) {
        json(response, { error: `simulated Astra HTTP ${failureStatus}` }, failureStatus);
        return;
      }
      const metadata = body?.metadata || {};
      const job = String(metadata.client_job || "");
      const stage = job.includes("dimension-scout") ? 0 : job.includes("trace-specialist") ? 1 : 2;
      const id = `job_integration_${nextReceipt++}`;
      receipts.set(id, { stage, polls: 0 });
      json(response, { id, status: "queued", model: "integration-lyra-model" }, 201);
      return;
    }
    const match = request.url?.match(/^\/v1\/responses\/(job_integration_\d+)$/);
    if (request.method === "GET" && match) {
      const receipt = receipts.get(match[1]);
      if (!receipt) {
        json(response, { error: "missing receipt" }, 404);
        return;
      }
      receipt.polls += 1;
      if (receipt.polls === 1) {
        json(response, { id: match[1], status: "in_progress", model: "integration-lyra-model" });
        return;
      }
      json(response, {
        id: match[1],
        status: "completed",
        model: "integration-lyra-model",
        output: [{ content: [{ text: JSON.stringify(stageOutput(receipt.stage)) }] }],
      });
      return;
    }
    json(response, { error: "not found" }, 404);
  });
  // Miniflare's local Worker isolates cannot call the host loopback address;
  // use a real host interface address so the request crosses the runtime
  // boundary while still remaining local to this test machine.
  server.listen(0, "0.0.0.0");
  await once(server, "listening");
  return { server, url: `http://${host}:${server.address().port}`, requests };
}

async function waitForLocalApp(baseUrl, child) {
  let lastError = "";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/`, {}, 1_000);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (child.exitCode !== null) break;
    await sleep(500);
  }
  throw new Error(`Local Worker did not start: ${lastError}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), sleep(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("real local Worker and D1 run a hosted decomposition and expose telemetry", { timeout: 120_000 }, async () => {
  const [appPort, mock] = await Promise.all([unusedPort(), startMockAstra(workerReachableHost())]);
  const baseUrl = `http://localhost:${appPort}`;
  const projectRoot = await makeIntegrationProject(mock.url);
  const child = spawn("/bin/sh", ["-c", `PATH=/opt/homebrew/bin:$PATH npm run dev -- --host 0.0.0.0 --port ${appPort}`], {
    cwd: projectRoot,
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/integration.log" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-4_000); });
  child.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-4_000); });
  try {
    await waitForLocalApp(baseUrl, child);
    const question = "Are eggs good to eat for a healthy adult?";
    const initial = await fetchWithTimeout(`${baseUrl}/api/decompose-live`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ question }),
    }, 10_000);
    assert.equal(initial.status, 202);
    const credentials = await initial.json();
    assert.equal(credentials.status, "queued");

    let completed;
    let lastProgress;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const progressResponse = await fetchWithTimeout(`${baseUrl}/api/decompose-live`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ id: credentials.id, token: credentials.token }),
      }, 10_000);
      const progress = await progressResponse.json();
      lastProgress = progress;
      assert.notEqual(progress.status, "failed", `${JSON.stringify(progress)}; mock calls: ${mock.requests.join(", ")}`);
      if (progress.status === "completed") {
        completed = progress;
        break;
      }
      await sleep(50);
    }
    assert.ok(completed, `the local Worker did not complete the staged job: ${JSON.stringify(lastProgress)}; mock calls: ${mock.requests.join(", ")}`);
    assert.ok(completed.artifact.clusters.length >= 2);
    assert.equal(completed.provenance.provider, "Astra/Lyra");
    assert.equal(completed.provenance.model, "integration-lyra-model");
    assert.deepEqual(completed.provenance.stages.map((stage) => stage.status), ["used", "used", "used"]);

    const statsResponse = await fetchWithTimeout(`${baseUrl}/api/jobs/stats`, {
      headers: { authorization: "Bearer integration-jobs-token" },
    }, 5_000);
    assert.equal(statsResponse.status, 200);
    const stats = await statsResponse.json();
    assert.ok(stats.runs >= 1);
    assert.ok(stats.completed >= 1);
    assert.equal(stats.stages.length, 3);

    const diagnosticsResponse = await fetchWithTimeout(`${baseUrl}/api/jobs/diagnostics`, {
      headers: { authorization: "Bearer integration-jobs-token" },
    }, 5_000);
    assert.equal(diagnosticsResponse.status, 200);
    const diagnostics = await diagnosticsResponse.json();
    const indexNames = diagnostics.indexes.map((index) => index.name).sort();
    assert.deepEqual(indexNames, [
      "decomposition_runs_created_idx",
      "hosted_brief_jobs_locked_idx",
      "hosted_decomposition_jobs_locked_idx",
    ]);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${logs}`);
  } finally {
    await stopProcess(child);
    await new Promise((resolve) => mock.server.close(resolve));
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("real local Worker turns an Astra 525 into a resumable fallback signal", { timeout: 60_000 }, async () => {
  const [appPort, mock] = await Promise.all([unusedPort(), startMockAstra(workerReachableHost(), 525)]);
  const projectRoot = await makeIntegrationProject(mock.url);
  const baseUrl = `http://localhost:${appPort}`;
  const child = spawn("/bin/sh", ["-c", `PATH=/opt/homebrew/bin:$PATH npm run dev -- --host 0.0.0.0 --port ${appPort}`], {
    cwd: projectRoot,
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/integration-525.log" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-4_000); });
  child.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-4_000); });
  try {
    await waitForLocalApp(baseUrl, child);
    const initial = await fetchWithTimeout(`${baseUrl}/api/decompose-live`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ question: "Are eggs useful to eat for breakfast?" }),
    }, 10_000);
    assert.equal(initial.status, 202);
    const credentials = await initial.json();
    const failed = await fetchWithTimeout(`${baseUrl}/api/decompose-live`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ id: credentials.id, token: credentials.token }),
    }, 10_000);
    const payload = await failed.json();
    assert.equal(payload.status, "failed", `${JSON.stringify(payload)}\n${logs}`);
    assert.equal(payload.code, "backend-unreachable");
    assert.match(payload.error, /falling back to the alternate provider/i);
    assert.deepEqual(mock.requests, ["POST /v1/responses"]);
  } finally {
    await stopProcess(child);
    await new Promise((resolve) => mock.server.close(resolve));
    await rm(projectRoot, { recursive: true, force: true });
  }
});
