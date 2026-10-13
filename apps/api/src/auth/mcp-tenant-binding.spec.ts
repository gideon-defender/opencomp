import { ForbiddenException } from '@nestjs/common';
import { GideonJwtService } from './gideon-jwt.service';
import { HybridSessionAuth } from './hybrid-session-auth';
import type { AuthenticatedRequest } from './types';

const mockUser = jest.fn();
const mockMembers = jest.fn();
const mockBinding = jest.fn();
jest.mock('./auth.server', () => ({
  auth: { api: { getMcpSession: async () => ({ userId: 'usr_shared' }) } },
}));
jest.mock('@db', () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => mockUser(...args) },
    member: { findMany: (...args: unknown[]) => mockMembers(...args) },
    mcpOrgBinding: { findUnique: (...args: unknown[]) => mockBinding(...args) },
  },
}));
jest.mock('./app-access', () => ({ hasAppAccess: async () => true }));

function request(): AuthenticatedRequest {
  return {
    headers: { authorization: 'Bearer old-mcp-token' },
  } as unknown as AuthenticatedRequest;
}
describe('MCP tenant binding after a shared-user split', () => {
  const auth = new HybridSessionAuth({});
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockResolvedValue({
      id: 'usr_shared',
      email: 'shared@example.com',
    });
    mockMembers.mockResolvedValue([
      {
        id: 'mem_primary',
        organizationId: 'primary',
        role: 'admin',
        department: 'none',
      },
    ]);
    mockBinding.mockResolvedValue({ organizationId: 'secondary' });
  });
  it('rejects a token whose saved tenant no longer belongs to the original user', async () => {
    await expect(auth.handleSessionAuth(request())).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('also rejects a Gideon token after its secondary membership moves to the clone', async () => {
    const jwt = new GideonJwtService();
    jest.spyOn(jwt, 'isConfigured').mockReturnValue(true);
    jest.spyOn(jwt, 'verify').mockResolvedValue({
      payload: { sub: 'sub_shared', tid: 'secondary' },
      protectedHeader: {},
    });
    const gideonAuth = new HybridSessionAuth({ gideonJwtService: jwt });
    const req = {
      headers: { authorization: 'Bearer one.two.three' },
    } as unknown as AuthenticatedRequest;
    await expect(gideonAuth.handleSessionAuth(req)).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('retains access when the saved tenant still matches the sole membership', async () => {
    mockBinding.mockResolvedValue({ organizationId: 'primary' });
    const req = request();
    await expect(auth.handleSessionAuth(req)).resolves.toBe(true);
    expect(req.organizationId).toBe('primary');
  });
  it('accepts a user with one membership and no previous tenant selection', async () => {
    mockBinding.mockResolvedValue(null);
    const req = request();
    await expect(auth.handleSessionAuth(req)).resolves.toBe(true);
    expect(req.organizationId).toBe('primary');
  });
});
