import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomDomainAccessPage from '../../../access/[token]/page';
import SharedHostAccessPage from './page';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('grant access routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubGrant() {
    vi.stubEnv('NEXT_PUBLIC_TRUST_API_URL', 'https://api.example.com');
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('/access/grant-token')
          ? {
              organizationName: 'Acme',
              friendlyUrl: 'acme',
              faviconUrl: null,
              logoUrl: null,
              primaryColor: null,
              subjectEmail: 'ada@company.com',
              expiresAt: '2027-01-01',
            }
          : [{ id: 'policy_1', name: 'Security policy', description: null }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('opens the shared-host URL returned after an NDA signature', async () => {
    stubGrant();
    render(
      await SharedHostAccessPage({
        params: Promise.resolve({ friendlyUrl: 'acme', token: 'grant-token' }),
      }),
    );

    expect(screen.getByText('Acme Trust Center')).toBeInTheDocument();
    expect(screen.getByText('Shared with ada@company.com', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PDF' })).toHaveAttribute(
      'href',
      'https://api.example.com/v1/trust-access/access/grant-token/policies/policy_1/download',
    );
  });

  it('keeps the existing custom-domain /access/token route', async () => {
    stubGrant();
    render(await CustomDomainAccessPage({ params: Promise.resolve({ token: 'grant-token' }) }));
    expect(screen.getByText('Acme Trust Center')).toBeInTheDocument();
  });

  it('rejects a grant URL under another organization slug before it loads documents', async () => {
    const fetchMock = stubGrant();
    await expect(
      SharedHostAccessPage({
        params: Promise.resolve({ friendlyUrl: 'another-org', token: 'grant-token' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown grant token', async () => {
    vi.stubEnv('NEXT_PUBLIC_TRUST_API_URL', 'https://api.example.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(
      SharedHostAccessPage({
        params: Promise.resolve({ friendlyUrl: 'acme', token: 'missing-token' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
