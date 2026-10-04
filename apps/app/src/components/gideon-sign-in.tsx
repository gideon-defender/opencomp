'use client';

import { env } from '@/env.mjs';
import { Button } from '@trycompai/design-system';
import { useState } from 'react';

interface GideonSignInProps {
  inviteCode?: string;
  redirectTo?: string;
}

/**
 * Milestone 1 — "Continue with Gideon" (dual-run, better-auth buttons kept).
 * Plain redirect to the API's OIDC login endpoint; no client library involved.
 */
export function GideonSignIn({ inviteCode, redirectTo }: GideonSignInProps) {
  const [isLoading, setLoading] = useState(false);

  const handleSignIn = () => {
    setLoading(true);
    const apiBase = env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';
    const params = new URLSearchParams();
    if (inviteCode) params.set('inviteCode', inviteCode);
    if (redirectTo) params.set('redirectTo', redirectTo);
    const loginUrl = new URL('/v1/auth/gideon/login', apiBase);
    const query = params.toString();
    if (query) loginUrl.search = query;
    window.location.href = loginUrl.toString();
  };

  return (
    <Button onClick={handleSignIn} variant="outline" width="full" size="xl" loading={isLoading}>
      Continue with Gideon
    </Button>
  );
}
