export * from '@prisma/client';
export { db, tenantDb, serviceDb, withTenant, withService } from './client';
// Single-source email form: re-exported from `@gideon-defender/email` (not
// `@gideon-defender/db`, which would drag the Prisma/Bedrock bundle into
// every API module for a one-liner). The email package cannot import `@db`
// (tsup bundle), so the one-liner lives in exactly two places — here via
// re-export, and `packages/email/lib/unsubscribe.ts` — pinned by the
// contract tests on each side.
export { normalizeEmail } from '@gideon-defender/email';
