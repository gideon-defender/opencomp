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

import { Logger } from '@nestjs/common';
import { HR_SYNC_IDENTITY_SKIP_REASON } from '../services/hr-sync-identity';

describe('Provider employee sync IdP identity gate', () => {
  const email = 'employee@example.com';
  const orgId = 'org_test123';
  let fixture: Awaited<ReturnType<typeof createHrSyncControllerFixture>>;
  beforeEach(async () => {
    fixture = await createHrSyncControllerFixture({ mockFetch });
    jest.clearAllMocks();
    mockResolveHrIdentity.mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());
  describe.each(['google-workspace', 'rippling', 'jumpcloud'])(
    '%s',
    (provider) => {
      it.each([
        null,
        { id: 'user_1', oidcSub: null },
        { id: 'user_1', oidcSub: ' ' },
      ])(
        'skips import and reactivation for an absent IdP identity %p',
        async (user) => {
          fixture.setupProvider({ provider });
          (mockedDb.user.findUnique as jest.Mock).mockResolvedValue(user);
          const log = jest
            .spyOn(Logger.prototype, 'log')
            .mockImplementation(() => undefined);
          const result = await fixture.runSync(provider);
          expect(result.skipped).toBe(1);
          expect(result.details).toContainEqual({
            email,
            status: 'skipped',
            reason: HR_SYNC_IDENTITY_SKIP_REASON,
          });
          expect(log).toHaveBeenCalledWith(
            expect.objectContaining({
              reason: 'missing_idp_identity',
              provider,
              organizationId: orgId,
              email,
            }),
          );
          expect(mockedDb.user.create).not.toHaveBeenCalled();
          expect(mockedDb.member.findFirst).not.toHaveBeenCalled();
          expect(mockedDb.member.create).not.toHaveBeenCalled();
          expect(mockedDb.member.update).not.toHaveBeenCalled();
        },
      );

      it('skips offboarding an member absent from the IdP', async () => {
        fixture.setupProvider({ provider, inactive: true });
        (mockedDb.member.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'member_1',
            role: 'employee',
            user: { email, oidcSub: null },
          },
        ]);
        const result = await fixture.runSync(provider);
        expect(result.skipped).toBe(1);
        expect(result.deactivated).toBe(0);
        expect(mockedDb.member.update).not.toHaveBeenCalled();
      });

      it('continues importing an IdP-linked employee', async () => {
        mockResolveHrIdentity.mockResolvedValue({ id: 'idp_1', email });
        mockGetHrSyncUser.mockResolvedValue({
          id: 'user_1',
          oidcSub: 'idp_1',
        });
        fixture.setupProvider({ provider });
        (mockedDb.user.findUnique as jest.Mock).mockResolvedValue({
          id: 'user_1',
          oidcSub: 'idp_1',
        });
        const result = await fixture.runSync(provider);
        expect(result.imported).toBe(1);
        expect(mockedDb.user.create).not.toHaveBeenCalled();
        expect(mockedDb.member.create).toHaveBeenCalled();
      });
    },
  );

  it('skips excluded, Google Workspace members absent from the IdP', async () => {
    fixture.setupProvider({ provider: 'google-workspace', excluded: true });
    (mockedDb.member.findMany as jest.Mock).mockResolvedValue([
      { id: 'member_1', role: 'employee', user: { email, oidcSub: null } },
    ]);
    const result = await fixture.runSync('google-workspace');
    expect(result.skipped).toBe(1);
    expect(mockedDb.member.update).not.toHaveBeenCalled();
  });
});
