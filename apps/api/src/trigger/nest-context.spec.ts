import { HttpException, HttpStatus } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { db } from '@db';
import { ActingUserResolver } from '../auth/acting-user.service';
import {
  createServiceTriggerRequest,
  getTriggerService,
  isTriggerNestContextReady,
  logTriggerAuditEntry,
  setTriggerNestContext,
  TRIGGER_SERVICE_NAME,
  triggerHttpErrorMessage,
  triggerHttpErrorStatus,
} from './nest-context';

jest.mock('@db', () => {
  const actual = jest.requireActual('@db');
  return {
    db: {
      auditLog: { create: jest.fn() },
    },
    AuditLogEntityType: actual.AuditLogEntityType,
    CommentEntityType: actual.CommentEntityType,
  };
});

const auditCreateMock = db.auditLog.create as jest.Mock;

describe('trigger nest context', () => {
  // NOTE: the module holds process-wide singleton state with no reset API,
  // so the "not initialized" test must run before anything sets the context.
  it('throws when the context is not initialized', () => {
    expect(isTriggerNestContextReady()).toBe(false);
    expect(() => getTriggerService(ActingUserResolver)).toThrow(
      'Trigger Nest context is not initialized',
    );
  });

  describe('setTriggerNestContext / getTriggerService', () => {
    it('resolves services from the app set at bootstrap', () => {
      const service = { scan: jest.fn() };
      const app = {
        get: jest.fn().mockReturnValue(service),
      } as unknown as INestApplication;

      setTriggerNestContext(app);

      expect(isTriggerNestContextReady()).toBe(true);
      expect(getTriggerService(Object)).toBe(service);
      expect(app.get).toHaveBeenCalledWith(Object, { strict: false });
    });
  });
});

describe('triggerHttpErrorMessage', () => {
  it('returns string exception responses verbatim', () => {
    expect(
      triggerHttpErrorMessage(
        new HttpException('Connection not found', HttpStatus.NOT_FOUND),
      ),
    ).toBe('Connection not found');
  });

  it('returns object exception messages', () => {
    expect(
      triggerHttpErrorMessage(
        new HttpException(
          { message: 'Token refresh failed' },
          HttpStatus.UNAUTHORIZED,
        ),
      ),
    ).toBe('Token refresh failed');
  });

  it('joins array exception messages', () => {
    expect(
      triggerHttpErrorMessage(
        new HttpException(
          { message: ['name is required', 'email is invalid'] },
          HttpStatus.BAD_REQUEST,
        ),
      ),
    ).toBe('name is required; email is invalid');
  });

  it('falls back to the error message for plain errors', () => {
    expect(triggerHttpErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-error values', () => {
    expect(triggerHttpErrorMessage('plain failure')).toBe('plain failure');
  });
});

describe('triggerHttpErrorStatus', () => {
  it('returns the exception status', () => {
    expect(
      triggerHttpErrorStatus(
        new HttpException('missing', HttpStatus.NOT_FOUND),
      ),
    ).toBe(404);
  });

  it('returns 500 for non-HTTP errors', () => {
    expect(triggerHttpErrorStatus(new Error('boom'))).toBe(500);
  });
});

describe('createServiceTriggerRequest', () => {
  it('builds the service-token request shape guards used to set', () => {
    const request = createServiceTriggerRequest({
      organizationId: 'org_1',
      serviceName: TRIGGER_SERVICE_NAME,
    });

    expect(request).toMatchObject({
      organizationId: 'org_1',
      authType: 'service',
      isApiKey: false,
      isServiceToken: true,
      serviceName: 'Local trigger Workers',
      isPlatformAdmin: false,
      userRoles: null,
    });
  });
});

describe('logTriggerAuditEntry', () => {
  const resolver = { resolve: jest.fn() };
  const app = {
    get: jest.fn().mockReturnValue(resolver),
  } as unknown as INestApplication;

  beforeEach(() => {
    setTriggerNestContext(app);
    resolver.resolve.mockReset();
    resolver.resolve.mockResolvedValue({
      userId: 'user_1',
      memberId: 'member_1',
      callerLabel: 'via service "Local trigger Workers"',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('writes the row the interceptor would have written', async () => {
    await logTriggerAuditEntry({
      organizationId: 'org_1',
      resource: 'integration',
      method: 'POST',
      path: '/v1/cloud-security/scan/conn_1',
    });

    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        isServiceToken: true,
        serviceName: 'Local trigger Workers',
      }),
      'org_1',
    );
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: {
        organizationId: 'org_1',
        userId: 'user_1',
        memberId: 'member_1',
        entityType: 'integration',
        entityId: null,
        description:
          'Created integration [via service "Local trigger Workers"]',
        data: {
          action: 'Created integration',
          method: 'POST',
          path: '/v1/cloud-security/scan/conn_1',
          resource: 'integration',
          permission: 'create',
          via: 'via service "Local trigger Workers"',
        },
      },
    });
  });

  it('skips orgs with no attributable user', async () => {
    resolver.resolve.mockResolvedValue({
      userId: null,
      source: 'org-owner-fallback',
      callerLabel: 'via service "Local trigger Workers"',
    });

    await logTriggerAuditEntry({
      organizationId: 'org_1',
      resource: 'integration',
      method: 'POST',
      path: '/v1/cloud-security/scan/conn_1',
    });

    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it('never throws when actor resolution fails', async () => {
    resolver.resolve.mockRejectedValue(new Error('db down'));

    await expect(
      logTriggerAuditEntry({
        organizationId: 'org_1',
        resource: 'integration',
        method: 'POST',
        path: '/v1/cloud-security/scan/conn_1',
      }),
    ).resolves.toBeUndefined();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it('never throws when the audit write fails', async () => {
    auditCreateMock.mockRejectedValueOnce(new Error('db down'));

    await expect(
      logTriggerAuditEntry({
        organizationId: 'org_1',
        resource: 'integration',
        method: 'POST',
        path: '/v1/cloud-security/scan/conn_1',
      }),
    ).resolves.toBeUndefined();
  });
});
