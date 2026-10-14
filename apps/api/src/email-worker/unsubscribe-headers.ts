import {
  generateUnsubscribeToken,
  generateUserUnsubscribeToken,
} from '@gideon-defender/email';

/**
 * RFC 8058 List-Unsubscribe headers for a queued email.
 *
 * User-scoped links (`userId` present) bind the token to one tenant account,
 * so Gmail Unsubscribe hits exactly that account even when several tenants
 * share the address. Without a user id the legacy email-only link is used,
 * which verifiers no-op (by design) on shared addresses.
 */
export function buildUnsubscribeHeaders(params: {
  to: string;
  userId?: string;
  organizationId?: string;
  apiBaseUrl: string;
}): Record<string, string> {
  const { to, userId, organizationId, apiBaseUrl } = params;
  const oneClickUrl = userId
    ? `${apiBaseUrl}/v1/email/unsubscribe?userId=${encodeURIComponent(userId)}&email=${encodeURIComponent(to)}&token=${encodeURIComponent(generateUserUnsubscribeToken({ userId, organizationId, email: to }))}${organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : ''}`
    : `${apiBaseUrl}/v1/email/unsubscribe?email=${encodeURIComponent(to)}&token=${encodeURIComponent(generateUnsubscribeToken(to))}`;

  return {
    'List-Unsubscribe': `<${oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
