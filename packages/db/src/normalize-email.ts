/**
 * Canonical email form for tenant-scoped uniqueness.
 *
 * Contract: identical to `normalizeEmail` in `@gideon-defender/email`
 * (`packages/email/lib/unsubscribe.ts`) — `trim().toLowerCase()`. The email
 * package must not import `@db` (tsup bundle; DI pattern), and `@db` must
 * not import the email package (wrong layer for a DB package), so the
 * one-liner lives in exactly these two places by design. The
 * apps/api and apps/app prisma shims re-export the email copy rather than
 * defining a third and fourth. Keep both in sync; the contract tests on
 * each side pin it. The contract migration CHECK enforces this exact form.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
