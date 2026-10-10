# MCP release and rollback guide

## Status

Local cutover preparation is implemented, but live acceptance is pending. Both
`prereleaseApproved` and `cutoverAccepted` in `release-policy.json` remain false.
No package has been published by this work, no live organization has been tested,
and no rollback observation period has been agreed or completed.

Before prerelease approval, confirm the actual published package and rollback
artifact. Local package version `0.3.0` is not proof of publication. Record the
registry version, tag and integrity rather than inferring them from this checkout.

Local npm aliases now point at `dist-owned/bin/mcp-server.js`. Generated sources,
the old binary, frozen parity fixtures and `.speakeasy/` remain intact. Do not
delete them merely because local checks pass.

## Local acceptance gate

Run the complete local gate before release preparation. Passing local checks does
not substitute for live acceptance in the agreed clients and test organization.

```sh
pnpm install --frozen-lockfile
pnpm --filter @gideon-defender/api run openapi:check
pnpm --filter @gideon-defender/mcp-server run build
pnpm --filter @gideon-defender/mcp-server run typecheck
pnpm --filter @gideon-defender/mcp-server run lint
pnpm --filter @gideon-defender/mcp-server run test
```

Normal CI runs the entire gate. `test:package` packs the same staging package the
release workflow publishes, installs the tarball offline outside the repository
with an empty dedicated store, and proves SDK/tsx/database dependencies cannot be
resolved there. Node's permission model denies the installed server reads outside
the consumer; a probe explicitly confirms repository spec reads are denied.
It checks the exact six-file payload, revision and binary hashes,
both installed CLI aliases, version/help, all 412 names, static/dynamic discovery,
stdio, SSE, Streamable HTTP and read-only execution against a loopback mock API.
The pinned spec and overlay are embedded in the binary, not loaded from the CWD.
The [parity suite](tests/README.md) checks all schemas and wire requests with
explicitly reviewed deltas.

`release-stage.mjs` is shared by testing and publication. It rejects stale build
fingerprints/version mismatches and existing staging directories. The published
manifest has no dependencies or scripts and includes an explicit file allowlist.
Direct `pnpm publish` of the development package always fails; its rollback
dependencies and source tree are not the public artifact.

## Approved prerelease and live acceptance

1. Obtain explicit approval for the version, test organization/API base URL,
   supported clients, safe read-only operations and observation duration. Before
   any publication, record the current npm `latest` version, integrity and client
   configuration as the rollback target. Do not infer these from local package.json.
2. Set package.json and manifest.json to an unused `X.Y.Z-next.N`; obtain permission
   to set `prereleaseApproved: true`. Re-run the entire local gate. This flag permits
   only a prerelease, not stable publication or acceptance.
3. Configure required reviewers on GitHub's `mcp-npm-publish` environment. After
   human authorization and user-managed delivery to the `release` branch, manually
   dispatch Publish MCP with the exact version. Checks run first, registry collisions
   fail closed, and only the dependency-free stage publishes to `next` via pnpm.
4. In each agreed client, use `pnpm dlx @gideon-defender/mcp-server@<prerelease>`.
   Use a securely supplied read-only test-organization key and an explicit API URL.
   Verify handshake, names/discovery, safe reads, permission denial, reconnect and
   credential isolation. Do not call mutations or production organizations without
   separate approval. SDK mock tests are not live client acceptance.
5. Record client/version, prerelease, source fingerprint, test org identifier,
   sanitized results, approver, rollback target and the agreed observation dates.
   Only after successful live acceptance may `cutoverAccepted` become true.
6. For approved stable publication, update only package/manifest version to the
   corresponding `X.Y.Z`, rebuild/recheck, and dispatch with `tested_prerelease`.
   Its source/spec/overlay/lock fingerprint must match that published prerelease.
   Observe through the agreed window before approving any legacy cleanup.

No automatic version bump or commit/push occurs. Publication uses `NPM_TOKEN`;
generation retirement does not authorize removing it.

## Rollback

- Immediately pin affected clients to the recorded previous npm version using
  `pnpm dlx @gideon-defender/mcp-server@<recorded-previous-version>` and restore
  their saved arguments, credentials and transport configuration. Verify against
  the same safe test organization. The previous version is never overwritten.
- If a registry `latest` tag needs restoration, request explicit approval for a
  dist-tag change to that recorded version; do not unpublish either artifact.
- For source diagnostics, the [fixture provenance](tests/README.md) records
  Git revision `918938cc64039576494cd83e1dc6daffcbc52087`. Use a separately approved checkout,
  not a destructive reset of this workspace. The old committed binary was found
  to have an ESM dynamic-require defect: the fixture source via tsx is the parity
  oracle, not proof that a previous registry tarball starts successfully.
- Retain generated sources/helpers, fixtures, old binary, legacy overlay/config
  and history until the agreed window closes. Then review consumers and obtain
  cleanup approval; do not erase the characterization evidence.

## Generation, documentation and secret boundaries

`sdk_generation.yaml` is now a manual retirement notice: no cron, label trigger,
vendor action, write permission or vendor secret. It cannot regenerate over the
owned compiler. Publishing is replaced with gated pnpm tooling, not removed.
README, AGENTS, API contracts and generation/overlay skill routing use the owned
compiler. Historical Speakeasy instructions apply only to other explicitly
requested generation projects.

The checked-in active workflow consumer of `GRAM_API_KEY` is `gram-sync.yml`.
No active workflow now consumes `SPEAKEASY_API_KEY`, but repository/environment
secret inventory and other repositories have not been audited. No remote secret
has been removed. Preserve Gram config, hosted reachability, OAuth and legacy
metadata until a separately approved hosted migration; npm migration is not
hosted cutover. The separately authorized API-key hosted deployment is described
in [HOSTING.md](./HOSTING.md); it runs alongside Gram and does not remove OAuth.
