import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPeopleDirectory } from './load-people-directory';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-server', () => ({ serverApi: { get } }));

describe('People directory loading', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps tenant roles and the current user visible without a global user role', async () => {
    const member = {
      id: 'mem_owner',
      role: 'admin,owner',
      isActive: true,
      user: { id: 'usr_owner', name: 'Igor', email: 'shmukler@gideondefender.com' },
    };
    get.mockResolvedValue({ status: 200, data: { data: [member], count: 1 } });
    expect(await loadPeopleDirectory('tenant_a')).toEqual([member]);
    expect(get).toHaveBeenCalledWith('/v1/people?includeDeactivated=true', {
      'X-Organization-Id': 'tenant_a',
    });
  });

  it.each([401, 403, 500])(
    'distinguishes HTTP %s failure from an empty directory',
    async (status) => {
      get.mockResolvedValue({ status, error: 'Request failed' });
      expect(await loadPeopleDirectory('tenant_a')).toBeNull();
    },
  );

  it('accepts a genuinely empty successful directory', async () => {
    get.mockResolvedValue({ status: 200, data: { data: [], count: 0 } });
    expect(await loadPeopleDirectory('tenant_a')).toEqual([]);
  });

  it('does not present a malformed API response as an empty directory', async () => {
    get.mockResolvedValue({ status: 200, data: { count: 0 } });
    expect(await loadPeopleDirectory('tenant_a')).toBeNull();
  });
});
