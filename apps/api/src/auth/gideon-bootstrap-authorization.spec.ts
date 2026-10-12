import {
  authorizeBootstrapSession,
  recordBootstrapOwner,
} from './gideon-bootstrap-authorization';

const proofs = new Map<string, unknown>();
jest.mock('../redis/redis.client', () => ({
  redisClient: {
    set: (key: string, value: unknown) => {
      proofs.set(key, value);
      return Promise.resolve('OK');
    },
    get: (key: string) => Promise.resolve(proofs.get(key) ?? null),
  },
}));
jest.mock('@db', () => ({ db: {} }));

describe('session-bound setup owner authorization', () => {
  const oldEnv = { ...process.env };
  const identity = {
    sessionId: 'ses_1',
    userId: 'usr_1',
    tenantId: 'tenant_1',
  };
  beforeEach(() => {
    proofs.clear();
    process.env.GIDEON_BOOTSTRAP_ENFORCED = 'true';
  });
  afterEach(() => {
    process.env = { ...oldEnv };
  });

  it('denies a setup session issued before bootstrap enforcement', async () => {
    delete process.env.GIDEON_BOOTSTRAP_ENFORCED;
    await authorizeBootstrapSession(identity);
    process.env.GIDEON_BOOTSTRAP_ENFORCED = 'true';
    await expect(authorizeBootstrapSession(identity)).rejects.toThrow(
      'owner assignment',
    );
  });

  it('accepts only the user, tenant and session from the verified owner login', async () => {
    await recordBootstrapOwner({
      ...identity,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(authorizeBootstrapSession(identity)).resolves.toBeUndefined();
    for (const mismatch of [
      { userId: 'usr_2' },
      { tenantId: 'tenant_2' },
      { sessionId: 'ses_2' },
    ]) {
      await expect(
        authorizeBootstrapSession({ ...identity, ...mismatch }),
      ).rejects.toThrow('owner assignment');
    }
  });

  it('rejects malformed or expired owner proof', async () => {
    proofs.set('app:gideon-bootstrap:ses_1', { userId: 'usr_1' });
    await expect(authorizeBootstrapSession(identity)).rejects.toThrow(
      'owner assignment',
    );
    proofs.clear();
    await expect(authorizeBootstrapSession(identity)).rejects.toThrow(
      'owner assignment',
    );
  });
});
