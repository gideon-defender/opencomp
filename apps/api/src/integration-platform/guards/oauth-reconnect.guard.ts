import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { rolesGrantPermissions } from '../../auth/app-access';
import type { AuthenticatedRequest } from '../../auth/types';
import type { StartOAuthDto } from '../dto/start-oauth.dto';

@Injectable()
export class OAuthReconnectGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      Pick<
        AuthenticatedRequest,
        'organizationId' | 'userRoles' | 'isPlatformAdmin'
      > & {
        body?: StartOAuthDto;
      }
    >();
    if (!request.body?.connectionId || request.isPlatformAdmin) return true;

    const allowed = await rolesGrantPermissions({
      organizationId: request.organizationId,
      roles: request.userRoles ?? [],
      required: { integration: ['update'] },
    });
    if (!allowed)
      throw new ForbiddenException('Reconnecting requires integration:update');
    return true;
  }
}
