---
name: pubmed
description: Search PubMed/PMC medical literature via MCP server. Use for literature search, retrieving abstracts, full-text articles, and citation analysis. Supports MeSH terms, batch fetching, PDF downloads, and RIS export.
---

# PubMed Search Skill

Direct PubMed/PMC API access via `web_fetch`. No dependencies required.

## API Endpoints

| Function | Endpoint |
|----------|----------|
| Search | `eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` |
| Summary | `eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` |
| Fetch | `eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi` |
| Similar | `eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi` |
| Citations | `icite.od.nih.gov/api/pubs` |
| PMC Full Text | `www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi` |

## 1. Search (with Sort)

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=QUERY&retmax=20&retmode=json&sort=SORT
```

**Sort options:**
- `sort=relevance` — Best Match (ML-based, default)
- `sort=pub_date` — Most Recent

**Example:**
```
?db=pubmed&term=gastric+cancer[mh]+AND+artificial+intelligence[mh]&retmax=10&retmode=json&sort=pub_date
```

Returns: `idlist` (PMIDs), `count`, `querytranslation`

## 2. Get Summaries (titles, authors, PMCID)

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=PMID1,PMID2&retmode=json
```

Returns: title, authors, journal, pubdate, pmcid (if available)

## 3. Fetch Abstracts

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=PMID1,PMID2&rettype=abstract&retmode=xml
```

Returns: Full abstract XML with all metadata

## 4. Count Only (fast)

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=QUERY&retmax=0&retmode=json
```

Use `retmax=0` for fast count without retrieving IDs.

## 5. Find Similar Articles

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?dbfrom=pubmed&db=pubmed&id=PMID&cmd=neighbor_score&retmode=json
```

Returns related articles ranked by similarity score.

## 6. Citation Counts (iCite)

```
https://icite.od.nih.gov/api/pubs?pmids=PMID1,PMID2,PMID3
```

Returns: citation_count, relative_citation_ratio, nih_percentile, etc.

## 7. PMC Full Text / PDF URLs

```
https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=PMCID
```

Returns OA article links including PDF URLs.

## 8. RIS Export

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=PMID1,PMID2&rettype=medline&retmode=text
```

Returns MEDLINE format (convertible to RIS).

## Query Syntax

See [references/query-syntax.md](references/query-syntax.md) for MeSH terms and search fields.

## Workflow Example

```python
# 1. Search with relevance sort
search = web_fetch("...esearch.fcgi?term=gastric+cancer+AI&sort=relevance&retmax=20")
pmids = search["idlist"]

# 2. Get summaries
summaries = web_fetch(f"...esummary.fcgi?id={','.join(pmids)}")

# 3. Fetch abstracts for top hits
abstracts = web_fetch(f"...efetch.fcgi?id={pmids[0]},{pmids[1]}&rettype=abstract")

# 4. Get citation counts
citations = web_fetch(f"https://icite.od.nih.gov/api/pubs?pmids={','.join(pmids)}")
```

## Rate Limits

- Without API key: 3 req/s
- With API key: 10 req/s (add `&api_key=KEY`)
- Respect 1 second between calls

Get API key: https://www.ncbi.nlm.nih.gov/account/settings/
