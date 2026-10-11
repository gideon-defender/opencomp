---
name: generate-mcp-server
description: Build and validate OpenComp's owned OpenAPI-to-MCP compiler, or generate a separate explicitly requested Speakeasy MCP project. Use for MCP server/tool/compiler work.
license: Apache-2.0
---

# generate-mcp-server

## OpenComp owned compiler (use this route in this repository)

Do not run Speakeasy generation over `apps/mcp-server`: its generated files are
the frozen parity/rollback oracle, not the authoring surface. Build from the root:

```sh
pnpm --filter @gideon-defender/api run openapi:check
pnpm --filter @gideon-defender/mcp-server run build
pnpm --filter @gideon-defender/mcp-server run test
pnpm --filter @gideon-defender/mcp-server run typecheck
pnpm --filter @gideon-defender/mcp-server run lint
```

Author `x-comp-mcp` metadata in API decorators and policy in `mcp-overlay.yaml`.
The loader accepts OpenAPI 3.0; do not assume 3.1 support. Preserve tool names,
schemas and wire contracts, except explicitly reviewed parity deltas. API keys
use `COMPAI_APIKEY` or `--apikey`; there are no scope flags. Use annotation filters
or repeatable `--tool` allowlists. The binary supports stdio, SSE and Streamable HTTP.

Read `apps/mcp-server/RELEASING.md` before packaging/publication. Only verified staging
packages may be published. Prerelease publishing and live organization tests need
explicit human approval; stable cutover needs recorded acceptance and an agreed
observation window. Preserve generated sources, fixtures and `.speakeasy/` until
that window closes. Gram/hosted OAuth remains a separate Phase 6 decision.

Stop here for OpenComp. The legacy instructions below apply only to a separate
project where the user explicitly requests Speakeasy generation; use pnpm instead
of the historical npm examples, and do not infer permission to publish or deploy.

## Separate legacy SDK projects

Only for an explicitly requested external/legacy Speakeasy project, read
[legacy setup](references/legacy-generation.md), then
[legacy usage/extensions](references/legacy-usage.md) as relevant.
These historical examples are not OpenComp commands. Use pnpm under project rules;
interactive authentication is performed by the user. Do not infer authorization
for publication, hosted migration or credential changes.
