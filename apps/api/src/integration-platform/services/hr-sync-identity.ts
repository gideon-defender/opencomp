import type { Logger } from '@nestjs/common';

export const HR_SYNC_IDENTITY_SKIP_REASON =
  'HR sync skipped: user does not exist in the tenant IdP';

/** Require a local IdP link or confirmed tenant IdP lookup, never HR data. */
export function shouldSkipHrSync({
  identity,
  email,
  organizationId,
  providerName,
  logger,
  results,
}: {
  identity: { id: string } | null;
  email: string;
  organizationId: string;
  providerName: string;
  logger: Pick<Logger, 'log'>;
  results: {
    skipped: number;
    details: { email: string; status: string; reason?: string }[];
  };
}): boolean {
  if (identity) return false;

  const normalizedEmail = email.toLowerCase();
  if (
    results.details.some(
      (detail) =>
        detail.email.toLowerCase() === normalizedEmail &&
        detail.reason === HR_SYNC_IDENTITY_SKIP_REASON,
    )
  ) {
    return true;
  }

  results.skipped++;
  results.details.push({
    email: normalizedEmail,
    status: 'skipped',
    reason: HR_SYNC_IDENTITY_SKIP_REASON,
  });
  logger.log({
    message: HR_SYNC_IDENTITY_SKIP_REASON,
    reason: 'missing_idp_identity',
    organizationId,
    provider: providerName,
    email: normalizedEmail,
  });
  return true;
}

export function recordHrSyncError({
  error,
  email,
  organizationId,
  providerName,
  logger,
  results,
}: {
  error: unknown;
  email: string;
  organizationId: string;
  providerName: string;
  logger: Pick<Logger, 'error'>;
  results: {
    errors: number;
    details: { email: string; status: string; reason?: string }[];
  };
}): void {
  const reason = error instanceof Error ? error.message : 'Unknown error';
  results.errors++;
  results.details.push({ email: email.toLowerCase(), status: 'error', reason });
  logger.error({
    message: 'HR sync failed for user',
    organizationId,
    provider: providerName,
    email: email.toLowerCase(),
    reason,
  });
}
