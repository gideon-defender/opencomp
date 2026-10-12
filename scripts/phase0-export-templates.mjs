// Phase 0 step 6: export global templates into versioned repo fixtures.
// Read-only (SELECTs). Output: packages/db/prisma/fixtures/global-templates/v1/*.json
// Usage: DATABASE_URL=postgres://... node scripts/phase0-export-templates.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Client } = require("../packages/trigger-local/node_modules/pg/lib/index.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "packages/db/prisma/fixtures/global-templates/v1");
mkdirSync(outDir, { recursive: true });

const TABLES = [
  "FindingTemplate",
  "TimelineTemplate",
  "TimelinePhaseTemplate",
  "FrameworkEditorPolicyTemplate",
  "FrameworkEditorTaskTemplate",
  "FrameworkEditorControlTemplate",
  "FrameworkEditorIsmsDocumentTemplate",
  "FrameworkEditorControlPolicyTemplateLink",
  "FrameworkEditorControlTaskTemplateLink",
  // Implicit many-to-many join tables (relations live here, not in the
  // explicit link models above).
  "_FrameworkEditorControlTemplateToFrameworkEditorPolicyTemplate",
  "_FrameworkEditorControlTemplateToFrameworkEditorRequirement",
  "_FrameworkEditorControlTemplateToFrameworkEditorTaskTemplate",
  "OffboardingChecklistTemplate",
];

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const manifest = { version: 1, exportedAt: new Date().toISOString(), tables: {} };
for (const t of TABLES) {
  try {
    const r = await client.query(`SELECT * FROM "${t}" ORDER BY 1`);
    writeFileSync(join(outDir, `${t}.json`), `${JSON.stringify(r.rows, null, 1)}\n`);
    manifest.tables[t] = r.rows.length;
    console.log(`${t}: ${r.rows.length} rows`);
  } catch (e) {
    manifest.tables[t] = `ERROR ${e.code ?? e.message}`;
    console.log(`${t}: ERROR ${e.code ?? e.message}`);
  }
}
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await client.end();
console.log(`wrote ${outDir}`);
