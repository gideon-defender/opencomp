import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StartBackgroundCheckDialog } from './StartBackgroundCheckDialog';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get, post } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderDialog({ canStart = true, open = true } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <StartBackgroundCheckDialog
        open={open}
        onOpenChange={vi.fn()}
        organizationId="tenant-a"
        canStart={canStart}
      />
    </SWRConfig>,
  );
}
async function fillCandidate() {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText('First name')).toBeEnabled());
  await user.type(screen.getByLabelText('First name'), 'Ada');
  await user.type(screen.getByLabelText('Last name'), 'Lovelace');
  await user.type(screen.getByLabelText('Email'), 'a@b.com');
  await user.type(screen.getByLabelText('Work state (required for US)'), 'CA');
  return user;
}

describe('StartBackgroundCheckDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: { ready: true }, status: 200 });
    post.mockResolvedValue({ data: { runId: 'screening-a', status: 'queued' }, status: 202 });
  });

  it('removes role selection, CSV invitation upload, and portal invitation controls', async () => {
    renderDialog();
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/v1/people/candidate-screenings/readiness', 'tenant-a'),
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Send portal invite email')).not.toBeInTheDocument();
    expect(screen.queryByText('CSV')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('queues only screening input under the selected tenant', async () => {
    renderDialog();
    const user = await fillCandidate();
    await user.click(screen.getByRole('button', { name: 'Start background check' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      '/v1/people/candidate-screenings',
      {
        email: 'a@b.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        country: 'US',
        state: 'CA',
        city: undefined,
        operationId: expect.any(String),
      },
      'tenant-a',
    );
  });

  it('reuses the operation ID after an unconfirmed submission', async () => {
    post.mockResolvedValue({ error: 'Network unavailable', status: 503 });
    renderDialog();
    const user = await fillCandidate();
    await user.click(screen.getByRole('button', { name: 'Start background check' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start background check' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Start background check' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0][1].operationId).toBe(post.mock.calls[1][1].operationId);
  });

  it('blocks a read-only user without calling the API', () => {
    renderDialog({ canStart: false });
    expect(screen.getByRole('button', { name: 'Start background check' })).toBeDisabled();
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('blocks intake when tenant configuration is unavailable', async () => {
    get.mockResolvedValue({
      data: { ready: false, message: 'Configure this tenant’s Checkr account.' },
      status: 200,
    });
    renderDialog();
    await screen.findByText('Configure this tenant’s Checkr account.');
    expect(screen.getByRole('button', { name: 'Start background check' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});
