export interface SearchDocument {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  published: boolean;
}

export function searchDocuments(documents: SearchDocument[], query: string): SearchDocument[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return documents.filter((document) => document.published);
  return documents.filter((document) => {
    if (!document.published) return false;
    const haystack = `${document.title} ${document.summary} ${document.tags.join(" ")}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function tagFacets(documents: SearchDocument[]): Record<string, number> {
  return documents.reduce<Record<string, number>>((facets, document) => {
    for (const tag of document.tags) facets[tag] = (facets[tag] ?? 0) + 1;
    return facets;
  }, {});
}
