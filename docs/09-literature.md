# 09 — The Real Reference Tool: No Fabricated Links

## The problem it solves
The researcher asks: “Where is the reference? What is its link? Who wrote it? In which journal?”—and the model alone invents convincing false answers.

## The mechanism — `services/literature.js` + `library-sources.js`

```
Researcher's question → Do they want references? (intent + cleanup)
  → cleanQuery: remove “give me/suggest/search” — “give me reference names” is not a topic!
  → if ambiguous → use their profile (research title + field), not the word “references”
  → search crossref/openalex/semantic in parallel (+ ieee/acm/arxiv/europepmc/doaj/openlibrary)
     with a 12s budget per source and 15s overall — an unavailable source does not slow the researcher down
  → standardize the format with normalise() + deduplicate by DOI
  → filter for relevance: discard anything whose terms do not overlap with the topic (addresses the complaint “this is not in my field”)
  → combine the platform library (favorites of actual files) + enrich missing details from citation_* tags in each link
  → literatureBlock() is injected into the prompt — the supervisor mentions each reference on its own line
```

## Sources (none require keys)
- **Crossref**: the most accurate citation data (journal/publisher/volume/pages)—covers IEEE (prefix `10.1109`) and ACM (`10.1145`) with official Xplore/DL links.
- **OpenAlex**: indexes IEEE/ACM/Springer/Elsevier + open PDF link.
- **Semantic Scholar**: abstracts and citations (an optional key increases limits).
- **arXiv / Europe PMC / DOAJ / Zenodo / Open Library**: open-access articles and books.
- **Unpaywall + DOI resolution**: the legal open version of any DOI + resolve any link into complete data.
- **Google Scholar**: manual link only—**no crawling or scraping** (respecting its terms).

## Protection
- An SSRF guard blocks internal network links, with a size cap and timeouts—the tool cannot crash the server with a malicious source.
- `resolveReference()`: title, link, or DOI → complete reference record—used for manual import.
