import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { db } from '@db';
import type { Configuration } from 'openid-client';
import { loadOidcClient } from './oidc-client';
import {
  oidcClientId,
  oidcClientSecret,
  oidcIdentityUrl,
  oidcRedirectUri,
  oidcScopes,
  isLoopbackHost,
} from './oidc-env';
import {
  handleOidcCallback,
  LEGACY_OIDC_STATE_KEY_PREFIX,
  OIDC_STATE_TTL_SECONDS,
  OIDC_STATE_KEY_PREFIX,
  type OidcCallbackResult,
  type StoredOidcState,
} from './oidc-callback';
export {
  extractOidcTenantId,
  LEGACY_OIDC_STATE_KEY_PREFIX,
  OIDC_STATE_TTL_SECONDS,
  OIDC_STATE_KEY_PREFIX,
} from './oidc-callback';
export type { OidcCallbackResult } from './oidc-callback';
import { redisClient } from '../redis/redis.client';

export interface BuildLoginUrlParams {
  redirectTo?: string;
  inviteCode?: string;
}

export interface BuiltLoginUrl {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * OIDC login (dual-run with better-auth, no deletions).
 *
 * Uses `openid-client` v6 for discovery, PKCE, and the state/nonce/code
 * checks (loaded via `oidc-client` because the package is ESM-only).
 * Never hand-rolls those with `jose`.
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private config: Configuration | null = null;

  /**
   * The client secret is OPTIONAL: apps registered as public
   * (`is_public`) have no secret. openid-client v6 then authenticates the
   * code exchange as a public client (`none` + `client_id` in the body),
   * which is safe here because the exchange is server-side and always bound
   * to the PKCE S256 verifier + state/nonce stored in Redis.
   */
  isConfigured(): boolean {
    return !!(oidcIdentityUrl() && oidcClientId() && oidcRedirectUri());
  }

  private get scopes(): string {
    return oidcScopes();
  }

  /** Test-only discovery-cache reset. */
  resetCache(): void {
    this.config = null;
  }

  /**
   * OIDC discovery against the issuer URL (cached client config).
   * Plain HTTP is allowed for loopback issuers only (local dev); anything
   * else fails closed instead of leaking the client secret over HTTP.
   */
  async getOidcConfig(): Promise<Configuration> {
    if (this.config) return this.config;

    const identityUrl = oidcIdentityUrl();
    const clientId = oidcClientId();
    // Optional — public (`is_public`) apps have no secret; the
    // library then uses `none` client auth (PKCE-bound, server-side).
    const clientSecret = oidcClientSecret() || undefined;
    if (!identityUrl || !clientId) {
      throw new UnauthorizedException('OIDC login is not configured');
    }

    const oidc = await loadOidcClient();
    const server = new URL(identityUrl);
    if (server.protocol === 'http:' && !isLoopbackHost(server.hostname)) {
      throw new UnauthorizedException(
        'OIDC login requires HTTPS outside local dev',
      );
    }
    this.config = await oidc.discovery(
      server,
      clientId,
      clientSecret,
      undefined,
      server.protocol === 'http:'
        ? { execute: [oidc.allowInsecureRequests] }
        : undefined,
    );
    this.logger.log(
      `OIDC discovery complete: ${identityUrl} ` +
        `(client_auth=${clientSecret ? 'client_secret_post' : 'none/public'})`,
    );
    return this.config;
  }

  /**
   * Build the authorize URL with PKCE S256 + state/nonce.
   * Stores state → { codeVerifier, nonce, redirectTo, inviteCode } in Redis
   * with a ~10 min TTL; the callback rejects mismatched/expired state.
   */
  async buildLoginUrl(
    params: BuildLoginUrlParams = {},
  ): Promise<BuiltLoginUrl> {
    const config = await this.getOidcConfig();
    const oidc = await loadOidcClient();

    const redirectUri = oidcRedirectUri();
    if (!redirectUri) {
      throw new UnauthorizedException('OIDC login is not configured');
    }

    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    const stored: StoredOidcState = { codeVerifier, nonce };
    if (params.redirectTo) stored.redirectTo = params.redirectTo;
    if (params.inviteCode) stored.inviteCode = params.inviteCode;
    await redisClient.set(`${OIDC_STATE_KEY_PREFIX}${state}`, stored, {
      ex: OIDC_STATE_TTL_SECONDS,
    });

    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: this.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return { url: url.toString(), state, nonce, codeVerifier };
  }

  /**
   * Handle the IdP redirect: code exchange + nonce validation + userinfo
   * fetch via the library, then find-or-create the user and mint a standard
   * Session row (same shape as better-auth sessions).
   */
  async handleCallback({
    callbackUrl,
  }: {
    callbackUrl: string;
  }): Promise<OidcCallbackResult> {
    return handleOidcCallback({
      callbackUrl,
      config: await this.getOidcConfig(),
    });
  }

  /**
   * Non-destructive read of the stored return target for a login state.
   * Used only to route failure redirects back to the right app (portal vs
   * app); the state itself stays single-use for the real exchange.
   */
  async peekStoredRedirect(state: string): Promise<string | undefined> {
    try {
      const stored = await redisClient.get<StoredOidcState>(
        `${OIDC_STATE_KEY_PREFIX}${state}`,
      );
      if (stored?.redirectTo) return stored.redirectTo;
      const legacy = await redisClient.get<StoredOidcState>(
        `${LEGACY_OIDC_STATE_KEY_PREFIX}${state}`,
      );
      return legacy?.redirectTo;
    } catch {
      return undefined;
    }
  }

  /** Revoke the identity-provider refresh token, then delete the Session row. */
  async revokeAndDeleteSession(sessionToken: string): Promise<void> {
    const session = await db.session.findUnique({
      where: { token: sessionToken },
      select: { id: true, oidcRefreshToken: true },
    });
    if (!session) return;
    if (session.oidcRefreshToken) {
      await this.revokeToken(session.oidcRefreshToken);
    }
    try {
      await db.session.delete({ where: { id: session.id } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2025') throw error;
    }
  }
  /** Best-effort revocation against the IdP /v1/oidc/revoke. */
  private async revokeToken(token: string): Promise<void> {
    try {
      const config = await this.getOidcConfig();
      const oidc = await loadOidcClient();
      await oidc.tokenRevocation(config, token);
    } catch (error) {
      this.logger.warn(
        `Identity token revocation failed: ${(error as Error).message}`,
      );
    }
  }
}
