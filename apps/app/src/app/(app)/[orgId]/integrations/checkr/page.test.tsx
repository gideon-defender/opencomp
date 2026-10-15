import { serverApi } from '@/lib/api-server';
import { resolveCurrentUserPermissions } from '@/lib/permissions.server';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CheckrIntegrationPage from './page';

vi.mock('@/lib/api-server', () => ({ serverApi: { get: vi.fn() } }));
vi.mock('@/lib/permissions.server', () => ({ resolveCurrentUserPermissions: vi.fn() }));
vi.mock('./components/CheckrDetailsClient', () => ({
  CheckrDetailsClient: ({
    canConfigureCheckr,
    canReadReadiness,
    initialReadiness,
  }: {
    canConfigureCheckr: boolean;
    canReadReadiness: boolean;
    initialReadiness?: { ready: boolean };
  }) => (
    <>
      {canConfigureCheckr && <button>Configure Checkr</button>}
      {canReadReadiness && initialReadiness?.ready && <p>Ready</p>}
    </>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(serverApi.get).mockResolvedValue({ data: { ready: true }, status: 200 });
});

async function renderPage() {
  render(await CheckrIntegrationPage({ params: Promise.resolve({ orgId: 'org_1' }) }));
}

describe('Checkr page permissions', () => {
  it.each([{ secret: [] }, { secret: ['create'] }, { secret: ['delete'] }])(
    'hides setup for integration editors with incomplete secret permissions $secret',
    async ({ secret }) => {
      vi.mocked(resolveCurrentUserPermissions).mockResolvedValue({
        integration: ['read', 'update'],
        secret,
      });

      await renderPage();

      expect(screen.queryByRole('button', { name: 'Configure Checkr' })).not.toBeInTheDocument();
      expect(serverApi.get).toHaveBeenCalledExactlyOnceWith(
        '/v1/people/candidate-screenings/connection/readiness',
        { 'X-Organization-Id': 'org_1' },
      );
      expect(screen.getByText('Ready')).toBeInTheDocument();
    },
  );

  it('allows configuration and health without screening permissions', async () => {
    vi.mocked(resolveCurrentUserPermissions).mockResolvedValue({
      integration: ['read', 'update'],
      secret: ['create', 'delete'],
    });

    await renderPage();

    expect(screen.getByRole('button', { name: 'Configure Checkr' })).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(serverApi.get).toHaveBeenCalledExactlyOnceWith(
      '/v1/people/candidate-screenings/connection/readiness',
      { 'X-Organization-Id': 'org_1' },
    );
  });

  it('keeps the existing readiness endpoint for screeners', async () => {
    vi.mocked(resolveCurrentUserPermissions).mockResolvedValue({ backgroundCheck: ['create'] });

    await renderPage();

    expect(serverApi.get).toHaveBeenCalledExactlyOnceWith(
      '/v1/people/candidate-screenings/readiness',
      { 'X-Organization-Id': 'org_1' },
    );
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configure Checkr' })).not.toBeInTheDocument();
  });

  it('does not fetch health or offer setup to read-only users', async () => {
    vi.mocked(resolveCurrentUserPermissions).mockResolvedValue({ integration: ['read'] });

    await renderPage();

    expect(serverApi.get).not.toHaveBeenCalled();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configure Checkr' })).not.toBeInTheDocument();
  });
});
