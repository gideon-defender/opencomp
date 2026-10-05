import { GcpImpersonationService } from './gcp-impersonation.service';
import { validateGcpRemediationTrust } from './gcp-remediation-trust.validator';

const SA = 'opencomp-remediator@my-proj-123.iam.gserviceaccount.com';
const logger = { log: jest.fn() };

function serviceWith(
  impl: (
    saEmail: string,
    callerToken: string,
  ) => Promise<{ accessToken: string; expiresInSeconds: number }>,
) {
  const service = new GcpImpersonationService();
  jest
    .spyOn(service, 'mintRemediatorToken')
    .mockImplementation(async ({ saEmail, callerToken }) =>
      impl(saEmail, callerToken),
    );
  return service;
}

describe('validateGcpRemediationTrust', () => {
  it('passes when backend mint succeeds and auditor mint is denied', async () => {
    const service = serviceWith(async (saEmail, callerToken) => {
      if (callerToken === 'backend-token') {
        return { accessToken: 'fix-token', expiresInSeconds: 600 };
      }
      throw new Error('403 PERMISSION_DENIED: auditor cannot impersonate');
    });
    const mint = jest.spyOn(service, 'mintRemediatorToken');
    const result = await validateGcpRemediationTrust({
      saEmails: [SA],
      auditorToken: 'auditor-token',
      impersonationService: service,
      backendCallerToken: 'backend-token',
      logger,
    });
    expect(result).toBeNull();
    // The negative probe must actually run — a validator that skips it
    // would also return null.
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('rejects open trust when the auditor can mint', async () => {
    const service = serviceWith(async () => ({
      accessToken: 'fix-token',
      expiresInSeconds: 600,
    }));
    const result = await validateGcpRemediationTrust({
      saEmails: [SA],
      auditorToken: 'auditor-token',
      impersonationService: service,
      backendCallerToken: 'backend-token',
      logger,
    });
    expect(result).toMatch(/impersonable by the auditor token/);
  });

  it('passes trivially with no bindings', async () => {
    const service = serviceWith(async () => {
      throw new Error('should not be called');
    });
    const result = await validateGcpRemediationTrust({
      saEmails: [],
      auditorToken: 'auditor-token',
      impersonationService: service,
      backendCallerToken: 'backend-token',
      logger,
    });
    expect(result).toBeNull();
  });

  it('rethrows when the auditor token is unauthenticated instead of certifying', async () => {
    // A 401 means the auditor token is expired/revoked — the negative case
    // never ran, so it must not count as proof the trust is closed.
    const service = serviceWith(async (saEmail, callerToken) => {
      if (callerToken === 'backend-token') {
        return { accessToken: 'fix-token', expiresInSeconds: 600 };
      }
      throw new Error(
        `Impersonation failed for ${saEmail} (401): Request had invalid authentication credentials.`,
      );
    });
    await expect(
      validateGcpRemediationTrust({
        saEmails: [SA],
        auditorToken: 'expired-token',
        impersonationService: service,
        backendCallerToken: 'backend-token',
        logger,
      }),
    ).rejects.toThrow('(401)');
  });

  it('rethrows inconclusive probe errors instead of certifying', async () => {
    const service = serviceWith(async (saEmail, callerToken) => {
      if (callerToken === 'backend-token') {
        return { accessToken: 'fix-token', expiresInSeconds: 600 };
      }
      throw new Error('socket hang up');
    });
    await expect(
      validateGcpRemediationTrust({
        saEmails: [SA],
        auditorToken: 'auditor-token',
        impersonationService: service,
        backendCallerToken: 'backend-token',
        logger,
      }),
    ).rejects.toThrow('socket hang up');
  });
});
