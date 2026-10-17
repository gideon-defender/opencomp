'use client';

import { Button } from '@gideon-defender/ui/button';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * Milestone 1 — "Continue with Gideon" (dual-run, OTP/social buttons kept).
 * Plain redirect to the API's OIDC login endpoint; no client library involved.
 */
export function OidcSignIn({
  inviteCode,
  redirectTo,
}: {
  inviteCode?: string;
  redirectTo?: string;
}) {
  const [isLoading, setLoading] = useState(false);
  const t = useTranslations('auth');

  const handleSignIn = () => {
    setLoading(true);
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';
    const params = new URLSearchParams();
    if (inviteCode) params.set('inviteCode', inviteCode);
    if (redirectTo) params.set('redirectTo', toAbsoluteUrl(redirectTo));
    const loginUrl = new URL('/v1/auth/oidc/login', apiBase);
    const query = params.toString();
    if (query) loginUrl.search = query;
    // External OIDC endpoint on another origin — needs a full document load,
    // router.push only handles internal navigation.
    window.location.href = loginUrl.toString();
  };

  return (
    <Button
      onClick={handleSignIn}
      variant="outline"
      className="h-12 w-full"
      size="lg"
      disabled={isLoading}
      aria-busy={isLoading}
    >
      {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {t('continueWithGideon')}
    </Button>
  );
}

/**
 * Resolve the post-login target against the portal's own origin so the API
 * can redirect back here. The API only honors absolute URLs on its
 * trusted-origin list, so a crafted value cannot become an open redirect.
 * The origin is a parameter (defaulting to the page origin) so tests can
 * pin the resolution without a DOM.
 */
export function toAbsoluteUrl(target: string, origin: string = window.location.origin): string {
  try {
    const url = new URL(target, origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return target;
    return url.toString();
  } catch {
    return target;
  }
}
