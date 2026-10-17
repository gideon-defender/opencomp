import { HttpException, Logger, UnauthorizedException } from '@nestjs/common';
import { db } from '@db';
import { auth } from './auth.server';
import { populateLegacyMcpRequest } from './legacy-mcp-request';
import { authenticateOidcMcpToken } from './oidc-mcp-tenant-gate';
import { isJwtShaped } from './oidc-tenant-claim';
import type { AuthenticatedRequest } from './types';
import type { OidcJwtService } from './oidc-jwt.service';
import type {
  NativeSessionService,
  NativeSessionResult,
} from './native-session.service';

export class HybridSessionAuth {
  private readonly logger = new Logger('HybridAuthGuard');
  private readonly nativeSessionService?: NativeSessionService;
  private readonly oidcJwtService?: OidcJwtService;

  constructor({
    nativeSessionService,
    oidcJwtService,
  }: {
    nativeSessionService?: NativeSessionService;
    oidcJwtService?: OidcJwtService;
  }) {
    this.nativeSessionService = nativeSessionService;
    this.oidcJwtService = oidcJwtService;
  }

  async handleSessionAuth(
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

      // Sessions resolve natively (direct Session-row lookup). OIDC
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
          idpAccessRevoked: false,
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

  /** Resolve MCP tokens against active, non-revoked memberships. */
  private async tryMcpOAuthAuth(
    request: AuthenticatedRequest,
    headers: Headers,
  ): Promise<boolean> {
    // Tokens from the configured OIDC issuer stay pinned to verified tenant
    // claims. Verification or tenant-gate failures cannot use the legacy MCP
    // fallback; only opaque or foreign-issuer bearers may reach that path.
    const bearer = headers.get('authorization');
    const bearerToken =
      bearer?.startsWith('Bearer ') === true ? bearer.slice(7).trim() : null;
    const raw =
      bearerToken &&
      this.oidcJwtService?.isConfigured() &&
      isJwtShaped(bearerToken)
        ? bearerToken
        : null;
    if (
      !raw &&
      bearerToken &&
      isJwtShaped(bearerToken) &&
      this.oidcJwtService?.isEnforceMode() === true &&
      this.oidcJwtService?.isConfigured() === false
    ) {
      // Enforce mode with no OIDC configuration: no legitimate OIDC
      // token can exist, so a JWT-shaped bearer fails closed instead of
      // silently using the legacy session path. Opaque bearers still fall
      // through below.
      this.logger.warn(
        '[OIDC] MCP JWT-shaped bearer in enforce mode with OIDC unconfigured — rejecting without legacy fallback',
      );
      throw new UnauthorizedException(
        'Invalid Gideon token: verification failed',
      );
    }
    if (raw && this.oidcJwtService) {
      const verified = await this.oidcJwtService.verify(raw);
      if (verified) {
        return authenticateOidcMcpToken({
          request,
          payload: verified.payload,
          oidcJwtService: this.oidcJwtService,
          logger: this.logger,
        });
      }
      // Verification failed but the token presents as an OIDC JWT (matching
      // iss) — expired, wrong audience, bad signature: reject without trying
      // the legacy session path. `raw` is JWT-shaped by construction, so a
      // partial OIDC configuration (endpoint set, issuer/audience missing)
      // that cannot identify tokens also fails closed here.
      if (
        this.oidcJwtService.isOidcToken(raw) ||
        this.oidcJwtService.isMisconfigured()
      ) {
        this.logger.warn(
          '[OIDC] MCP bearer presents as an OIDC JWT but verification failed — rejecting without legacy fallback',
        );
        throw new UnauthorizedException(
          'Invalid Gideon token: verification failed',
        );
      }
    }

    const token = await auth.api.getMcpSession({ headers }).catch(() => null);
    if (!token?.userId) {
      return false;
    }

    return populateLegacyMcpRequest({
      request,
      userId: token.userId,
      logger: this.logger,
    });
  }
}
