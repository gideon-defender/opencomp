# Runbook: IdP-owned user management (Phase 5 prerequisites)

Companion to `docs/plans/2026-10-11-idp-owned-user-management.md`. Ship these
before Phase 1 enforcement. OpenComp no longer grants, changes, or removes a
human's org access: the Gideon identity service decides who holds which role
name, OpenComp syncs it into `Member.role` and enforces.

## 1. New tenant onboarding (IdP steps in order)

1. Provision the tenant in Gideon Auth (tenant id becomes `Organization.id` —
   OpenComp never generates tenant ids).
2. Link OpenComp's OAuth client to an application (`applications` +
   `application_oidc_configs`). Without the link the ID token carries no
   `entitlements` claim at all.
3. Seed application roles with values matching OpenComp role names verbatim
   (`owner`, `admin`, `auditor`, `employee`, `contractor` + legacy custom
   names in use). No translation table in v1.
4. Assign at least one `owner` for the tenant. Direct assignments are
   auto-approved; group-sourced assignments need a review decision to count.
5. Verify: the new owner's first login carries an `owner` value in the claim
   (check the IdP emission audit, then OpenComp's
   `oidc.entitlements.audit would_overwrite` log). Setup without an `owner`
   value in the claim is denied with "ask your IdP admin" messaging — never
   a local grant.
6. Do NOT create the owner via any OpenComp endpoint: `POST /v1/people`,
   `PATCH /v1/people/:id`, `POST /v1/organization/transfer-ownership`, and
   the Better Auth `organization/*` mutations all return 410 Gone.

Pre-Phase-1 gate: self-service setup (`apps/app/.../setup/actions/`) still
creates the org + owner member from the login tenant. The owner claim check
at setup lands with Phase 1 enforcement; until then, new tenants must follow
steps 1–5 above before first login.

## 2. User denied at login (`error=no_role`, Phase 1+)

1. Find the grant/deny audit line for the user's email (`oidc.entitlements.audit`):
   `would_deny`/`deny` with presented values and reason.
2. `empty_entitlements` → the user has no assignment for OpenComp's
   application in this tenant. Check: application link exists, role exists
   with the right entitlement value, assignment is direct (or group grant
   reviewed), assignment not expired, no active governance exception.
3. `no_valid_match` → assignments exist but for another app (or a renamed
   role). Values must equal OpenComp role names verbatim.
4. `unknown_tenant` → tenant has no org; follow runbook 1.
5. Fix in Gideon, user retries login. Never "fix" by writing `Member.role`
   locally — every legacy writer is fenced (410) and login overwrites
   SSO-managed rows anyway.

## 3. All owners lost (break-glass)

There is no OpenComp-local recovery: no endpoint creates an owner from any
credentials, including owner or support sessions. `tenant_admin_read`
support sessions are GET/HEAD-only and cannot grant ownership.

1. Approve an IdP assignment-repair: constrained to the target
   tenant + application + subject, time-boxed, and audited.
2. Repair the `owner` assignment IdP-side.
3. The repaired user logs in (or the nightly reconciliation runs);
   OpenComp materializes the verified assignment into `Member.role`.
4. Alert on every repair. Drill quarterly: read-only support rejection,
   cross-tenant denial, and expiry.

## 4. IdP outage

- Login denies closed (no cached-role fallback at login).
- The nightly reconciliation job holds last-known roles and pages loudly on
  fetch failure — it never clears on error.
- Communicate: status page + customer on-call email, never an individual inbox.

## Pre-Phase-1 checklist (do not enforce until all hold)

- [ ] Per-tenant report (`scripts/phase0-idp-conversion-inventory.mjs` +
      `oidc.entitlements.audit` logs) shows zero would-deny among users
      active in the last 30 days, everywhere.
- [ ] Every org has ≥1 would-be owner.
- [ ] Phase 3 server fences deployed (this runbook's step-1 item 6 verified:
      authorized legacy writes return 410 without DB changes; 401/403
      preserved for unauthenticated/unauthorized callers).
- [ ] IdP owner seeding at provisioning confirmed per tenant (steps 1–5).
- [ ] Break-glass drill passed this quarter (read-only rejection,
      cross-tenant denial, expiry).

## Pilot cutover order (Phase 1, one tenant)

1. Export the IdP effective assignments for (pilot tenant, OpenComp
   application) to `[{ "email", "roles" }]` JSON.
   Verify that existing users have a Gideon subject link before cutover.
   The conversion revokes unlinked memberships even when their email has
   an assignment, and excludes them from the active-owner check.
2. Dry-run the conversion and review every line (updates, revocations,
   pending-first-login, owners-after ≥ 1, sessions to invalidate):
   `DATABASE_URL=... node scripts/phase1-pilot-conversion.mjs --tenant <id> --assignments <file>`.
3. Apply: same command with `--apply`. The script aborts unless zero local
   rows remain, then invalidates all tenant sessions (existing sessions
   cannot retain pre-conversion privileges).
4. Enable enforcement for the pilot tenant only:
   `GIDEON_ENFORCEMENT_TENANTS=<tenant-id>` on the API. Clearing the var is
   the instant rollback (rows stay synced, fences stay up).
5. Enable the bootstrap gate only after IdP provisioning seeds an owner per
   new tenant: `GIDEON_BOOTSTRAP_ENFORCED=true`. Until then, unknown
   tenants keep the old setup flow.
   Deploy the API setup-authorization endpoint and both setup callers before
   enabling the gate. Setup checks owner proof bound to the browser session,
   user, and tenant; old sessions without proof must sign in again. Proof
   uses the shared login Redis store and expires with the session. A missing
   proof or Redis failure denies setup; never restore proof from local roles.
6. Watch `oidc.entitlements.enforce deny/grant` lines for the first denied
   user; triage via runbook 2 above.
7. Fleet: extend `GIDEON_ENFORCEMENT_TENANTS` tenant by tenant (convert each
   with steps 1–3 first). Phase 2's nightly job closes the between-login
   revocation gap (up to 7 days via `SESSION_TTL_SECONDS`); until it ships,
   revocation lands at next login.

## Membership uniqueness migration

Pilot conversion rebuilds its plan inside the apply transaction after it locks
the tenant, memberships, and users. It checks persisted active-owner availability
before it deletes sessions or commits. HR changes that finish before the locks
are acquired affect the new plan; later changes wait until conversion finishes.

The index build and constraint attachment are separate migrations. The
index migration must remain a single SQL statement without `BEGIN` so
Prisma can run `CREATE UNIQUE INDEX CONCURRENTLY`. The attachment has a
five-second lock timeout; retry it during a quieter window if it times out.

If the concurrent build fails, check for duplicate `(organizationId, userId)`
memberships and resolve them without deleting records referenced by other
rows. PostgreSQL can leave an invalid index after a failed concurrent build.
Check `pg_index.indisvalid` for `Member_organizationId_userId_key`; if it is
invalid and not attached to a constraint, drop that index before retrying.
Mark only the failed migration rolled back with `pnpm exec prisma migrate
resolve --rolled-back <migration-name>` from `packages/db`, then rerun
`pnpm exec prisma migrate deploy`. Do not drop a valid constraint or restore
old local roles as part of recovery.
