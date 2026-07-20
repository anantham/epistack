import { compilePubmedQuery, publicationFilters, type PublicationFilter, type PubmedDiscovery } from "../../../lib/research";
import { operationCacheKey, readOperationCache, writeOperationCache } from "../../../db/cache";
import type { ResearchResponse } from "../../../lib/research";

type ResearchRequest = {
  query?: unknown;
  filters?: unknown;
  maxResults?: unknown;
  refresh?: unknown;
};

const researchCacheContract = "pubmed-discovery-v1";
const researchCacheTtlMs = 24 * 60 * 60 * 1000;
type CachedResearch = Omit<ResearchResponse, "cache">;

type PubmedSummary = {
  uid?: string;
  title?: string;
  pubdate?: string;
  fulljournalname?: string;
  authors?: Array<{ name?: string }>;
  pubtype?: string[];
  articleids?: Array<{ idtype?: string; value?: string }>;
};

function isPublicationFilter(value: unknown): value is PublicationFilter {
  return typeof value === "string" && value in publicationFilters;
}

function parseRecord(summary: PubmedSummary, pmid: string): PubmedDiscovery {
  const doi = summary.articleids?.find((identifier) => identifier.idtype === "doi")?.value ?? null;
  return {
    pmid,
    title: summary.title?.replace(/\s+/g, " ").trim() || "Untitled PubMed record",
    authors: summary.authors?.map((author) => author.name).filter(Boolean).join(", ") || "Authors not returned",
    journal: summary.fulljournalname || "Journal not returned",
    published: summary.pubdate || "Date not returned",
    publicationTypes: summary.pubtype ?? [],
    doi,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  };
}

export async function POST(request: Request) {
  let body: ResearchRequest;
  try {
    body = await request.json() as ResearchRequest;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 8) {
    return Response.json({ error: "Use a more specific research query." }, { status: 400 });
  }
  if (query.length > 800) {
    return Response.json({ error: "Keep each research query under 800 characters." }, { status: 400 });
  }

  const filters = Array.isArray(body.filters) ? body.filters.filter(isPublicationFilter) : [];
  const requestedMax = typeof body.maxResults === "number" ? body.maxResults : 6;
  const maxResults = Math.max(1, Math.min(10, Math.floor(requestedMax)));
  const executedQuery = compilePubmedQuery(query, filters);
  const refresh = body.refresh === true;
  const cacheKey = await operationCacheKey("pubmed-discovery", researchCacheContract, {
    executedQuery,
    filters: [...filters].sort(),
    maxResults,
  });
  if (!refresh) {
    const cached = await readOperationCache<CachedResearch>(cacheKey);
    if (cached) {
      return Response.json({
        ...cached.payload,
        cache: { status: "hit", layer: "d1", createdAt: cached.createdAt, expiresAt: cached.expiresAt },
      } satisfies ResearchResponse);
    }
  }
  const baseUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

  try {
    const searchUrl = new URL(`${baseUrl}/esearch.fcgi`);
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", String(maxResults));
    searchUrl.searchParams.set("sort", "relevance");
    searchUrl.searchParams.set("term", executedQuery);

    const searchResponse = await fetch(searchUrl, {
      headers: { "User-Agent": "Epistack Evidence Lab/0.1 (research discovery)" },
    });
    if (!searchResponse.ok) throw new Error(`PubMed search returned ${searchResponse.status}`);
    const searchPayload = await searchResponse.json() as {
      esearchresult?: { count?: string; idlist?: string[] };
    };
    const ids = searchPayload.esearchresult?.idlist ?? [];

    if (!ids.length) {
      const payload: CachedResearch = {
        query,
        executedQuery,
        retrievedAt: new Date().toISOString(),
        database: "PubMed",
        totalMatches: Number(searchPayload.esearchresult?.count ?? 0),
        records: [],
      };
      const stored = await writeOperationCache(cacheKey, "pubmed-discovery", researchCacheContract, payload, researchCacheTtlMs);
      return Response.json({
        ...payload,
        cache: { status: refresh ? "bypass" : "miss", layer: "d1", createdAt: stored?.createdAt ?? null, expiresAt: stored?.expiresAt ?? null },
      } satisfies ResearchResponse);
    }

    const summaryUrl = new URL(`${baseUrl}/esummary.fcgi`);
    summaryUrl.searchParams.set("db", "pubmed");
    summaryUrl.searchParams.set("retmode", "json");
    summaryUrl.searchParams.set("id", ids.join(","));
    const summaryResponse = await fetch(summaryUrl, {
      headers: { "User-Agent": "Epistack Evidence Lab/0.1 (research discovery)" },
    });
    if (!summaryResponse.ok) throw new Error(`PubMed summary returned ${summaryResponse.status}`);
    const summaryPayload = await summaryResponse.json() as {
      result?: Record<string, PubmedSummary | string[]>;
    };
    const records = ids
      .map((pmid) => {
        const summary = summaryPayload.result?.[pmid];
        return summary && !Array.isArray(summary) ? parseRecord(summary as PubmedSummary, pmid) : null;
      })
      .filter((record): record is PubmedDiscovery => record !== null);

    const payload: CachedResearch = {
      query,
      executedQuery,
      retrievedAt: new Date().toISOString(),
      database: "PubMed",
      totalMatches: Number(searchPayload.esearchresult?.count ?? records.length),
      records,
    };
    const stored = await writeOperationCache(cacheKey, "pubmed-discovery", researchCacheContract, payload, researchCacheTtlMs);
    return Response.json({
      ...payload,
      cache: { status: refresh ? "bypass" : "miss", layer: "d1", createdAt: stored?.createdAt ?? null, expiresAt: stored?.expiresAt ?? null },
    } satisfies ResearchResponse);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown retrieval error";
    return Response.json({
      error: "PubMed could not be reached. The verified egg ledger is still available; retry the live discovery sweep shortly.",
      detail,
    }, { status: 502 });
  }
}
