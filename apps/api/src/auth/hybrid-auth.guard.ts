import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { db } from '@db';
import { ApiKeyService } from './api-key.service';
import { hasAppAccess } from './app-access';
import { auth } from './auth.server';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SKIP_ORG_CHECK_KEY } from './skip-org-check.decorator';
import { resolveServiceByToken } from './service-token.config';
import { AuthenticatedRequest } from './types';
import { GideonJwtService } from './gideon-jwt.service';
import { GideonShadowService } from '../gideon/gideon-shadow.service';
import {
  NativeSessionService,
  type NativeSessionResult,
} from './native-session.service';

@Injectable()
export class HybridAuthGuard implements CanActivate {
  private readonly logger = new Logger(HybridAuthGuard.name);

  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly reflector: Reflector,
    @Optional() private readonly gideonJwtService?: GideonJwtService,
    @Optional() private readonly gideonShadowService?: GideonShadowService,
    // @Inject keeps the runtime token reference — without it the import is
    // only used in type positions and TS elides it, leaving Nest an
    // undefined token (silently masked by @Optional, disabling native auth).
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

    // Try API Key authentication first (for external customers)
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
    const gideonResult = await this.tryGideonJwtAuth(request);
    if (gideonResult === true) return true;
    if (gideonResult === 'enforce_failed') {
      throw new UnauthorizedException('Invalid Gideon JWT');
    }

