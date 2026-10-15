import { GideonBootstrapController } from './gideon-bootstrap.controller';
import type { AuthenticatedRequest } from './types';
import { recordBootstrapOwner } from './gideon-bootstrap-authorization';

const mockUser = jest.fn();
const mockUserUpdate = jest.fn();
const proofs = new Map<string, unknown>();
jest.mock('@db', () => ({
  normalizeEmail: jest.requireActual('@gideon-defender/email').normalizeEmail,
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockUser(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  },
}));
jest.mock('./auth.server', () => ({ auth: { api: {} } }));
jest.mock('../redis/redis.client', () => ({
  redisClient: {
    set: (key: string, value: unknown) => {
      proofs.set(key, value);
      return Promise.resolve('OK');
    },
    get: (key: string) => Promise.resolve(proofs.get(key) ?? null),
  },
}));

function request(
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  return Object.assign(
    new Request('http://localhost/v1/auth/gideon/bootstrap'),
    {
      organizationId: '',
      authType: 'session' as const,
      isApiKey: false,
      userRoles: null,
      userId: 'usr_1',
      sessionId: 'ses_1',
      ...overrides,
    },
  );
}

describe('organization setup authorization endpoint', () => {
  const controller = new GideonBootstrapController();
  const oldEnv = { ...process.env };
  beforeEach(() => {
    proofs.clear();
    mockUser.mockReset().mockResolvedValue({ tenantId: 'tenant_1' });
    mockUserUpdate.mockReset().mockResolvedValue({ id: 'usr_1' });
    process.env.GIDEON_BOOTSTRAP_ENFORCED = 'true';
  });
  afterEach(() => {
    process.env = { ...oldEnv };
  });

  it('rejects an old browser session after bootstrap enforcement is enabled', async () => {
    await expect(controller.authorize(request())).rejects.toThrow(
      'owner assignment',
    );
  });

  it('returns only the tenant authorized by this owner session', async () => {
    await recordBootstrapOwner({
      sessionId: 'ses_1',
      userId: 'usr_1',
      tenantId: 'tenant_1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(controller.authorize(request())).resolves.toEqual({
      tenantId: 'tenant_1',
    });
    mockUser.mockResolvedValue({ tenantId: 'tenant_2' });
    await expect(controller.authorize(request())).rejects.toThrow(
      'owner assignment',
    );
  });

  it('rejects bearer identities without a browser session and users without a tenant', async () => {
    await expect(
      controller.authorize(request({ sessionId: undefined })),
    ).rejects.toThrow('browser session');
    expect(mockUser).not.toHaveBeenCalled();
    mockUser.mockResolvedValue({ tenantId: null, oidcTenantId: null });
    await expect(controller.authorize(request())).rejects.toThrow(
      'Sign in with Gideon',
    );
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('claims an expand-window null-tenant stamp for setup instead of rejecting', async () => {
    mockUser.mockResolvedValue({
      tenantId: null,
      oidcTenantId: 'tenant_1',
    });
    await recordBootstrapOwner({
      sessionId: 'ses_1',
      userId: 'usr_1',
      tenantId: 'tenant_1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(controller.authorize(request())).resolves.toEqual({
      tenantId: 'tenant_1',
    });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_1' },
      data: { tenantId: 'tenant_1' },
    });
  });

  it('preserves setup for existing sessions while the rollout gate is off', async () => {
    delete process.env.GIDEON_BOOTSTRAP_ENFORCED;
    await expect(controller.authorize(request())).resolves.toEqual({
      tenantId: 'tenant_1',
    });
  });
});
