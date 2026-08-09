# Logo Design Reference

AI-powered logo design with 55+ styles, 30 color palettes, 25 industry guides. Uses GPT Image 2 through Codex's native Imagegen capability.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/logo/search.py` | Search styles, colors, industries; generate design briefs |
| `scripts/logo/core.py` | BM25 search engine for logo data |

## Commands

### Design Brief (Start Here)

```bash
python3 ~/.claude/skills/design/scripts/logo/search.py "tech startup modern" --design-brief -p "BrandName"
```

### Search Domains

```bash
# Styles
python3 ~/.claude/skills/design/scripts/logo/search.py "minimalist clean" --domain style

# Color palettes
python3 ~/.claude/skills/design/scripts/logo/search.py "tech professional" --domain color

# Industry guidelines
python3 ~/.claude/skills/design/scripts/logo/search.py "healthcare medical" --domain industry
```

### Generate Logo

1. Read the Codex `imagegen` skill.
2. Use its built-in tool mode with GPT Image 2. This reuses the current Codex runtime configuration and needs no separate API key.
3. Generate one image per concept. Start with three meaningfully different symbolic directions unless the user specifies another count.
4. Default to a flat opaque white background. If transparency is requested, follow the `imagegen` skill's chroma-key removal and validation workflow.
5. Show results inline, collect one-direction feedback, then make targeted revisions.
6. Move selected project-bound outputs from Codex's generated-images directory into the project.

Do not read Codex auth files or map Codex login credentials into `OPENAI_API_KEY`. Do not silently switch away from GPT Image 2.

Generated PNGs are concept assets, not production vectors. A final logo that needs SVG delivery must be reconstructed as clean SVG and tested at 16px and in one color.

## Available Styles

| Category | Styles |
|----------|--------|
| General | Minimalist, Wordmark, Lettermark, Pictorial Mark, Abstract Mark, Mascot, Emblem, Combination Mark |
| Aesthetic | Vintage/Retro, Art Deco, Luxury, Playful, Corporate, Organic, Neon, Grunge, Watercolor |
| Modern | Gradient, Flat Design, 3D/Isometric, Geometric, Line Art, Duotone, Motion-Ready |
| Clever | Negative Space, Monoline, Split/Fragmented, Responsive/Adaptive |

## Color Psychology

| Color | Psychology | Best For |
|-------|------------|----------|
| Blue | Trust, stability | Finance, tech, healthcare |
| Green | Growth, natural | Eco, wellness, organic |
| Red | Energy, passion | Food, sports, entertainment |
| Gold | Luxury, premium | Fashion, jewelry, hotels |
| Purple | Creative, innovative | Beauty, creative, tech |

## Industry Defaults

| Industry | Style | Colors | Typography |
|----------|-------|--------|------------|
| Tech | Minimalist, Abstract | Blues, purples, gradients | Geometric sans |
| Healthcare | Professional, Line Art | Blues, greens, teals | Clean sans |
| Finance | Corporate, Emblem | Navy, gold | Serif or clean sans |
| Food | Vintage Badge, Mascot | Warm reds, oranges | Friendly, script |
| Fashion | Wordmark, Luxury | Black, gold, white | Elegant serif |

## Workflow

1. Generate design brief → `scripts/logo/search.py --design-brief`
2. Convert the brief into three distinct GPT Image 2 prompts
3. Generate each concept through Codex Imagegen
4. Show results inline and ask the user to choose a direction
5. Refine one variable at a time
6. Build an HTML gallery only when saved-variant comparison is useful

## Detailed References

- `references/logo-style-guide.md` - Detailed style descriptions
- `references/logo-color-psychology.md` - Color meanings and combinations
- `references/logo-prompt-engineering.md` - AI generation prompts

## Runtime

- Codex native Imagegen
- GPT Image 2
- No separate image API key
- No direct access to Codex auth files
