#!/usr/bin/env node
// CLI entry for `pnpm backfill:framework-versions`. Kept separate so the library
// module (backfill-framework-versions.ts) has no side effects on import — it is
// also dynamically imported by prisma/seed/seed.ts.
import { backfillFrameworkVersions } from './backfill-framework-versions.js';

backfillFrameworkVersions()
  .then((result) => {
    console.log('Backfill complete:', result);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
