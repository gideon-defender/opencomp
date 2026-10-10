---
name: manage-openapi-overlays
description: Create or validate OpenComp's owned MCP policy and x-comp-mcp metadata, or explicitly requested legacy/external Speakeasy overlays. Use for overlay files, operation exclusions, upload-field policy, tool naming and metadata.
license: Apache-2.0
---

# manage-openapi-overlays

## OpenComp owned policy (use this route for apps/mcp-server)

`apps/mcp-server/mcp-overlay.yaml` is a versioned owned policy, not a Speakeasy
JSONPath overlay. Author API metadata as `x-comp-mcp`. Inspect existing entries
and `src/openapi/overlay.ts` before changing schema-property removals or operation
metadata. Example:

```yaml
version: 1
operations:
  - path: /v1/example/stream
    method: get
    metadata: { disabled: true }
```

Keep `.speakeasy/mcp-uploads-overlay.yaml` compatible during the rollback/hosted
migration: contract tests compare removal and disabled policies. Do not introduce
global mutation retries, new scopes, or unsupported SDK-only extensions into the
owned policy. Fix DTO/type errors in the API, export the spec offline with
`pnpm --filter @gideon-defender/api run openapi:export`, then run the MCP build and
tests from the root workspace. No vendor key or regeneration is needed.

Read `apps/mcp-server/RELEASING.md` for release gates. Do not remove legacy overlays,
metadata, Gram configuration or secrets before separately approved acceptance.
Stop here for owned policy work. The JSONPath/Speakeasy procedures below apply
only to explicitly requested legacy/external SDK overlays, never owned regeneration.

## Separate legacy SDK projects

Only for an explicitly requested external/legacy Speakeasy project, read
[legacy setup](references/legacy-overlays.md), then
[legacy usage/extensions](references/legacy-extensions.md) as relevant.
These historical examples are not OpenComp commands. Use pnpm under project rules;
interactive authentication is performed by the user. Do not infer authorization
for publication, hosted migration or credential changes.
