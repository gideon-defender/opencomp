import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPayload } = vi.hoisted(() => ({ getPayload: vi.fn() }));
vi.mock('@gideon-defender/trigger-local', () => ({
  auth: { getPayloadFromJWT: getPayload },
}));
import { getValidTriggerAccessToken } from './trigger-access-token';

describe('getValidTriggerAccessToken', () => {
  beforeEach(() => {
    getPayload.mockReset();
  });
  it('lets the provider heal a missing cookie', async () => {
    expect(await getValidTriggerAccessToken()).toBeUndefined();
    expect(getPayload).not.toHaveBeenCalled();
  });
  it('discards an orphaned cookie so the provider can issue a new token', async () => {
    getPayload.mockResolvedValue(null);
    expect(await getValidTriggerAccessToken('public_old')).toBeUndefined();
  });
  it('retains a persisted token', async () => {
    getPayload.mockResolvedValue({ read: { runs: ['run_current'] } });
    expect(await getValidTriggerAccessToken('public_current')).toBe('public_current');
  });
  it('allows recovery after a token lookup failure', async () => {
    getPayload.mockRejectedValue(new Error('database unavailable'));
    expect(await getValidTriggerAccessToken('public_old')).toBeUndefined();
  });
});
