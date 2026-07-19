import { mkdir, writeFile } from "node:fs/promises";

const query = [
  '(egg[Title/Abstract] OR eggs[Title/Abstract] OR "Eggs"[MeSH Terms])',
  '(breakfast[Title/Abstract] OR "weight loss"[Title/Abstract] OR "body weight"[MeSH Terms] OR satiety[Title/Abstract])',
  '(randomized controlled trial[Publication Type] OR controlled clinical trial[Publication Type] OR systematic review[Publication Type] OR meta-analysis[Publication Type])',
  'humans[MeSH Terms]',
].join(" AND ");

const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const searchUrl = `${base}/esearch.fcgi?db=pubmed&retmode=json&retmax=500&sort=date&term=${encodeURIComponent(query)}`;
const searchResponse = await fetch(searchUrl, { headers: { "user-agent": "epistack-question-compiler/0.1" } });
if (!searchResponse.ok) throw new Error(`PubMed search failed: ${searchResponse.status}`);
const search = await searchResponse.json();
const ids = search.esearchresult.idlist;

const records = [];
for (let start = 0; start < ids.length; start += 100) {
  const chunk = ids.slice(start, start + 100);
  const summaryUrl = `${base}/esummary.fcgi?db=pubmed&retmode=json&id=${chunk.join(",")}`;
  const response = await fetch(summaryUrl, { headers: { "user-agent": "epistack-question-compiler/0.1" } });
  if (!response.ok) throw new Error(`PubMed summary failed: ${response.status}`);
  const payload = await response.json();
  for (const id of payload.result.uids ?? []) {
    const item = payload.result[id];
    records.push({
      pmid: id,
      title: item.title,
      authors: (item.authors ?? []).map((author) => author.name),
      journal: item.fulljournalname || item.source,
      published: item.pubdate,
      doi: (item.articleids ?? []).find((identifier) => identifier.idtype === "doi")?.value ?? null,
      pmcid: (item.articleids ?? []).find((identifier) => identifier.idtype === "pmc")?.value ?? null,
      publicationTypes: item.pubtype ?? [],
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      status: "discovered-not-assessed",
    });
  }
}

const artifact = {
  schemaVersion: "0.1.0",
  database: "PubMed",
  query,
  countReportedByPubMed: Number(search.esearchresult.count),
  recordsFetched: records.length,
  fetchedAt: new Date().toISOString(),
  evidencePolicy: "Discovery is not evidence. Records require source verification, claim matching, extraction, and assessment before they affect a belief.",
  records,
};

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/pubmed-discovery.json", import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Saved ${records.length} PubMed discovery records (${artifact.countReportedByPubMed} total matches).`);

