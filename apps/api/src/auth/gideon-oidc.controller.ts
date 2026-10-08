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
  GideonCallbackQueryDto,
  GideonLoginQueryDto,
  isValidInviteCode,
} from './dto/gideon-oidc.dto';
import { GideonOidcService } from './gideon-oidc.service';
import { getOidcCallbackDiagnostics } from './gideon-oidc-diagnostics';
import { getTrustedOrigins } from './origin-policy';
import { Public } from './public.decorator';
import {
  clearSessionCookie,
  getSessionCookieNames,
  setSessionCookie,
  unsignedSessionToken,
} from './session-cookie';

/**
 * Milestone 1 — Gideon OIDC browser login (dual-run with better-auth).
 *
 * Browser-only flows (302 redirects + cookies), excluded from the public
 * OpenAPI/MCP surface. better-auth buttons and handlers stay untouched.
 */
@ApiExcludeController()
@ApiTags('Auth')
@Controller({ path: 'auth/gideon', version: '1' })
export class GideonOidcController {
  private readonly logger = new Logger(GideonOidcController.name);

  constructor(private readonly oidc: GideonOidcService) {}

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
    summary: 'Start Gideon OIDC login',
    description:
      '302-redirects the browser to Gideon Auth for passkey/SSO sign-in.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to Gideon' })
  async login(
    @Query() query: GideonLoginQueryDto,
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
        `Gideon OIDC login URL build failed: ${(error as Error).message}`,
      );
      this.fail({ res, code: 'gideon_unavailable', redirectTo });
    }
  }

  @Get('callback')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({
    summary: 'Gideon OIDC callback',
    description:
      'Validates the Gideon response, mints a session, redirects to the app.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to the app' })
  async callback(
    @Query() query: GideonCallbackQueryDto,
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
        code: 'gideon_access_denied',
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
      this.logger.warn(
        getOidcCallbackDiagnostics({
          callbackPath: req.originalUrl,
          expectedIssuer: process.env.GIDEON_IDENTITY_URL,
          error,
        }),
      );
      this.fail({
        res,
        code: 'gideon_login_failed',
        redirectTo: storedRedirect,
      });
    }
  }

  @Post('logout')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log out of Gideon session',
    description:
      'Revokes Gideon tokens, deletes the session row, clears the cookie.',
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

// Compose/env-file loaders can preserve surrounding quotes, unlike dotenv.
// Strip them to prevent redirects becoming malformed relative URLs.
function stripSurroundingQuotes(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim() || undefined;
  }
  return trimmed || undefined;
}

/**
 * Reconstruct the externally visible callback URL. Chained proxies join
 * `x-forwarded-proto` with commas — only the first (client-facing) value
 * is ours.
 */
function buildCallbackUrl(req: Request): string {
  const forwarded = req.headers['x-forwarded-proto'];
  const first = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0]
      : undefined;
  const proto = (first ?? req.protocol).trim() || req.protocol;
  return `${proto}://${req.get('host')}${req.originalUrl}`;
}

/**
 * Session token from the session cookie (secure-prefixed variant first,
 * mirroring better-auth's read order) or a bearer session token. Cookie
 * values arrive signed (`token.signature`, URI-encoded on the wire) and the
 * Session row is keyed by the raw token, so the signature is stripped here.
 */
function extractSessionToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  for (const name of getSessionCookieNames()) {
    const token = unsignedSessionToken(cookies[name]);
    if (token) return token;
  }
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return unsignedSessionToken(authHeader.slice(7).trim());
  }
  return null;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && out[name] === undefined) out[name] = value;
  }
  return out;
}
