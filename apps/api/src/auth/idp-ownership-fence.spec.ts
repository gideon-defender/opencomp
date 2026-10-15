import type { NextFunction, Request, Response } from 'express';
import {
  BLOCKED_BETTER_AUTH_PATHS,
  IDP_MANAGED_MESSAGE,
  idpMembershipFencesMiddleware,
  isBlockedBetterAuthPath,
} from './idp-ownership-fence';

describe('isBlockedBetterAuthPath', () => {
  it('blocks the eleven legacy membership/role mutations', () => {
    expect(BLOCKED_BETTER_AUTH_PATHS).toHaveLength(11);
    for (const path of BLOCKED_BETTER_AUTH_PATHS) {
      expect(isBlockedBetterAuthPath(path)).toBe(true);
    }
  });

  it('blocks invite-member, role, and leave mutations by name', () => {
    expect(isBlockedBetterAuthPath('/api/auth/organization/create')).toBe(true);
    expect(
      isBlockedBetterAuthPath('/api/auth/organization/invite-member'),
    ).toBe(true);
    expect(
      isBlockedBetterAuthPath('/api/auth/organization/accept-invitation'),
    ).toBe(true);
    expect(isBlockedBetterAuthPath('/api/auth/organization/leave')).toBe(true);
    expect(isBlockedBetterAuthPath('/api/auth/organization/create-role')).toBe(
      true,
    );
    expect(isBlockedBetterAuthPath('/api/auth/organization/delete-role')).toBe(
      true,
    );
  });

  it('tolerates trailing slashes and query strings', () => {
    expect(isBlockedBetterAuthPath('/api/auth/organization/leave/')).toBe(true);
    expect(
      isBlockedBetterAuthPath('/api/auth/organization/remove-member?x=1'),
    ).toBe(true);
  });

  it('preserves reads, org selection, sessions, and MCP routes', () => {
    const allowed = [
      '/api/auth/organization/set-active',
      '/api/auth/organization/get-full-organization',
      '/api/auth/organization/list',
      '/api/auth/organization/list-members',
      '/api/auth/organization/list-invitations',
      '/api/auth/organization/get-invitation',
      '/api/auth/get-session',
      '/api/auth/sign-out',
      '/api/auth/mcp/authorize',
      '/api/auth/.well-known/openid-configuration',
    ];
    for (const path of allowed) {
      expect(isBlockedBetterAuthPath(path)).toBe(false);
    }
  });

  it('does not prefix-match lookalikes', () => {
    expect(
      isBlockedBetterAuthPath('/api/auth/organization/create-role-template'),
    ).toBe(false);
    expect(isBlockedBetterAuthPath('/api/auth/organization')).toBe(false);
  });
});

describe('idpMembershipFencesMiddleware', () => {
  function createMockReq(method: string, path: string): Partial<Request> {
    return { method, path };
  }

  function createMockRes(): Partial<Response> & {
    statusCode?: number;
    body?: unknown;
  } {
    const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
    res.status = jest.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.json = jest.fn().mockImplementation((body: unknown) => {
      res.body = body;
      return res;
    });
    return res;
  }

  function runFence(params: {
    req: Partial<Request>;
    res: Partial<Response>;
    next: NextFunction;
  }): void {
    idpMembershipFencesMiddleware(
      params.req as Request,
      params.res as Response,
      params.next,
    );
  }

  it('returns the Nest Gone body for blocked mutations without touching the DB', () => {
    const req = createMockReq('POST', '/api/auth/organization/invite-member');
    const res = createMockRes();
    const next = jest.fn();

    runFence({ req, res, next });

    expect(res.statusCode).toBe(410);
    expect(res.body).toEqual({
      statusCode: 410,
      message: IDP_MANAGED_MESSAGE,
      error: 'Gone',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes org selection and reads through', () => {
    const req = createMockReq('POST', '/api/auth/organization/set-active');
    const res = createMockRes();
    const next = jest.fn();

    runFence({ req, res, next });

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeUndefined();
  });
});
