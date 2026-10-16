import { ndaFixture } from '@/test/nda-fixture';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NdaSigningPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe('NdaSigningPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubNdaFetch(response: { ok: boolean; status?: number; body?: unknown }) {
    vi.stubEnv('NEXT_PUBLIC_TRUST_API_URL', 'https://public-api.example.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: () => Promise.resolve(response.body ?? null),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function renderPage(token: string, friendlyUrl = 'acme') {
    return NdaSigningPage({ params: Promise.resolve({ friendlyUrl, token }) }).then((ui) =>
      render(<SWRConfig value={{ provider: () => new Map() }}>{ui}</SWRConfig>),
    );
  }

  it('renders the signing form for a pending NDA', async () => {
    stubNdaFetch({ ok: true, body: ndaFixture() });

    await renderPage('tok-pending');

    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText(/Prepared for Ada Lovelace/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ada Lovelace')).toHaveValue('Ada Lovelace');
    expect(screen.getByText('Sign NDA')).toBeInTheDocument();
  });

  it('renders the portal link for a signed NDA', async () => {
    stubNdaFetch({
      ok: true,
      body: ndaFixture({
        status: 'signed',
        portalUrl: 'https://trust.example.com/acme/access/grant-tok',
      }),
    });

    await renderPage('tok-signed');

    expect(await screen.findByText('Already signed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open trust portal' })).toHaveAttribute(
      'href',
      'https://trust.example.com/acme/access/grant-tok',
    );
  });

  it('renders no portal link for a signed NDA with an unsafe portal URL', async () => {
    stubNdaFetch({
      ok: true,
      body: ndaFixture({ status: 'signed', portalUrl: 'javascript:alert(1)' }),
    });

    await renderPage('tok-signed-unsafe');

    expect(await screen.findByText('Already signed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open trust portal' })).toBeNull();
  });

  it('renders the expired and revoked states', async () => {
    stubNdaFetch({ ok: true, body: ndaFixture({ status: 'expired' }) });
    await renderPage('tok-expired');
    expect(await screen.findByText('Link expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to trust center' })).toHaveAttribute(
      'href',
      '/acme',
    );

    stubNdaFetch({ ok: true, body: ndaFixture({ status: 'void' }) });
    await renderPage('tok-void');
    expect(await screen.findByText('NDA revoked')).toBeInTheDocument();
  });

  it('renders an unavailable state for an unknown status', async () => {
    stubNdaFetch({ ok: true, body: ndaFixture({ status: 'archived' }) });
    await renderPage('tok-archived');

    expect(await screen.findByText('Link unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to trust center' })).toHaveAttribute(
      'href',
      '/acme',
    );
  });

  it('shows not-found for an unknown token', async () => {
    stubNdaFetch({ ok: false, status: 404 });

    await renderPage('tok-unknown');
    expect(await screen.findByText('Trust Center not found')).toBeInTheDocument();
  });

  it('renders an error state instead of not-found on backend failure', async () => {
    stubNdaFetch({ ok: false, status: 500 });

    await renderPage('tok-broken');

    expect(await screen.findByText('Could not load this NDA')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to trust center' })).toHaveAttribute(
      'href',
      '/acme',
    );
  });

  it('hides requester details under the wrong slug', async () => {
    stubNdaFetch({ ok: true, body: ndaFixture() });

    await renderPage('tok-slug', 'wrong-slug');
    expect(await screen.findByText('Trust Center not found')).toBeInTheDocument();
    expect(screen.queryByText(/Prepared for/)).toBeNull();
  });

  it('does not spend the shared server quota on metadata or page render', async () => {
    const fetchMock = stubNdaFetch({ ok: true, body: ndaFixture() });
    for (let index = 0; index < 11; index += 1) {
      await NdaSigningPage({
        params: Promise.resolve({ friendlyUrl: 'acme', token: `tok-${index}` }),
      });
    }
    expect(metadata.title).toBe('NDA signing');
    expect(fetchMock).not.toHaveBeenCalled();

    await renderPage('tok-browser');
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://public-api.example.com/v1/trust-access/nda/tok-browser',
      expect.objectContaining({ cache: 'no-store', credentials: 'include' }),
    );
  });

  it('reads again after a failed visit without an automatic retry loop', async () => {
    const fetchMock = stubNdaFetch({ ok: false, status: 429 });
    const first = await renderPage('tok-retry');
    expect(await screen.findByText('Could not load this NDA')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ndaFixture() });
    first.unmount();
    await renderPage('tok-retry');
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads fresh status after a signature and a new page visit', async () => {
    const fetchMock = stubNdaFetch({ ok: true, body: ndaFixture() });
    const first = await renderPage('tok-refresh');
    expect(await screen.findByText('Sign NDA')).toBeInTheDocument();
    first.unmount();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ndaFixture({ status: 'signed' }) });
    await renderPage('tok-refresh');
    expect(await screen.findByText('Already signed')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
