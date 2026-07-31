# PubMed Query Syntax

## Search Fields

| Field | Tag | Example |
|-------|-----|---------|
| MeSH Term | `[mh]` | `diabetes mellitus[mh]` |
| MeSH Major Topic | `[majr]` | `cancer[majr]` |
| Title/Abstract | `[tiab]` | `machine learning[tiab]` |
| Title | `[ti]` | `CRISPR[ti]` |
| Author | `[au]` | `Smith J[au]` |
| Journal | `[ta]` | `nature[ta]` |
| Publication Date | `[dp]` | `2023:2024[dp]` |
| Publication Type | `[pt]` | `clinical trial[pt]` |

## Common MeSH Terms (Medical)

### Gastrointestinal
- `gastrointestinal endoscopy[mh]`
- `colonoscopy[mh]`
- `esophagogastroduodenoscopy[mh]`
- `stomach neoplasms[mh]`
- `colorectal neoplasms[mh]`
- `inflammatory bowel diseases[mh]`

### AI/Machine Learning
- `artificial intelligence[mh]`
- `machine learning[mh]`
- `deep learning[mh]`
- `neural networks, computer[mh]`

### Clinical
- `diagnosis[mh]`
- `prognosis[mh]`
- `therapeutics[mh]`
- `clinical trial[pt]`
- `meta-analysis[pt]`
- `systematic review[pt]`

## Query Refinement Workflow

```
"cancer"                           # Too broad (5M+)
"lung cancer"                      # Better (800K)
"lung cancer[mh]"                  # MeSH specific (400K)
"lung cancer[mh] AND 2024[dp]"    # Recent only (12K)
"lung cancer[majr] AND clinical trial[pt] AND 2024[dp]"  # Optimal (450)
```

## Boolean Operators

- `AND` - Both terms required
- `OR` - Either term
- `NOT` - Exclude term
- `()` - Group terms

Example:
```
(gastric cancer[mh] OR stomach neoplasms[mh]) AND artificial intelligence[mh] AND 2020:2024[dp]
```
