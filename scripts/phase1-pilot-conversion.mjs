// Phase 1 (IdP-owned user management) pilot-tenant cutover — one-shot.
// Converts every existing human membership in ONE tenant to roleSource='sso'
// from verified effective IdP assignments, then invalidates tenant sessions
// so no pre-conversion privilege survives.
//
// Input: assignments JSON exported from the IdP effective-access inventory
// for (tenant, OpenComp application):
//   [{ "email": "ada@example.com", "roles": ["admin"] }]
// An unlinked or role-less membership is denied (idpAccessRevoked=true),
// never grandfathered with its old local roles. Assignments with no member
// row are reported as pending-first-login — this script never creates
// members (JIT at login does) and never deletes rows (FK anchors).
//
// Rollback: keep mutation fences + synced roles; do NOT restore old local
// grants automatically. Any legacy-mode rollback needs an explicit access
// review and must keep honoring recorded IdP revocations.
//
// Usage:
//   DATABASE_URL=... node scripts/phase1-pilot-conversion.mjs \
//     --tenant <tenant-id> --assignments <path.json> [--apply]
// Dry-run (default): prints the plan, changes nothing. --apply executes in
// one transaction and aborts unless zero local rows remain afterwards. Run from repo root; pg resolves as in the phase0
// scripts because the root does not hoist pg.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { applyPilotConversion } from './lib/apply-pilot-conversion.mjs';
import { buildPilotConversionPlan } from './lib/pilot-conversion-plan.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('../packages/trigger-local/node_modules/pg/lib/index.js');

const BUILT_INS = new Set(['owner', 'admin', 'auditor', 'employee', 'contractor']);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenantId = arg('tenant');
const assignmentsPath = arg('assignments');
const apply = process.argv.includes('--apply');

if (!tenantId || !assignmentsPath) {
  console.error(
    'Usage: node scripts/phase1-pilot-conversion.mjs --tenant <id> --assignments <path.json> [--apply]',
  );
  process.exit(2);
}

const assignments = JSON.parse(readFileSync(assignmentsPath, 'utf8'));
if (!Array.isArray(assignments)) {
  console.error('assignments file must be a JSON array');
  process.exit(2);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const hasColumn = async (column) => {
    const r = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Member' AND column_name=$1`,
      [column],
    );
    return r.rows.length > 0;
  };
  if (!(await hasColumn('roleSource')) || !(await hasColumn('idpAccessRevoked'))) {
    throw new Error(
      'Member.roleSource/idpAccessRevoked columns missing — run prisma migrations first',
    );
  }

  const org = await client.query(`SELECT id, name FROM "Organization" WHERE id=$1`, [tenantId]);
  if (org.rows.length === 0) {
    throw new Error(
      `tenant ${tenantId} has no Organization row — cutover is for existing tenants; new tenants bootstrap via the owner claim`,
    );
  }

  const custom = await client.query(
    `SELECT name FROM "organization_role" WHERE "organizationId"=$1`,
    [tenantId],
  );
  const valid = new Set([...BUILT_INS, ...custom.rows.map((r) => r.name)]);

  const byEmail = new Map();
  for (const a of assignments) {
    const email = String(a.email ?? '')
      .trim()
      .toLowerCase();
    const roles = [...new Set((a.roles ?? []).map((r) => String(r).trim()).filter(Boolean))];
    if (!email || roles.length === 0) {
      throw new Error(
        `invalid assignment entry (need email + non-empty roles): ${JSON.stringify(a)}`,
      );
    }
    const unknown = roles.filter((r) => !valid.has(r));
    if (unknown.length > 0) {
      throw new Error(
        `assignment for ${email} names invalid roles [${unknown.join(',')}] — valid: built-ins + this org's organization_role rows`,
      );
    }
    byEmail.set(email, roles);
  }

  const members = (
    await client.query(
      `SELECT m.id AS "memberId", u.email, u."oidcSub", u.banned, m.role, m."roleSource", m."idpAccessRevoked", m.deactivated, m."isActive"
       FROM "Member" m JOIN "User" u ON u.id = m."userId"
       WHERE m."organizationId"=$1 ORDER BY u.email`,
      [tenantId],
    )
  ).rows;

  const { plan, owners } = buildPilotConversionPlan({ members, byEmail });
  const unmatched = [...byEmail.keys()].filter(
    (email) => !members.some((m) => String(m.email).trim().toLowerCase() === email),
  );

  const counts = {
    keep: plan.filter((p) => p.action === 'keep').length,
    update: plan.filter((p) => p.action === 'update').length,
    revoke: plan.filter((p) => p.action === 'revoke').length,
  };
  const sessions = await client.query(
    `SELECT count(*)::int AS n FROM "Session" WHERE "userId" IN (SELECT "userId" FROM "Member" WHERE "organizationId"=$1)`,
    [tenantId],
  );

  console.log(`tenant ${tenantId} (${org.rows[0].name}): ${members.length} member(s)`);
  for (const p of plan.filter((p) => p.action !== 'keep')) {
    console.log(
      `  ${p.action} ${p.email}: role "${p.role}" -> "${p.newRole}"${p.deactivated ? ' (deactivated, preserved)' : ''}`,
    );
  }
  console.log(
    `summary: keep=${counts.keep} update=${counts.update} revoke=${counts.revoke} owners_after=${owners} sessions_to_invalidate=${sessions.rows[0].n}`,
  );
  if (unmatched.length > 0) {
    console.log(`pending-first-login (no member row, not created): ${unmatched.join(', ')}`);
  }

  if (!apply) {
    console.log('dry-run: no changes made. Re-run with --apply to execute.');
    await client.end();
    process.exit(0);
  }

  const applied = await applyPilotConversion({ client, tenantId, byEmail });
  console.log(
    `applied: update=${applied.update} revoke=${applied.revoke} owners_after=${applied.owners} sessions_invalidated=${applied.sessionsInvalidated}`,
  );
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
