import { rewriteAnchorHrefs } from './rewrite-anchor-hrefs';
import {
  getUserUnsubscribeUrl,
  normalizeEmail,
  verifyUnsubscribeToken,
  verifyUserUnsubscribeToken,
} from './unsubscribe';

/** Bind rendered footer links and queued headers to the same originating tenant. */
export function scopeUnsubscribeLinks(params: {
  html: string;
  email: string;
  userId?: string;
  organizationId?: string;
}): string {
  const { userId, organizationId } = params;
  if (!userId || !organizationId) return params.html;
  const scopedUrl = new URL(
    getUserUnsubscribeUrl({
      userId,
      organizationId,
      email: params.email,
    }),
  );

  // Comments appear as escaped text in these emails; never sign their URLs.
  return rewriteAnchorHrefs({
    html: params.html,
    rewriteHref: (href) => {
      let url: URL;
      try {
        url = new URL(href.replaceAll('&amp;', '&'));
      } catch {
        return href;
      }
      if (
        url.origin !== scopedUrl.origin ||
        url.pathname !== scopedUrl.pathname ||
        url.username ||
        url.password
      )
        return href;

      const email = url.searchParams.get('email');
      const token = url.searchParams.get('token');
      const linkUserId = url.searchParams.get('userId');
      const linkOrganizationId = url.searchParams.get('organizationId');
      if (
        !email ||
        !token ||
        normalizeEmail(email) !== normalizeEmail(params.email) ||
        (linkUserId && linkUserId !== userId) ||
        (linkOrganizationId && linkOrganizationId !== organizationId)
      )
        return href;

      const valid = linkUserId
        ? verifyUserUnsubscribeToken({
            userId: linkUserId,
            organizationId: linkOrganizationId ?? undefined,
            email,
            token,
          })
        : verifyUnsubscribeToken(email, token);
      if (!valid) return href;
      return scopedUrl.toString().replaceAll('&', '&amp;');
    },
  });
}
