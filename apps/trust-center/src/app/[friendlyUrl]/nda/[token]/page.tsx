import { NdaSigningClient } from '@/components/NdaSigningClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NDA signing',
  description: 'Review and sign the non-disclosure agreement to access trust documents.',
  robots: { index: false, follow: false },
};

export default async function NdaSigningPage({
  params,
}: {
  params: Promise<{ friendlyUrl?: string; token: string }>;
}) {
  const { friendlyUrl, token } = await params;
  return <NdaSigningClient token={token} friendlyUrl={friendlyUrl} />;
}
