import { HybridSessionAuth } from './hybrid-session-auth';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { db } from '@db';
import { ApiKeyService } from './api-key.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SKIP_ORG_CHECK_KEY } from './skip-org-check.decorator';
import { resolveServiceByToken } from './service-token.config';
import { stripControlChars } from './app-access';
import { tryOidcJwtAuth } from './gideon-jwt-request-auth';
import { AuthenticatedRequest } from './types';
import { OidcJwtService } from './oidc-jwt.service';
import { GideonShadowService } from '../gideon/gideon-shadow.service';
import { NativeSessionService } from './native-session.service';

@Injectable()
export class HybridAuthGuard implements CanActivate {
  private readonly logger = new Logger(HybridAuthGuard.name);

  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly reflector: Reflector,
    @Optional() private readonly gideonJwtService?: OidcJwtService,
    @Optional() private readonly gideonShadowService?: GideonShadowService,
    // Keep the runtime injection token when the dependency is optional.
    @Optional()
    @Inject(NativeSessionService)
    private readonly nativeSessionService?: NativeSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const apiKey = request.headers['x-api-key'] as string;
    if (apiKey) {
      return this.handleApiKeyAuth(request, apiKey);
    }

    // Try Service Token authentication (for internal services)
    const serviceToken = request.headers['x-service-token'] as string;
    if (serviceToken) {
      return this.handleServiceTokenAuth(request, serviceToken);
    }

    // Phase 0 — Gideon JWT shadow/verify (x-api-key → x-service-token → Gideon JWT → cookie)
    // Behind flag: when GIDEON_JWT_ENABLED=false and no identityUrl, this returns null and falls through
    const gideonResult = await tryOidcJwtAuth({
      request,
      gideonJwtService: this.gideonJwtService,
      gideonShadowService: this.gideonShadowService,
      logger: this.logger,
    });
    if (gideonResult === true) return true;
    if (gideonResult === 'enforce_failed') {
      throw new UnauthorizedException('Invalid Gideon JWT');
    }

    // Try session-based authentication (bearer token or cookies)
    const skipOrgCheck = this.reflector.getAllAndOverride<boolean>(
      SKIP_ORG_CHECK_KEY,
      [context.getHandler(), context.getClass()],
    );
    return new HybridSessionAuth({
      nativeSessionService: this.nativeSessionService,
      gideonJwtService: this.gideonJwtService,
    }).handleSessionAuth(request, skipOrgCheck);
  }

  private async handleApiKeyAuth(
    request: AuthenticatedRequest,
    apiKey: string,
  ): Promise<boolean> {
    const extractedKey = this.apiKeyService.extractApiKey(apiKey);
    if (!extractedKey) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const result = await this.apiKeyService.validateApiKey(extractedKey);
    if (!result) {
      throw new UnauthorizedException('Invalid or expired API key');
    }

    // Set request context for API key auth
    request.organizationId = result.organizationId;
    request.authType = 'api-key';
    request.isApiKey = true;
    request.isServiceToken = false;
    request.apiKeyScopes = result.scopes;
    // Surface the key's id + name on the request so downstream attribution
    // (ActingUserResolver, audit logs) can record "via API key '<name>'"
    // without an extra DB lookup.
    request.apiKeyId = result.apiKeyId;
    request.apiKeyName = result.apiKeyName;
    // The member who created the key (if recorded). Lets ActingUserResolver
    // attribute mutations to the real creator instead of the org owner.
    request.apiKeyCreatedByMemberId = result.createdByMemberId;
    // API keys are organization-scoped; no session user/member is attached here.
    request.userRoles = null;

    return true;
  }

  private async handleServiceTokenAuth(
    request: AuthenticatedRequest,
    token: string,
  ): Promise<boolean> {
    const service = resolveServiceByToken(token);
    if (!service) {
      throw new UnauthorizedException('Invalid service token');
    }

    const organizationId = request.headers['x-organization-id'] as string;
    if (!organizationId) {
      throw new UnauthorizedException(
        'x-organization-id header is required for service token auth',
      );
    }

    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) {
      throw new UnauthorizedException(
        'Organization not found for the provided x-organization-id',
      );
    }

    request.organizationId = organizationId;
    request.authType = 'service';
    request.isApiKey = false;
    request.isServiceToken = true;
    request.serviceName = service.definition.name;
    request.userRoles = null;

    // Service tokens can pass x-user-id to act on behalf of a user
    // Validate that the user exists and belongs to the organization
    const actingUserId = request.headers['x-user-id'] as string;
    if (actingUserId) {
      const member = await db.member.findFirst({
        // Only active memberships may act — an offboarded/deactivated user must
        // not receive new audit / enteredById attribution. Mirrors the filters
        // ActingUserResolver applies to its creator/owner lookups.
        where: {
          userId: actingUserId,
          organizationId,
          deactivated: false,
          idpAccessRevoked: false,
          isActive: true,
        },
        select: { id: true, userId: true },
      });
      if (member) {
        request.userId = actingUserId;
        // Set the acting membership too, so Member-FK sinks (audit rows,
        // enteredById, etc.) can attribute to the acting member and not just
        // the user.
        request.memberId = member.id;
      } else {
        this.logger.warn(
          `Service token x-user-id "${stripControlChars(actingUserId)}" is not an active member of org ${stripControlChars(organizationId)}`,
        );
      }
    }

    this.logger.log(
      `Service "${service.definition.name}" authenticated for org ${stripControlChars(organizationId)}`,
    );

    return true;
  }
}
