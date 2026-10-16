'use client';

import TrustCenterNotFound from '@/app/not-found';
import { TrustFooter } from '@/components/TrustFooter';
import { trustApi } from '@/lib/api';
import Link from 'next/link';
import { useState } from 'react';
import useSWR, { SWRConfig } from 'swr';
import { NdaSigningContent } from './NdaSigningContent';

export function NdaSigningClient({ token, friendlyUrl }: { token: string; friendlyUrl?: string }) {
  const [cache] = useState(() => new Map());
  return (
    <SWRConfig value={{ provider: () => cache }}>
      <NdaSigningLoader token={token} friendlyUrl={friendlyUrl} />
    </SWRConfig>
  );
}

function NdaSigningLoader({ token, friendlyUrl }: { token: string; friendlyUrl?: string }) {
  // Fetch from the visitor's browser: SSR would share one IP-based NDA quota across all visitors.
  const { data, error, isLoading } = useSWR(
    ['nda', token],
    ([, signToken]) => trustApi.nda(signToken),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );

  if (isLoading || error) {
    return (
      <div className="min-h-dvh bg-canvas">
        <div className="mx-auto w-full max-w-2xl px-4 py-10 md:px-6 md:py-16">
          <section className="rounded-lg border border-line bg-surface p-6 text-center md:p-8">
            {error ? (
              <>
                <h1 className="text-lg font-semibold">Could not load this NDA</h1>
                <p className="mt-1 text-sm text-muted">
                  Check your connection and try again. If the problem persists, ask the security
                  team to resend the link.
                </p>
                <Link
                  href={friendlyUrl ? `/${friendlyUrl}` : '/'}
                  className="mt-4 inline-flex min-h-10 items-center rounded-md border border-line px-4 text-sm font-semibold transition-colors hover:bg-surface"
                >
                  Back to trust center
                </Link>
              </>
            ) : (
              <p role="status">Loading NDA…</p>
            )}
          </section>
          <TrustFooter />
        </div>
      </div>
    );
  }

  if (!data) return <TrustCenterNotFound />;
  return <NdaSigningContent nda={data} token={token} friendlyUrl={friendlyUrl} />;
}
