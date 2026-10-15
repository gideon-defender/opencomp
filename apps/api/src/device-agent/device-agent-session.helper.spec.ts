import {
  createDeviceAgentSession,
  DEVICE_AGENT_SESSION_TTL_MS,
} from './device-agent-session.helper';

const sessionCreateMock = jest.fn();
const resolveActiveOrgMock = jest.fn();

jest.mock('@db', () => ({
  db: {
    session: {
      create: (...args: unknown[]) => sessionCreateMock(...args),
    },
  },
}));

jest.mock('../auth/oidc-provisioning', () => ({
  resolveActiveOrganizationId: (...args: unknown[]) =>
    resolveActiveOrgMock(...args),
}));

const FIXED_NOW = new Date('2026-04-22T00:00:00.000Z');

describe('createDeviceAgentSession', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
    sessionCreateMock.mockReset();
    resolveActiveOrgMock.mockReset();
    resolveActiveOrgMock.mockResolvedValue('org_1');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes a Session row directly with deviceAgent=true and 1-year expiry', async () => {
    sessionCreateMock.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'ses_123',
        ...data,
      }),
    );

    const result = await createDeviceAgentSession({ userId: 'usr_1' });

    expect(resolveActiveOrgMock).toHaveBeenCalledWith({ userId: 'usr_1' });
    expect(sessionCreateMock).toHaveBeenCalledTimes(1);
    const { data } = sessionCreateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.userId).toBe('usr_1');
    expect(data.deviceAgent).toBe(true);
    expect(data.activeOrganizationId).toBe('org_1');
    expect(data.expiresAt).toEqual(
      new Date(FIXED_NOW.getTime() + DEVICE_AGENT_SESSION_TTL_MS),
    );
    expect(typeof data.token).toBe('string');
    expect(data.token as string).toHaveLength(64); // 32 bytes hex
    expect(result).toEqual({
      sessionId: 'ses_123',
      token: data.token,
      expiresAt: new Date(FIXED_NOW.getTime() + DEVICE_AGENT_SESSION_TTL_MS),
    });
  });
});
