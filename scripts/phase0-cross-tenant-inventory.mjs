// Phase 0 (remove-cross-tenant-roles) read-only inventory.
// SELECTs only. Selects metadata (slugs, counts, timestamps) — never secret
// columns (encryptedClientId/Secret) and never session tokens.
// Usage: DATABASE_URL=postgres://... node scripts/phase0-cross-tenant-inventory.mjs
// (run from repo root; pg is resolved from the workspace package that owns it
// because the root does not hoist pg.)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("../packages/trigger-local/node_modules/pg/lib/index.js");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const q = async (name, sql) => {
  try {
    const r = await client.query(sql);
    console.log(`--- ${name} (${r.rows.length} rows) ---`);
    for (const row of r.rows) console.log(JSON.stringify(row));
  } catch (e) {
    console.log(`--- ${name}: ERROR ${e.code ?? e.message} ---`);
  }
};

// Step 2 precondition: impersonated sessions must be zero before cutover.
await q("impersonated_sessions", `SELECT id, "userId", "impersonatedBy", "createdAt", "expiresAt"
  FROM "Session" WHERE "impersonatedBy" IS NOT NULL ORDER BY "createdAt"`);
// Step 1: global-role holders.
await q("platform_admin_users", `SELECT id, email, role, "isPlatformAdmin", "createdAt" FROM "User" WHERE role = 'admin' OR "isPlatformAdmin" = true`);
// Steps 3-4: fallback reliance. A provider relies on the platform fallback when
// platform rows exist and org rows are missing for orgs with connections.
await q("platform_creds", `SELECT "providerSlug", "createdAt", "updatedAt" FROM "IntegrationPlatformCredential" ORDER BY 1`);
await q("org_oauth_by_provider", `SELECT "providerSlug", count(*) AS org_rows FROM "IntegrationOAuthApp" GROUP BY 1 ORDER BY 1`);
await q("connections_by_provider", `SELECT p.slug AS "providerSlug", count(*) AS connections FROM "IntegrationConnection" c JOIN "IntegrationProvider" p ON p.id = c."providerId" GROUP BY 1 ORDER BY 1`);
// Step 6: global template content to fixture.
await q("templates", `
  SELECT 'FindingTemplate' t, count(*) FROM "FindingTemplate" UNION ALL
  SELECT 'TimelineTemplate', count(*) FROM "TimelineTemplate" UNION ALL
  SELECT 'TimelinePhaseTemplate', count(*) FROM "TimelinePhaseTemplate" UNION ALL
  SELECT 'FrameworkEditorPolicyTemplate', count(*) FROM "FrameworkEditorPolicyTemplate" UNION ALL
  SELECT 'FrameworkEditorTaskTemplate', count(*) FROM "FrameworkEditorTaskTemplate" UNION ALL
  SELECT 'FrameworkEditorControlTemplate', count(*) FROM "FrameworkEditorControlTemplate" UNION ALL
  SELECT 'FrameworkEditorIsmsDocumentTemplate', count(*) FROM "FrameworkEditorIsmsDocumentTemplate" UNION ALL
  SELECT 'OffboardingChecklistTemplate', count(*) FROM "OffboardingChecklistTemplate"`);
await q("internal_orgs", `SELECT id, name FROM "Organization" WHERE "isInternal" = true`);

await client.end();
