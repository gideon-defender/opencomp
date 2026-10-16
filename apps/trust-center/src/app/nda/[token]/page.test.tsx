import { ndaFixture } from '@/test/nda-fixture';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomDomainNdaPage, { metadata } from './page';

describe('custom-domain NDA route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('opens the emailed /nda/token URL without a friendly URL segment', async () => {
    vi.stubEnv('NEXT_PUBLIC_TRUST_API_URL', 'https://api.example.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ndaFixture(),
    });
    vi.stubGlobal('fetch', fetchMock);

    const ui = await CustomDomainNdaPage({ params: Promise.resolve({ token: 'custom-token' }) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: false });
    render(ui);

    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign NDA' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/trust-access/nda/custom-token',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });

  it('opens the signed grant on the custom domain', async () => {
    vi.stubEnv('NEXT_PUBLIC_TRUST_API_URL', 'https://api.example.com');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          ndaFixture({
            status: 'signed',
            portalUrl: 'https://security.acme.com/access/grant-token',
          }),
      }),
    );
    render(await CustomDomainNdaPage({ params: Promise.resolve({ token: 'signed-token' }) }));

    expect(await screen.findByRole('link', { name: 'Open trust portal' })).toHaveAttribute(
      'href',
      'https://security.acme.com/access/grant-token',
    );
  });
});
