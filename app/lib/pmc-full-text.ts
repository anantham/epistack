export type PmcArtifactKind = "pmc-jats" | "pmc-bioc";

export type PmcFullTextArtifact = {
  kind: PmcArtifactKind;
  pmcid: string;
  canonicalUrl: string;
  retrievedFrom: string;
  raw: string;
  plainText: string;
  contentHash: string;
};

const fetchTimeoutMs = 20_000;
const minimumRawChars = 5_000;
const minimumPlainTextChars = 800;
const userAgent = "Epistack Evidence Lab/0.1 (hosted full-text review)";

function decodeXmlEntities(value: string) {
  const named = new Map([
    ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"],
    ["nbsp", " "], ["minus", "−"], ["ndash", "–"], ["mdash", "—"], ["times", "×"],
  ]);
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named.get(code.toLowerCase()) ?? entity;
  });
}

export function jatsToPlainText(xml: string) {
  return decodeXmlEntities(xml
    .replace(/<\/?(?:p|sec|title|caption|tr|table-wrap|fig|list-item|abstract|article-title|kwd|ack|fn|ref-list)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Extract the prose-bearing passages from NCBI's BioC JSON representation. */
export function bioCToPlainText(payload: unknown) {
  const collections = Array.isArray(payload) ? payload : [payload];
  const passages: string[] = [];
  for (const collection of collections) {
    const documents = asRecord(collection).documents;
    if (!Array.isArray(documents)) continue;
    for (const document of documents) {
      const documentPassages = asRecord(document).passages;
      if (!Array.isArray(documentPassages)) continue;
      for (const passage of documentPassages) {
        const text = asRecord(passage).text;
        if (typeof text === "string" && text.trim()) passages.push(text.trim());
      }
    }
  }
  return passages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchText(url: URL | string) {
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  return { response, body: await response.text() };
}

function validateJats(body: string, provider: string) {
  if (!/<article[\s>]/i.test(body) || body.length < minimumRawChars) {
    throw new Error(`${provider} did not return a complete open-access JATS article.`);
  }
  const plainText = jatsToPlainText(body);
  if (plainText.length < minimumPlainTextChars) {
    throw new Error(`${provider} article did not contain enough readable full text.`);
  }
  return plainText;
}

async function fetchEuropePmc(pmcNumeric: string) {
  const url = new URL(`https://www.ebi.ac.uk/europepmc/webservices/rest/PMC${pmcNumeric}/fullTextXML`);
  const { response, body } = await fetchText(url);
  if (!response.ok) throw new Error(`Europe PMC full-text fetch returned ${response.status}.`);
  return {
    kind: "pmc-jats" as const,
    raw: body,
    plainText: validateJats(body, "Europe PMC"),
    retrievedFrom: url.toString(),
  };
}

async function fetchJats(pmcNumeric: string) {
  const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  url.searchParams.set("db", "pmc");
  url.searchParams.set("id", pmcNumeric);
  url.searchParams.set("retmode", "xml");
  url.searchParams.set("tool", "epistack-evidence-lab");
  const { response, body } = await fetchText(url);
  if (!response.ok) throw new Error(`PMC JATS fetch returned ${response.status}.`);
  return {
    kind: "pmc-jats" as const,
    raw: body,
    plainText: validateJats(body, "PMC JATS"),
    retrievedFrom: url.toString(),
  };
}

async function fetchBioC(pmcNumeric: string) {
  const url = new URL(`https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/PMC${pmcNumeric}/unicode`);
  const { response, body } = await fetchText(url);
  if (!response.ok) throw new Error(`PMC BioC fetch returned ${response.status}.`);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("PMC BioC endpoint returned invalid JSON.");
  }
  const plainText = bioCToPlainText(payload);
  if (body.length < minimumRawChars || plainText.length < minimumPlainTextChars) {
    throw new Error("PMC BioC response did not contain enough readable full text.");
  }
  // Hash canonical JSON so harmless response whitespace does not invalidate a
  // later independent verification of the same BioC artifact.
  const raw = JSON.stringify(payload);
  return { kind: "pmc-bioc" as const, raw, plainText, retrievedFrom: url.toString() };
}

function safePmcNumeric(value: unknown) {
  const numeric = String(value || "").replace(/^PMC/i, "");
  return /^\d{4,12}$/.test(numeric) ? numeric : null;
}

/** Resolve a PubMed record through Europe PMC first, then NCBI as a fallback. */
export async function resolvePmcNumeric(pmid: string) {
  const europeUrl = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  europeUrl.searchParams.set("query", `EXT_ID:${pmid}`);
  europeUrl.searchParams.set("format", "json");
  europeUrl.searchParams.set("pageSize", "1");
  try {
    const response = await fetchText(europeUrl);
    if (!response.response.ok) throw new Error(`Europe PMC PMID lookup returned ${response.response.status}.`);
    const payload = JSON.parse(response.body) as {
      resultList?: { result?: Array<{
        pmcid?: string;
        fullTextIdList?: { fullTextId?: string[] };
      }> };
    };
    const record = payload.resultList?.result?.[0];
    const pmcid = safePmcNumeric(record?.pmcid ?? record?.fullTextIdList?.fullTextId?.find((value) => /^PMC\d{4,12}$/i.test(value)));
    if (pmcid) return pmcid;
  } catch {
    // Try NCBI below; the two services have independent availability.
  }

  const ncbiUrl = new URL("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/");
  ncbiUrl.searchParams.set("ids", pmid);
  ncbiUrl.searchParams.set("format", "json");
  ncbiUrl.searchParams.set("tool", "epistack-evidence-lab");
  const response = await fetchText(ncbiUrl);
  if (!response.response.ok) throw new Error(`NCBI PMID-to-PMCID conversion returned ${response.response.status}.`);
  const payload = JSON.parse(response.body) as { records?: Array<{ pmcid?: string; pmid?: string }> };
  const record = Array.isArray(payload.records)
    ? payload.records.find((candidate) => String(candidate.pmid || "") === pmid) ?? payload.records[0]
    : null;
  return safePmcNumeric(record?.pmcid);
}

export async function fetchPmcFullText(
  pmcNumeric: string,
  preferredKind?: PmcArtifactKind,
): Promise<PmcFullTextArtifact> {
  const numeric = String(pmcNumeric).replace(/^PMC/i, "");
  if (!/^\d{4,12}$/.test(numeric)) throw new Error("The PMCID is not valid.");
  const attempts = preferredKind === "pmc-bioc"
    ? [fetchBioC]
    : preferredKind === "pmc-jats"
      ? [fetchEuropePmc, fetchJats]
      : [fetchEuropePmc, fetchJats, fetchBioC];
  const errors: string[] = [];
  for (const fetcher of attempts) {
    try {
      const result = await fetcher(numeric);
      const pmcid = `PMC${numeric}`;
      return {
        ...result,
        pmcid,
        canonicalUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
        contentHash: await sha256(result.raw),
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`PMC full-text acquisition failed: ${errors.join(" ")}`);
}
