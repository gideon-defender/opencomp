'use client';

import { env } from '@/env.mjs';
import { Button } from '@gideon-defender/ui/button';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

interface OidcSignInProps {
  inviteCode?: string;
  redirectTo?: string;
}

/**
 * Milestone 1 — "Continue with Gideon" (dual-run, better-auth buttons kept).
 * Plain redirect to the API's OIDC login endpoint; no client library involved.
 */
export function OidcSignIn({ inviteCode, redirectTo }: OidcSignInProps) {
  const [isLoading, setLoading] = useState(false);

  const handleSignIn = () => {
    setLoading(true);
    const apiBase = env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';
    const params = new URLSearchParams();
    if (inviteCode) params.set('inviteCode', inviteCode);
    if (redirectTo) params.set('redirectTo', redirectTo);
    // Both API versions serve this route while deployments overlap.
    const loginUrl = new URL('/v1/auth/gideon/login', apiBase);
    const query = params.toString();
    if (query) loginUrl.search = query;
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
      Continue with Gideon
    </Button>
  );
}
