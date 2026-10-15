const mockResolveHrIdentity = jest.fn();
const mockGetHrSyncUser = jest.fn();
jest.mock('../services/hr-sync-idp', () => ({
  createHrIdentityResolver: () => mockResolveHrIdentity,
  getHrSyncUser: (...args: unknown[]) => mockGetHrSyncUser(...args),
}));

import { db } from '@db';
import { createHrSyncControllerFixture } from './sync-hr-identity.test-fixtures';

jest.mock('@db', () => ({
  db: {
    integrationProvider: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), create: jest.fn() },
    member: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('@gideon-defender/auth', () => ({
  statement: { integration: ['create', 'read', 'update', 'delete'] },
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

jest.mock('@gideon-defender/integration-platform', () => {
  const actual = jest.requireActual<
    typeof import('@gideon-defender/integration-platform')
  >('@gideon-defender/integration-platform');
  return {
    ...actual,
    getManifest: jest.fn().mockReturnValue({
      auth: { type: 'oauth2', config: { tokenUrl: '', refreshUrl: '' } },
    }),
    TASK_TEMPLATE_INFO: {},
  };
});

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockedDb = db as jest.Mocked<typeof db>;

describe('Provider offboarding error isolation', () => {
  const email = 'employee@example.com';
  let fixture: Awaited<ReturnType<typeof createHrSyncControllerFixture>>;
  beforeEach(async () => {
    fixture = await createHrSyncControllerFixture({ mockFetch });
    jest.clearAllMocks();
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { provider: 'google-workspace', excluded: false },
    { provider: 'google-workspace', excluded: true },
    { provider: 'rippling', excluded: false },
    { provider: 'jumpcloud', excluded: false },
  ])(
    'continues offboarding after an IdP failure: %p',
    async ({ provider, excluded }) => {
      fixture.setupProvider({ provider, inactive: true, excluded });
      (mockedDb.member.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'member_failed',
          role: 'employee',
          user: { email, oidcSub: null },
        },
        {
          id: 'member_linked',
          role: 'employee',
          user: { email: 'linked@example.com', oidcSub: 'idp_linked' },
        },
      ]);
      mockResolveHrIdentity
        .mockRejectedValueOnce(new Error('IdP unavailable'))
        .mockResolvedValueOnce({
          id: 'idp_linked',
          email: 'linked@example.com',
        });
      const result = await fixture.runSync(provider);
      expect(result.success).toBe(false);
      expect(result.errors).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.deactivated).toBe(1);
      expect(result.details).toContainEqual({
        email,
        status: 'error',
        reason: 'IdP unavailable',
      });
      expect(mockedDb.member.update).toHaveBeenCalledTimes(1);
      expect(mockedDb.member.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'member_linked' } }),
      );
    },
  );
  it('reads Rippling offboarding members after applying an email rename', async () => {
    fixture.setupProvider({ provider: 'rippling' });
    let currentEmail = 'old@example.com';
    (mockedDb.member.findMany as jest.Mock).mockImplementation(async () => [
      {
        id: 'member_existing',
        role: 'employee',
        user: { email: currentEmail, oidcSub: 'idp_existing' },
      },
    ]);
    (mockedDb.member.findFirst as jest.Mock).mockResolvedValue({
      id: 'member_existing',
      deactivated: false,
      onboardDate: new Date('2026-10-01'),
    });
    mockResolveHrIdentity.mockImplementation(
      async ({ email: requestedEmail }: { email: string }) => {
        if (requestedEmail !== email) throw new Error('Stale email lookup');
        return { id: 'idp_existing', email };
      },
    );
    mockGetHrSyncUser.mockImplementation(async () => {
      currentEmail = email;
      return { id: 'user_existing', email, oidcSub: 'idp_existing' };
    });
    const result = await fixture.runSync('rippling');
    expect(result.success).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.deactivated).toBe(0);
    expect(mockResolveHrIdentity).toHaveBeenCalledTimes(1);
    expect(mockedDb.member.create).not.toHaveBeenCalled();
    expect(mockedDb.member.update).not.toHaveBeenCalled();
  });
});
