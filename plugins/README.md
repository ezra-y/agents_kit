# Plugins

`plugins/<plugin-id>/` stores complete Plugin packages. The package directory is
the source and update boundary; embedded Skills are indexed from their owner
Plugin and are not copied into top-level `skills/`.

Each Plugin must contain `agents-kit.plugin.json`. This sidecar records
`agents_kit` policy only:

- upstream target ownership;
- each platform manifest path and authority;
- target support status;
- embedded Skill standalone-install eligibility;
- local overlay paths.

Claude and Codex manifests remain authoritative platform files. Marketplace
indexes are generated with:

```bash
agents-kit marketplace build
```

Import and update preserve the complete upstream subtree. Component inventory
is used for review and display, never as a file-copy allowlist.
