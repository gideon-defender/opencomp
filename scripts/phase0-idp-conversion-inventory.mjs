// Phase 0 (IdP-owned user management) conversion inventory — read-only.
// Exports every tenant's existing memberships so each can be linked to a
// verified Gideon subject and compared against effective IdP assignments for
// that tenant + application. An unlinked or role-less membership is denied
// at Phase 1, never grandfathered.
//
// SELECTs only. Never secret columns, never session tokens.
// Usage: DATABASE_URL=postgres://... node scripts/phase0-idp-conversion-inventory.mjs [--json]
// (run from repo root; pg is resolved from the workspace package that owns it
// because the root does not hoist pg.)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require(
  '../packages/trigger-local/node_modules/pg/lib/index.js',
);

const asJson = process.argv.includes('--json');
const out = (v) => {
  if (asJson) console.log(JSON.stringify(v));
};

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const hasColumn = async (table, column) => {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return r.rows.length > 0;
};

const hasRoleSource = await hasColumn('Member', 'roleSource');
const hasRevoked = await hasColumn('Member', 'idpAccessRevoked');

const memberCols = [
  'm.id AS "memberId"',
  'm."organizationId"',
  'u.email',
  'm.role',
  'm.deactivated',
  'm."isActive"',
  hasRoleSource ? 'm."roleSource"' : `'local' AS "roleSource"`,
  hasRevoked ? 'm."idpAccessRevoked"' : `false AS "idpAccessRevoked"`,
  `CASE WHEN u."gideonSub" IS NULL THEN false ELSE true END AS "linked"`,
  'u."lastLogin"',
].join(', ');

const members = (
  await client.query(
    `SELECT ${memberCols} FROM "Member" m JOIN "User" u ON u.id = m."userId" ORDER BY m."organizationId", u.email`,
  )
).rows;

const orgs = (
  await client.query(
    `SELECT id, name, "createdAt" FROM "Organization" ORDER BY id`,
  )
).rows;

const roles = (
  await client.query(
    `SELECT "organizationId", name FROM "organization_role" ORDER BY "organizationId", name`,
  )
).rows;

const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
const isOwner = (role) =>
  String(role ?? '')
    .split(',')
    .map((s) => s.trim())
    .includes('owner');

const byOrg = new Map(orgs.map((o) => [o.id, { ...o, members: [] }]));
for (const m of members) {
  if (!byOrg.has(m.organizationId)) {
    byOrg.set(m.organizationId, {
      id: m.organizationId,
      name: '<missing org row>',
      members: [],
    });
  }
  byOrg.get(m.organizationId).members.push(m);
}
const customByOrg = new Map();
for (const r of roles) {
  if (!customByOrg.has(r.organizationId)) customByOrg.set(r.organizationId, []);
  customByOrg.get(r.organizationId).push(r.name);
}

const report = [];
for (const [, org] of byOrg) {
  const active = org.members.filter((m) => !m.deactivated);
  const active30d = active.filter(
    (m) => m.lastLogin && new Date(m.lastLogin).getTime() >= thirtyDaysAgo,
  );
  const owners = active.filter((m) => isOwner(m.role));
  const unlinked = active.filter((m) => !m.linked);
  const customInUse = [
    ...new Set(
      active.flatMap((m) =>
        String(m.role ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ),
  ].filter(
    (n) => !['owner', 'admin', 'auditor', 'employee', 'contractor'].includes(n),
  );
  report.push({
    organizationId: org.id,
    organizationName: org.name,
    totalMembers: org.members.length,
    activeMembers: active.length,
    activeLast30d: active30d.length,
    owners: owners.length,
    unlinkedActive: unlinked.length,
    customRoleNamesInUse: customInUse,
    customRoleRows: customByOrg.get(org.id) ?? [],
    // Phase 1 exit criteria per tenant: would-deny == 0 among active-30d
    // (from oidc.entitlements.audit logs, joined against this export) AND
    // owners >= 1. Do not proceed until this holds everywhere.
    exitCriteria: {
      hasOwner: owners.length >= 1,
      wouldDenyPending:
        'join oidc.entitlements.audit would_deny counts for this tenant; must be 0 among active-30d',
    },
    members: org.members,
  });
}

if (asJson) {
  out({ exportedAt: new Date().toISOString(), tenants: report });
} else {
  for (const t of report) {
    console.log(
      `${t.organizationId} ${t.organizationName}: members=${t.totalMembers} active=${t.activeMembers} active30d=${t.activeLast30d} owners=${t.owners} unlinked=${t.unlinkedActive} customInUse=[${t.customRoleNamesInUse.join(',')}]`,
    );
  }
  console.log(
    `\n${report.length} tenants, ${members.length} memberships. Unlinked or role-less memberships are denied at Phase 1, never grandfathered.`,
  );
  console.log(
    `Orgs missing an owner or with unlinked actives need IdP assignments before enforcement.`,
  );
}

await client.end();
