# @gideon-defender/mcp-server

OpenComp's owned OpenAPI-to-MCP compiler. The self-contained Node.js bundle embeds
the pinned public API spec and owned overlay; it does not fetch tool definitions
or require repository files at runtime.

Local entry points now use the owned runtime. npm cutover is **not yet accepted**:
publishing and live testing need explicit approval. See the
[release guide](https://github.com/gideon-defender/opencomp/blob/release/apps/mcp-server/RELEASING.md) for
the release checklist and rollback procedure. Generated sources remain the
frozen compatibility oracle, not the authoring surface.

The owned API-key hosted service deploys to dev after successful main CI once
its infrastructure is provisioned. See [hosting and migration](./HOSTING.md)
for bootstrap ordering, client configuration and rollback. Gram OAuth remains
available during this migration.

## Development

Use Node.js 22+ and the root pnpm workspace:

```sh
pnpm install --frozen-lockfile
pnpm --filter @gideon-defender/api run openapi:check
pnpm --filter @gideon-defender/mcp-server run build
pnpm --filter @gideon-defender/mcp-server run typecheck
pnpm --filter @gideon-defender/mcp-server run lint
pnpm --filter @gideon-defender/mcp-server run test
pnpm --filter @gideon-defender/mcp-server run mcpb:build
```

Builds emit `dist-owned/`; desktop packaging emits `dist-owned.mcpb`. Neither
build installs dependencies. Tests cover all 412 characterized tools, reviewed
schema/wire deltas, credential isolation, transports, deterministic desktop
packaging, and installation of the exact release tarball in an offline consumer
with an empty dependency store.

Author API tool metadata as `x-comp-mcp` and MCP-only policy in
`mcp-overlay.yaml`. Export API changes with
`pnpm --filter @gideon-defender/api run openapi:export`; CI rejects stale specs.
Do not run Speakeasy generation over this package.

## Architecture and authoring

`src/openapi-loader.ts` clones the pinned OpenAPI document and applies the owned
policy. `src/tools.ts` compiles request validators and schemas; `src/server.ts`
registers static tools or dynamic discovery. `src/client.ts` executes API requests.
The build embeds the spec, overlay, package version and tool inventory into a
self-contained executable. Builds validate the contract before bundling.

The compiler supports OpenAPI 3.0. Unsupported constraints, formats, parameter
styles, request MIME types, external/dangling references and name collisions fail
with the operation or schema location. Productive recursive references stay lazy;
reference-only cycles fail. `oneOf` is exclusive, `anyOf` is inclusive, and `allOf`
intersects constraints. Explicit or absent open-object policies preserve unknown
keys; schema-valued dictionaries validate values, and `additionalProperties: false`
rejects unknown keys. The API still enforces its DTO whitelist.

Request envelopes preserve body-only `request`, mixed `request.body`, and header
mapping such as `xOrganizationId` to `X-Organization-Id`. Supported parameter
encodings include simple, label, matrix, form, delimited arrays and flat deepObject.
Nested parameter values, cookies, content-based parameters and `allowReserved`
are unsupported. Enabled bodies use JSON; multipart, SSE and binary operation
exclusions remain in the overlay. Emitted DTO types are preserved rather than
inferred from field names or incompatible constraints.

Author API metadata with `@ApiExtension('x-comp-mcp', { name?, disabled?, description? })`.
The API compatibility adapter dual-reads and dual-emits `x-speakeasy-mcp` while
legacy and hosted consumers need it. Conflicting metadata and duplicate explicit
names fail. Automatic names use method/resource/suffix rules and reserve disabled
names. MCP-only overlay edits leave the public API document untouched:

```yaml
version: 1
schemas:
  - name: ExampleDto
    removeProperties: [fileData]
    properties:
      s3Key: { description: Use the key returned by create-upload-url }
operations:
  - path: /v1/example/stream
    method: get
    metadata: { disabled: true }
```

Unknown overlay targets fail. Keep owned and legacy upload/removal/disabled policies
aligned until legacy cleanup is approved. Public-doc sensitive-path exclusions
remain independent. See [test documentation](tests/README.md) for fixture
provenance, intentional contract differences and verification.

## Runtime policy

The API key is sent as `X-API-Key`. CLI credentials use `--apikey`, then
`COMPAI_APIKEY`; an HTTP `apikey` header overrides both per request/session.
Disabling static auth prevents fallback. SSE message requests must use the key
that established the session. Shared hosted users must not share a static key.

There are no retries by default. Mutations never retry and no synthetic idempotency
headers are added. Explicitly safe GET/HEAD callers may opt into at most three
retries with jitter and `Retry-After`. Cancellation and one total 120-second
deadline cover the request, response body and retry backoff. Credentialed redirects
are not followed. HTTP errors report status only; network/configuration errors
are generic. Successful text redacts an echoed API key; image/audio results use
base64 MCP content.

Annotations use the operation summary as title. GET/HEAD/OPTIONS are read-only and
idempotent. All other operations default to potentially destructive because an
HTTP method cannot prove a write is additive-only. DELETE is idempotent; other
writes are non-idempotent. All API tools are open-world. Annotation hints do not
grant permissions or enable retries.

Annotation filters require listed hints to be true and unlisted hints to be false.
Use `--tool-annotations readOnly,idempotent,openWorld` for the read-only registry.
Discovery and execution use the same filtered registry. Dynamic mode exposes
`list_tools`, `describe_tool_input` and `execute_tool`; prompts, resources and
scopes are not advertised. Static schemas use draft-7, dynamic schemas draft-2020-12.

## Workspace and CI

The package uses the root pnpm lockfile and overrides. Turbo build inputs include
the external public spec, overlay, compiler, manifest, scripts and root build
configuration. MCP tests are uncached. Normal PR/main CI runs `mcp-check.yml`
without path exclusions or publication secrets, including offline OpenAPI drift
checks, build, typecheck, lint, contracts, runtime, wire, transports and packages.

`openapi:check` uses real controller/DTO metadata through a sanitized Jest export.
It blocks network access, suppresses dotenv, mocks auth/database dependencies and
uses Nest preview compilation without provider constructors or application
lifecycle hooks. Startup and export share `createPublicDocument`. Drift checks
ignore object-key ordering but preserve arrays, constraints and route/DTO changes.

## Client configuration after an approved prerelease

Pin the approved version; do not use `latest` for prerelease acceptance. Configure
a client that supports stdio with the following shape, replacing placeholders.
Supply an organization-scoped, read-only test API key through a secure environment
or client secret setting, never commit it.

```json
{
  "mcpServers": {
    "opencomp": {
      "command": "pnpm",
      "args": [
        "dlx",
        "@gideon-defender/mcp-server@<approved-prerelease>",
        "start",
        "--server-url",
        "<approved-api-base-url>",
        "--tool",
        "get-tasks"
      ],
      "env": { "COMPAI_APIKEY": "<test-organization-read-only-key>" }
    }
  }
}
```

`start` supports stdio (default) or `--transport sse` at `/sse`.
`serve` uses Streamable HTTP at `/mcp`. Both HTTP modes default to port 2718.
HTTP callers use the `apikey` header; `serve --disable-static-auth` rejects
static fallback. This local API-key server is not a replacement for hosted OAuth.

Use repeatable `--tool` allowlists, `--mode dynamic` for progressive discovery,
or `--tool-annotations` for exact annotation matching. There are no scope flags.
Run the approved version with `--help` for the full CLI contract.

## Release boundaries

Automatic generation is retired. The Publish MCP workflow checks the workspace,
requires an explicit version and approval policy, and publishes only a verified
staging package with no runtime dependencies. Direct publication of this
development package is blocked. No automatic bumps, commits or pushes occur.

Keep `NPM_TOKEN` for approved publication. Hosted Gram, its secrets and legacy
metadata remain unchanged until a separately approved hosted migration.
