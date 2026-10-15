import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiExcludeController,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  OidcCallbackQueryDto,
  OidcLoginQueryDto,
  isValidInviteCode,
} from './dto/oidc.dto';
import { OidcService } from './oidc.service';
import {
  buildCallbackUrl,
  extractSessionToken,
  stripSurroundingQuotes,
} from './oidc-controller-helpers';
import { EntitlementsDeniedError } from './oidc-entitlements';
import { getOidcCallbackDiagnostics } from './oidc-diagnostics';
import { getTrustedOrigins } from './origin-policy';
import { oidcIdentityUrl } from './oidc-env';
import { Public } from './public.decorator';
import { clearSessionCookie, setSessionCookie } from './session-cookie';

/**
 * OIDC browser login (dual-run with better-auth).
 *
 * Browser-only flows (302 redirects + cookies), excluded from the public
 * OpenAPI/MCP surface. better-auth buttons and handlers stay untouched.
 *
 * The legacy `auth/gideon` path is a one-release alias: the registered IdP
 * redirect URI cannot move until the IdP-side app registration is updated.
 * Remove the alias once the registration points at `auth/oidc`.
 */
@ApiExcludeController()
@ApiTags('Auth')
@Controller({ path: ['auth/oidc', 'auth/gideon'], version: '1' })
export class OidcController {
  private readonly logger = new Logger(OidcController.name);

  constructor(private readonly oidc: OidcService) {}

  private get appBaseUrl(): string {
    return (
      stripSurroundingQuotes(process.env.NEXT_PUBLIC_APP_URL) ||
      stripSurroundingQuotes(process.env.BETTER_AUTH_URL) ||
      'http://localhost:3000'
    );
  }

  /** Allow only same-app relative paths; reject //evil.com and backslashes. */
  private safeAppPath(value: string | undefined): string | undefined {
    if (!value) return undefined;
    if (!value.startsWith('/') || value.startsWith('//')) return undefined;
    if (value.includes('\\')) return undefined;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
    return value.slice(0, 2048);
  }

  /**
   * Validated post-login target: either a same-app relative path or an
   * absolute URL on an explicitly trusted origin (the portal's way home).
   * Absolute targets must match the explicit allow-list exactly — never a
   * suffix wildcard. The session cookie is scoped to `.gideondefender.com`
   * with SameSite=Lax, so a 302 to an attacker-controlled subdomain (e.g.
   * `evil.gideondefender.com`) would carry the live session cookie to the
   * attacker on top-level navigation. Anything else is dropped.
   */
  private safeRedirectTarget(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const relative = this.safeAppPath(value);
    if (relative) return relative;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return undefined;
      }
      if (url.username || url.password) return undefined;
      if (!getTrustedOrigins().includes(url.origin)) return undefined;
      return url.toString().slice(0, 2048);
    } catch {
      return undefined;
    }
  }

  private postLoginTarget({
    redirectTo,
    inviteCode,
  }: {
    redirectTo?: string;
    inviteCode?: string;
  }): string {
    if (isValidInviteCode(inviteCode)) {
      return `${this.appBaseUrl}/invite/${inviteCode}`;
    }
    const target = this.safeRedirectTarget(redirectTo);
    if (target) {
      if (target.startsWith('/')) return `${this.appBaseUrl}${target}`;
      return target;
    }
    return `${this.appBaseUrl}/`;
  }

  /** Failure base: back to the trusted absolute origin when known, else app. */
  private failBase(redirectTo?: string): string {
    const target = this.safeRedirectTarget(redirectTo);
    if (target && !target.startsWith('/')) {
      try {
        return new URL(target).origin;
      } catch {
        return this.appBaseUrl;
      }
    }
    return this.appBaseUrl;
  }

  private fail({
    res,
    code,
    redirectTo,
  }: {
    res: Response;
    code: string;
    redirectTo?: string;
  }): void {
    res.redirect(`${this.failBase(redirectTo)}/auth?error=${code}`);
  }

  @Get('login')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({
    summary: 'Start OIDC login',
    description:
      '302-redirects the browser to the identity provider for passkey/SSO sign-in.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the identity provider',
  })
  async login(
    @Query() query: OidcLoginQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const redirectTo = this.safeRedirectTarget(query.redirectTo);
    try {
      const { url } = await this.oidc.buildLoginUrl({
        redirectTo,
        inviteCode: query.inviteCode,
      });
      res.redirect(url);
    } catch (error) {
      this.logger.warn(
        `OIDC login URL build failed: ${(error as Error).message}`,
      );
      this.fail({ res, code: 'oidc_unavailable', redirectTo });
    }
  }

  @Get('callback')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({
    summary: 'OIDC callback',
    description:
      'Validates the identity-provider response, mints a session, redirects to the app.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to the app' })
  async callback(
    @Query() query: OidcCallbackQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Peek before handleCallback consumes the single-use state, so a later
    // failure still redirects portal users back to their original app.
    const storedRedirect = query.state
      ? await this.oidc.peekStoredRedirect(query.state)
      : undefined;
    if (query.error) {
      this.fail({
        res,
        code: 'oidc_access_denied',
        redirectTo: storedRedirect,
      });
      return;
    }
    try {
      const callbackUrl = buildCallbackUrl(req);
      const result = await this.oidc.handleCallback({ callbackUrl });
      setSessionCookie({
        res,
        token: result.sessionToken,
        expiresAt: result.expiresAt,
      });
      res.redirect(this.postLoginTarget(result));
    } catch (error) {
      // Phase 1: IdP-deny mints no session and lands on the no-access
      // messaging. Class-matched, never message-matched, so identity-gate
      // failures keep their own codes.
      if (error instanceof EntitlementsDeniedError) {
        this.logger.warn(`OIDC entitlement deny (reason=${error.reason})`);
        this.fail({
          res,
          code: 'no_role',
          redirectTo: storedRedirect,
        });
        return;
      }
      this.logger.warn(
        getOidcCallbackDiagnostics({
          callbackPath: req.originalUrl,
          expectedIssuer: oidcIdentityUrl(),
          error,
        }),
      );
      this.fail({
        res,
        code: 'oidc_login_failed',
        redirectTo: storedRedirect,
      });
    }
  }

  @Post('logout')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log out of OIDC session',
    description:
      'Revokes identity-provider tokens, deletes the session row, clears the cookie.',
  })
  @ApiResponse({ status: 200, description: 'Logged out' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ loggedOut: boolean }> {
    const token = extractSessionToken(req);
    if (token) {
      await this.oidc.revokeAndDeleteSession(token);
    }
    clearSessionCookie({ res });
    return { loggedOut: true };
  }
}
