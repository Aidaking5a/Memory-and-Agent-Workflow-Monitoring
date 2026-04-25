# File Parsing Rules for memory.md and bootstrap.md

## Scope

Parser handles authorized Markdown sources and transforms them into versioned memory entries.

## Rules

1. Detect source type by filename (`memory.md`, `bootstrap.md`, other).
2. Parse headings (`#` to `######`) into hierarchical sections.
3. Assign stable section key format: `{level}:{slug(heading)}`.
4. Capture section content, line range, and source metadata.
5. Hash full source content to produce content-addressed version lineage.
6. Emit one memory object per section and one memory version per ingestion change.

## Provenance Fields

- `connectorId`
- `filePath`
- `contentHash`
- `parsedAt`

## Safety

- Parse only approved files
- Avoid parsing executable directives as actions
- Treat parser as read-only ingestion step