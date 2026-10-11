import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { rolesGrantPermissions } from '../../auth/app-access';
import { OAuthReconnectGuard } from './oauth-reconnect.guard';

jest.mock('../../auth/app-access', () => ({
  rolesGrantPermissions: jest.fn(),
}));
const checkPermissions = jest.mocked(rolesGrantPermissions);
const context = ({ connectionId }: { connectionId?: string }) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        organizationId: 'org_1',
        userRoles: ['custom-role'],
        body: { providerSlug: 'azure', connectionId },
      }),
    }),
  }) as unknown as ExecutionContext;

describe('OAuthReconnectGuard', () => {
  beforeEach(() => jest.resetAllMocks());
  it('leaves new authorization to the existing create permission guard', async () => {
    await expect(
      new OAuthReconnectGuard().canActivate(context({})),
    ).resolves.toBe(true);
    expect(checkPermissions).not.toHaveBeenCalled();
  });
  it('requires update permission for targeted reconnects', async () => {
    checkPermissions.mockResolvedValue(false);
    await expect(
      new OAuthReconnectGuard().canActivate(
        context({ connectionId: 'conn_1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(checkPermissions).toHaveBeenCalledWith({
      organizationId: 'org_1',
      roles: ['custom-role'],
      required: { integration: ['update'] },
    });
  });
  it('allows permitted reconnects', async () => {
    checkPermissions.mockResolvedValue(true);
    await expect(
      new OAuthReconnectGuard().canActivate(
        context({ connectionId: 'conn_1' }),
      ),
    ).resolves.toBe(true);
    expect(checkPermissions).toHaveBeenCalled();
  });
});
