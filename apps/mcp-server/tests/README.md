# MCP tests and compatibility fixtures

The generated runtime and frozen fixtures are the compatibility and rollback
oracle for the owned compiler. Keep them through live acceptance and the agreed
observation window. See [release and rollback requirements](../RELEASING.md).
Do not regenerate generated sources or replace fixtures to hide contract changes.

## Fixture provenance

The baseline records Git revision `918938cc64039576494cd83e1dc6daffcbc52087`.
`fixtures/parity-fixture.json` contains the original spec/binary SHA-256 values, static tool
names, descriptions, full input schemas, annotations and operation envelopes.
`fixtures/dynamic-fixture.json` contains the meta-tools, dynamic list and every dynamic
schema, including no-input markers. The original spec had 341 paths and 422
operations; the captured static and dynamic sets each contain 412 unique tools.

`capture.mjs` uses the MCP SDK client and stdio transport: static `start` with
paginated `tools/list`, then dynamic `start --mode dynamic` with `list_tools`
and batched `describe_tool_input`. Operation mappings come from the original
public spec. Child processes receive sanitized environments, fake credentials
and an ephemeral loopback mock API. Invalid-type and unknown-tool probes assert
zero API requests; the unknown-key probe makes one GET against the mock.

The old committed binary crashed on `start`/`serve` with an ESM dynamic-require
error. Fixtures were captured via tsx from the identical generated source.
A source baseline is not proof that an old registry tarball starts successfully;
verify the actual rollback package before release approval.

The original generated annotations were false for all four hints. The original
scope inventory was empty, and prompts/resources were unregistered. The original
registry omitted nine named operations plus the unnamed policy PDF upload. The
SOA auto-fill SSE exclusion is now explicit in both overlays. These are historical
baseline properties, not the current owned runtime policy.

## Verification and recapture

From the repository root, verify the current owned runtime:

```sh
pnpm --filter @gideon-defender/mcp-server run test
```

The retained characterization tools can inspect a separate checkout of the
recorded revision with its dependencies installed. From the current repository,
replace the source-directory placeholder with that checkout's MCP package:

```sh
pnpm exec node apps/mcp-server/tests/capture.mjs /path/to/frozen/apps/mcp-server apps/mcp-server/parity
pnpm exec node apps/mcp-server/tests/probes.mjs /path/to/frozen/apps/mcp-server
```

Capture verifies both baseline files by default and exits nonzero on drift.
It checks the captured Git revision and spec/binary hashes as well as contracts,
so running it against the current migration checkout is not a replacement for the
owned parity suite. Capture accepts `[server-dir] [out-dir]`; probes accept
`[server-dir]`. Relative paths resolve from the caller's working directory;
omitted server and fixture paths resolve from the retained script location.

For an intentionally reviewed recapture, use `--update` with a separate output
directory and compare the results. Keep the checked-in baseline immutable during
the migration. Semantically identical output files are not rewritten.

## Intentional differences

The owned runtime's [current policy](../README.md#runtime-policy) corrects the
original annotations and adds sanitized errors, credentialed redirect protection,
cancellation, bounded deadlines and no mutation retries. Annotation corrections
are checked for every tool, rather than accepted through replacement snapshots.

- `compatibility/contracts.test.mjs` compares all names, descriptions, operation locations
  and full nested static/dynamic schemas. The normalizer removes only proven
  schema representation differences; it preserves conflicting intersections,
  strict objects and meaningful constraints.
- `compatibility/deltas.mjs` records 67 exact schema leaf differences with tool, path,
  old value and new value. They include current spec length/range/URI constraints
  and two strict DTOs. Unexpected changes or stale allowances fail the gate.
- `compatibility/wire.test.mjs` compares all 412 representative requests and MCP results
  against the generated source using a loopback API. Method, escaped path/query,
  application headers, parsed JSON body and result must match; each runtime must
  make exactly one request per operation.
- The generated runtime omitted bodies for 19 declared empty-object DTO tools.
  The wire test names them and requires exactly the old omitted body and new `{}`.
  The owned compiler also preserves supplied open-object and dictionary fields;
  focused tests verify these payloads through validation, schema export and JSON.
- The generated empty Cookie header is omitted. Transport defaults and vendor
  User-Agent are outside the application contract comparison. Query order and
  multi-format Accept headers are preserved, including the explicit media
  preferences in `src/request/accept.ts`.

Empty DTO schemas still limit discovery. Malformed emitted fields such as
`UpdateFindingDto.revisionNote` retain the declared object type; its `maxLength`
string constraint is inert on that type. Fix DTOs and export the public spec
rather than silently interpreting a field as a different type.

## Test layers

`owned-contract.test.mjs` checks metadata, name derivation, overlay exclusions and
upload-field removals. `runtime/` checks schemas, envelopes, dictionaries,
serialization, retries, cancellation, deadlines, credentials, filtering and
static/dynamic discovery/execution through MCP SDK transports.

`compatibility/` checks exhaustive schema/wire parity, CLI options and all three transports,
credential isolation, SSE session protection and deterministic desktop packages.
It unpacks the `.mcpb` and runs its binary without repository dependencies.
`integration/` checks workspace, CI and release-policy integration. `release/` installs
the exact staged npm tarball offline with an empty store, denies repository reads,
and tests installed CLI aliases, discovery, transports and safe mock execution.
Tests use no live customer API or credentials. All clients, child processes and
mock servers close even after assertion failures.
