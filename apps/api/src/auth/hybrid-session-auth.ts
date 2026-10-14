import {
  ForbiddenException,
  HttpException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { db } from '@db';
import { hasAppAccess } from './app-access';
import { auth } from './auth.server';
import type { AuthenticatedRequest } from './types';
import type { GideonJwtService } from './gideon-jwt.service';
import type {
  NativeSessionService,
  NativeSessionResult,
} from './native-session.service';

export class HybridSessionAuth {
  private readonly logger = new Logger('HybridAuthGuard');
  private readonly nativeSessionService?: NativeSessionService;
  private readonly gideonJwtService?: GideonJwtService;

  constructor({
    nativeSessionService,
    gideonJwtService,
  }: {
    nativeSessionService?: NativeSessionService;
    gideonJwtService?: GideonJwtService;
  }) {
    this.nativeSessionService = nativeSessionService;
    this.gideonJwtService = gideonJwtService;
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
      where: { userId, deactivated: false, idpAccessRevoked: false },
      select: { id: true, role: true, department: true, organizationId: true },
    });

    if (memberships.length === 0) {
      // Authenticated, but a member of nothing — not an auth failure, so 403
      // (not 401) keeps the MCP client from looping on re-authentication.
      throw new ForbiddenException(
        'This account is not a member of any organization, so it cannot use the MCP.',
      );
    }

    // A saved selection also constrains single-membership users after a split.
    const binding = await db.mcpOrgBinding.findUnique({
      where: { userId },
      select: { organizationId: true },
    });
    const member = binding
      ? memberships.find((m) => m.organizationId === binding.organizationId)
      : memberships.length === 1
        ? memberships[0]
        : undefined;
    if (!member) {
      throw new ForbiddenException(
        'Choose an organization you still belong to for AI/MCP access in OpenComp settings, then try again.',
      );
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
