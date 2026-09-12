import { z } from "zod";
import { lyraConfigured } from "../../../lib/lyra-stage";
import { comparisonScopeSchema, computeDivergence } from "../../../lib/source-divergence.ts";

const requestSchema = z.object({
  items: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    sourceClass: z.string().trim().min(1),
    statement: z.string().trim().min(1),
    comparisonScope: comparisonScopeSchema,
  })).min(2).max(60),
});
const maxBodyBytes = 128 * 1024;
const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Use this site to compare sources for divergence." }, 403);
  }
  if (Number(request.headers.get("content-length")) > maxBodyBytes) {
    return json({ error: "Request body must not exceed 128 KiB." }, 413);
  }

  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Request body must be valid JSON." }, 400);
    const decoder = new TextDecoder();
    let bytes = 0;
    let raw = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBodyBytes) {
          void reader.cancel().catch(() => {});
          return json({ error: "Request body must not exceed 128 KiB." }, 413);
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Provide 2–60 items with valid id, sourceClass, statement, and comparisonScope fields." }, 400);
  }
  if (!lyraConfigured()) {
    return json({ error: "Divergence is not configured yet.", code: "hosted-not-configured" }, 503);
  }

  try {
    // Return context only; do not promote model comparisons into causal evidence.
    const divergences = await computeDivergence(parsed.data.items);
    return json({ divergences });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The divergence comparison failed." }, 502);
  }
}