    // Try session-based authentication (bearer token or cookies)
    const skipOrgCheck = this.reflector.getAllAndOverride<boolean>(
      SKIP_ORG_CHECK_KEY,
      [context.getHandler(), context.getClass()],
    );
    return this.handleSessionAuth(request, skipOrgCheck);
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
          `Service token x-user-id "${actingUserId}" is not an active member of org ${organizationId}`,
        );
      }
    }

    this.logger.log(
      `Service "${service.definition.name}" authenticated for org ${organizationId}`,
    );

    return true;
  }

  /**
   * Phase 0 — Gideon JWT shadow/verify.
   * Tries `Authorization: Bearer <gideon_jwt>` via `GideonJwtService`.
   * - In shadow mode (`GIDEON_JWT_SHADOW_ENABLED` or auto-shadow when configured), failures fall through to session.
   * - In enforce mode (`GIDEON_JWT_ENABLED=true`), failures throw 401 — but
   *   only for tokens that present as Gideon JWTs (JWT-shaped, matching iss).
   *   Opaque bearer tokens (better-auth sessions, legacy MCP tokens) always
   *   fall through to session auth so dual-run clients keep working.
   * - On success, populates `request` (organizationId=user's tenant, userId=sub) and logs shadow mismatch for
   *   `GET /v1/platform/tenants/:id/operations` via `GideonShadowService`.
   */
  private async tryGideonJwtAuth(
    request: AuthenticatedRequest,
  ): Promise<true | 'enforce_failed' | null> {
    if (!this.gideonJwtService || !this.gideonJwtService.isConfigured()) {
      return null;
    }

    const authHeader = request.headers['authorization'] as string | undefined;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    const result = await this.gideonJwtService.verify(token);
    if (!result) {
      // Enforce only tokens that present as Gideon JWTs. Anything else
      // (opaque session/MCP bearer tokens, foreign JWTs) falls through to
      // session auth in every mode — dual-run fallback.
      if (
        this.gideonJwtService.isEnforceMode() &&
        this.gideonJwtService.isGideonToken(token)
      ) {
        this.logger.warn('[Gideon] JWT verify failed in enforce mode');
        return 'enforce_failed';
      }
      this.logger.debug(
        '[GideonShadow] JWT verify failed, falling through to session',
      );
      return null;
    }

    const tenantId = this.gideonJwtService.resolveTenantId(result.payload);
    const gideonSub = this.gideonJwtService.resolveUserId(result.payload);
    if (!tenantId || !gideonSub) {
      this.logger.warn('[Gideon] JWT missing tenant or sub');
      if (this.gideonJwtService.isEnforceMode()) return 'enforce_failed';
      return null;
    }

    // Milestone 2 — the Gideon `sub` is not the OpenComp user id (the link
    // lives on `User.gideonSub`, set by OIDC JIT provisioning). Resolve the
    // linked OpenComp user before the membership check: an unlinked sub
    // holds no memberships, so it falls through to session in shadow mode
    // and 401s in enforce mode — same as an unknown tenant/member.
    const linkedUser = await db.user.findUnique({
      where: { gideonSub },
      select: { id: true, email: true },
    });
    if (!linkedUser) {
      this.logger.warn(`[Gideon] sub not linked to an OpenComp user`);
      if (this.gideonJwtService.isEnforceMode()) return 'enforce_failed';
      return null;
    }
    const userId = linkedUser.id;

    // Verify org exists and user is member (same check as session).
    // Tenant is the org: the token's tid IS the organization id. Unknown
    // tenants and non-members 401 in enforce mode (and fall through in
    // shadow) — no org without a tid.
    const org = await db.organization.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!org) {
      this.logger.warn(
        `[GideonShadow] unknown Gideon tenant ${tenantId} (no such organization)`,
      );
      if (this.gideonJwtService.isEnforceMode()) return 'enforce_failed';
      return null;
    }

    const member = await db.member.findFirst({
      where: { userId, organizationId: org.id, deactivated: false },
      select: { id: true, role: true, department: true },
    });
    if (!member) {
      this.logger.warn(
        `[GideonShadow] user ${userId} not member of tenant ${tenantId}`,
      );
      if (this.gideonJwtService.isEnforceMode()) return 'enforce_failed';
      return null;
    }

    request.organizationId = org.id;
    request.userId = userId;
    request.userEmail = result.payload.email ?? linkedUser.email;
    request.userRoles = member.role ? member.role.split(',') : null;
    request.memberId = member.id;
    request.memberDepartment = member.department;
    request.authType = 'gideon';
    request.isApiKey = false;
    request.isServiceToken = false;
    request.isGideonJwt = true;
    // Surface the assurance level for downstream enforcement (native admin
    // endpoints require aal >= 2 for Gideon-JWT callers). Absent → unknown,
    // enforced as missing by the consumer.
    const aalRaw = result.payload.aal;
    const aal = typeof aalRaw === 'string' ? parseInt(aalRaw, 10) : aalRaw;
    if (typeof aal === 'number' && Number.isFinite(aal)) {
      request.gideonAal = aal;
    }

    if (this.gideonShadowService) {
      // Fire-and-forget shadow comparison for operations
      this.gideonShadowService
        .logTenantOperationsMismatch(tenantId, token)
        .catch(() => {});
    }

    this.logger.log(
      `[Gideon] JWT authenticated user ${userId} tenant ${tenantId} shadow=${this.gideonJwtService.isShadowMode()}`,
    );
    return true;
  }

  private async handleSessionAuth(
    request: AuthenticatedRequest,
    skipOrgCheck = false,
  ): Promise<boolean> {
    try {
      const authHeader = request.headers['authorization'] as string;
      const cookieHeader = request.headers['cookie'] as string;

      if (!authHeader && !cookieHeader) {
        throw new UnauthorizedException(
          'Authentication required: Provide either X-API-Key, Bearer token, or session cookie',
        );
      }

      // Sessions resolve natively (direct Session-row lookup). Gideon OIDC
      // and legacy logins both mint plain Session rows, so every cookie or
      // bearer session token resolves here with no better-auth involved.
      if (this.nativeSessionService) {
        const native = await this.nativeSessionService.resolveFromHeaders({
          cookieHeader,
          authHeader,
        });
        if (native) {
          await this.populateSessionRequest(request, native, skipOrgCheck);
          return true;
        }
      }

      // Fallback: the hosted MCP server (Gram) sends an OAuth access token
      // as a Bearer token, which is not a session token. Try the MCP OAuth
      // path before rejecting the request.
      // Forwards both Authorization (bearer session token) and Cookie headers
      const headers = new Headers();
      if (authHeader) {
        headers.set('authorization', authHeader);
      }
      if (cookieHeader) {
        headers.set('cookie', cookieHeader);
      }
      if (await this.tryMcpOAuthAuth(request, headers)) {
        return true;
      }
      throw new UnauthorizedException('Invalid or expired session');
    } catch (error) {
      // Re-throw deliberate auth/permission errors as-is (e.g. the 403 from the
      // MCP org-resolution path). Only unexpected failures collapse to a 401.
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('[HybridAuthGuard] Session verification failed:', error);
      throw new UnauthorizedException('Invalid or expired session');
    }
  }

  /**
   * Populate the request context from a resolved session (native or
   * better-auth shape). Shared by both resolution paths so behavior cannot
   * drift: active-org membership is required unless skipped, and member
   * role/department is attached.
   */
  private async populateSessionRequest(
    request: AuthenticatedRequest,
    resolved: NativeSessionResult,
    skipOrgCheck: boolean,
  ): Promise<void> {
    const { user, session: sessionData } = resolved;

    if (!user?.id) {
      throw new UnauthorizedException(
        'Invalid session: missing user information',
      );
    }

    const organizationId = sessionData.activeOrganizationId;
    if (!organizationId && !skipOrgCheck) {
      throw new UnauthorizedException(
        'No active organization. Please select an organization.',
      );
    }

    // Fetch member data for role and department info
    // Skip if no active org or if org check is skipped (e.g., during onboarding)
    let userRoles: string[] | null = null;
    if (organizationId && !skipOrgCheck) {
      const member = await db.member.findFirst({
        where: {
          userId: user.id,
          organizationId,
          deactivated: false,
        },
        select: {
          id: true,
          role: true,
          department: true,
        },
      });

      if (!member) {
        throw new UnauthorizedException(
          `User is not a member of the active organization`,
        );
      }

      userRoles = member.role ? member.role.split(',') : null;
      request.memberId = member.id;
      request.memberDepartment = member.department;
    }

    // Set request context for session auth
    request.userId = user.id;
    request.userEmail = user.email;
    request.userRoles = userRoles;
    request.organizationId = organizationId || '';
    request.authType = 'session';
    request.isApiKey = false;
    request.isServiceToken = false;
    request.sessionId = sessionData.id;
    request.sessionDeviceAgent = sessionData.deviceAgent;
  }

  /**
   * Resolve a hosted-MCP OAuth access token — either Gideon-issued (Gram as a
   * Gideon OAuth client, validated via `GideonJwtService`) or legacy
   * better-auth `mcp`/OIDC-provider tokens forwarded by the Gram-hosted MCP
   * server. Populates the request context and returns true on success; returns false when the bearer token is
   * not a valid MCP OAuth token (so the caller throws the generic 401). Throws
   * when no organization can be resolved.
   *
   * The token carries the user identity only. The organization is resolved
   * explicitly from the user's active memberships (device-agent style), never a
   * "most recent" guess. One org → used directly. Multiple orgs → the org the
   * user chose for MCP (McpOrgBinding, set at connect time) is used if they're
   * still a member; otherwise we ask them to choose rather than guess a tenant.
   * Roles come from the resolved member so the existing PermissionGuard enforces
   * RBAC unchanged.
   *
   * Two hard gates (both 403, never 401): the user must (1) be a member of an
   * organization at all — strangers who merely completed sign-in are rejected —
   * and (2) hold a role with app access (`app:read`) in the operative org, the
   * same rule the web app uses. Portal-only roles (employee/contractor) cannot
   * use the MCP.
   */
  private async tryMcpOAuthAuth(
    request: AuthenticatedRequest,
    headers: Headers,
  ): Promise<boolean> {
    // Milestone 3 — accept Gideon-issued MCP tokens (Gram registered as a
    // Gideon OAuth client, validated against Gideon JWKS). Falls through to
    // the legacy better-auth MCP session when the bearer token is not a
    // Gideon JWT linked to an OpenComp user.
    const bearer = headers.get('authorization');
    const gideonToken =
      bearer?.startsWith('Bearer ') &&
      this.gideonJwtService?.isConfigured() &&
      looksLikeJwtForMcp(bearer.slice(7).trim())
        ? bearer.slice(7).trim()
        : null;
    if (gideonToken && this.gideonJwtService) {
      const verified = await this.gideonJwtService.verify(gideonToken);
      const sub = verified
        ? this.gideonJwtService.resolveUserId(verified.payload)
        : null;
      if (sub) {
        const linked = await db.user.findUnique({
          where: { gideonSub: sub },
          select: { id: true },
        });
        if (linked) {
          const aalRaw = verified?.payload.aal;
          const aal =
            typeof aalRaw === 'string' ? parseInt(aalRaw, 10) : aalRaw;
          if (typeof aal === 'number' && Number.isFinite(aal)) {
            request.gideonAal = aal;
          }
          request.isGideonJwt = true;
          return this.populateMcpRequest(request, linked.id, 'gideon');
        }
        this.logger.warn(
          '[Gideon] MCP token sub not linked to an OpenComp user',
        );
      }
    }

    const token = await auth.api.getMcpSession({ headers }).catch(() => null);
    if (!token?.userId) {
      return false;
    }

    return this.populateMcpRequest(request, token.userId, 'legacy');
  }

  private async populateMcpRequest(
    request: AuthenticatedRequest,
    userId: string,
    issuer: 'gideon' | 'legacy',
  ): Promise<boolean> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) {
      return false;
    }

    request.userId = user.id;
    request.userEmail = user.email;
    request.userRoles = null;
    request.organizationId = '';
    request.authType = 'session';
    request.isApiKey = false;
    request.isServiceToken = false;
    request.isMcpOAuth = true;

    // An MCP token is only usable by a member of at least one organization.
    // Enumerate active memberships up front (device-agent style) so a user with
    // none — e.g. someone who completed Google sign-in but was never invited to
    // any org, or who was removed from all of them — is blocked from EVERY MCP
    // tool, including the org-agnostic (skipOrgCheck) ones.
    const memberships = await db.member.findMany({
      where: { userId, deactivated: false },
      select: { id: true, role: true, department: true, organizationId: true },
    });

    if (memberships.length === 0) {
      // Authenticated, but a member of nothing — not an auth failure, so 403
      // (not 401) keeps the MCP client from looping on re-authentication.
      throw new ForbiddenException(
        'This account is not a member of any organization, so it cannot use the MCP.',
      );
    }

    let member = memberships[0];
    if (memberships.length > 1) {
      // Multi-org: use the org the user chose for MCP (set at connect time),
      // as long as they're still a member of it. No saved/valid choice → ask
      // them to pick rather than guessing a tenant.
      const binding = await db.mcpOrgBinding.findUnique({
        where: { userId },
        select: { organizationId: true },
      });
      const chosen = binding
        ? memberships.find((m) => m.organizationId === binding.organizationId)
        : undefined;
      if (!chosen) {
        // 403 (not 401): the token is valid — the user just needs to pick an
        // org. A 401 would make the MCP client re-run sign-in in a loop.
        throw new ForbiddenException(
          'This account belongs to multiple organizations. Choose your ' +
            'organization for AI/MCP access in OpenComp settings, then try again.',
        );
      }
      member = chosen;
    }

    // App-access gate: MCP follows the same rule as the web app — only roles
    // that grant app access (`app:read`) may use it. Portal-only roles
    // (employee/contractor, or custom roles without app access) are rejected.
    if (!(await hasAppAccess(member.organizationId, member.role))) {
      throw new ForbiddenException(
        "Your role doesn't have access to the app, so it can't use the MCP. " +
          'Ask an organization admin for access.',
      );
    }

    request.organizationId = member.organizationId;
    request.memberId = member.id;
    request.memberDepartment = member.department;
    request.userRoles = member.role ? member.role.split(',') : null;

    this.logger.log(
      `MCP OAuth token (${issuer}) authenticated for user ${user.id} (org ${member.organizationId})`,
    );
    return true;
  }
}

/** Bearer values with 3 dot-segments are JWT-shaped (vs opaque session tokens). */
function looksLikeJwtForMcp(token: string): boolean {
  return token.split('.').length === 3;
}
