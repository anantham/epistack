export const publicationFilters = {
  trials: "randomized controlled trial[Publication Type]",
  reviews: "(systematic review[Publication Type] OR meta-analysis[Publication Type])",
  observational: "observational study[Publication Type]",
} as const;

export type PublicationFilter = keyof typeof publicationFilters;

export type PubmedDiscovery = {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  published: string;
  publicationTypes: string[];
  doi: string | null;
  url: string;
};

export type ResearchResponse = {
  query: string;
  executedQuery: string;
  retrievedAt: string;
  database: "PubMed";
  totalMatches: number;
  records: PubmedDiscovery[];
};

export function compilePubmedQuery(query: string, filters: PublicationFilter[]) {
  const trimmed = query.trim();
  if (!filters.length) return trimmed;
  const filterQuery = filters.map((filter) => publicationFilters[filter]).join(" OR ");
  return `(${trimmed}) AND (${filterQuery})`;
}
