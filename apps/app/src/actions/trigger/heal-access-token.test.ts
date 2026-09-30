import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ retrieve: vi.fn(), createToken: vi.fn(), set: vi.fn() }));
vi.mock('@gideon-defender/trigger-local', () => ({
  runs: { retrieve: mocks.retrieve },
  auth: { createPublicToken: mocks.createToken },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.set }) }));
import { healAndSetAccessToken } from './heal-access-token';

describe('tracking token recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retrieve.mockResolvedValue({ id: 'run_current' });
    mocks.createToken.mockResolvedValue('public_new');
  });
  it('loads persisted run state before issuing and saving a replacement token', async () => {
    mocks.createToken.mockImplementation(async () => {
      expect(mocks.retrieve).toHaveBeenCalledWith('run_current');
      return 'public_new';
    });
    expect(await healAndSetAccessToken('run_current')).toBe('public_new');
    expect(mocks.createToken).toHaveBeenCalledWith({ scopes: { read: { runs: ['run_current'] } } });
    expect(mocks.set).toHaveBeenCalledWith('publicAccessToken', 'public_new');
  });
  it('does not issue a token for a missing run', async () => {
    mocks.retrieve.mockRejectedValue(new Error('Run not found'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await healAndSetAccessToken('run_missing')).toBeNull();
    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
