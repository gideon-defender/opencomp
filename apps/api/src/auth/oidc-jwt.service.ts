import { Injectable, Logger } from '@nestjs/common';
import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import {
  isJwtShaped,
  resolveOidcAal,
  resolveOidcTenantClaim,
  type OidcTenantClaimResult,
} from './oidc-tenant-claim';
import { stripControlChars } from './app-access';
import {
  oidcIdentityUrl,
  oidcJwksCacheTtl,
  oidcJwtAudience,
  oidcJwtEnabled,
  oidcJwtIssuer,
  oidcJwtShadowFlag,
} from './oidc-env';
import { OidcJwksResolver } from './oidc-jwks-resolver';

export interface OidcJwtPayload extends JWTPayload {
  sub: string;
  tid?: string;
  tenant_id?: string;
  organizationId?: string;
  email?: string;
  aal?: number | string;
  amr?: string[];
  scope?: string;
}

export interface OidcVerifyResult {
  payload: OidcJwtPayload;
  protectedHeader: Record<string, unknown>;
}

export {
  resolveOidcTenantClaim,
  type OidcTenantClaimError,
  type OidcTenantClaimFail,
  type OidcTenantClaimOk,
  type OidcTenantClaimResult,
} from './oidc-tenant-claim';

/**
 * Phase 0 — Read-only shadow JWKS verifier for the OIDC IdP.
 *
 * Behind flag `OIDC_JWT_ENABLED` (enforce) and `OIDC_JWT_SHADOW_ENABLED`
 * (shadow+log, default for Phase 0). When disabled, `verify()` returns null
 * and HybridAuthGuard falls through to better-auth session.
 *
 * Uses `jose` `createRemoteJWKSet` with built-in cooldown + cache. The JWKS
 * URL comes from the discovery document's `jwks_uri`, with a fallback to the
 * legacy `/.well-known/jwks.json` path when discovery is unreachable.
 */
@Injectable()
export class OidcJwtService {
  private readonly logger = new Logger(OidcJwtService.name);
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private jwksSourceUrl: string | null = null;
  private readonly jwksResolver = new OidcJwksResolver();
  private warnedDisabled = false;

  private get identityUrl(): string | null {
    return oidcIdentityUrl() || null;
  }

  private get issuer(): string | null {
    return oidcJwtIssuer();
  }

  private get audience(): string | null {
    return oidcJwtAudience();
  }

  private get enabled(): boolean {
    return oidcJwtEnabled();
  }

  private get shadowEnabled(): boolean {
    // Phase 0 default: shadow on even if enforce off, when identityUrl is set
    const shadowFlag = oidcJwtShadowFlag();
    if (shadowFlag === 'true') return true;
    if (shadowFlag === 'false') return false;
    // Auto-shadow when the issuer is configured but not enforced
    return !!this.identityUrl && !this.enabled;
  }

  private async getRemoteJWKSet(): Promise<ReturnType<
    typeof createRemoteJWKSet
  > | null> {
    const url = await this.jwksResolver.resolve(this.identityUrl);
    if (!url) {
      if (!this.identityUrl && !this.warnedDisabled) {
        this.warnedDisabled = true;
        this.logger.log(
          'OIDC JWT disabled — set OIDC_ISSUER_URL to enable shadow verification',
        );
      }
      return null;
    }
    if (!this.jwks || this.jwksSourceUrl !== url) {
      try {
        const jwksUrl = new URL(url);
        const ttl = oidcJwksCacheTtl();
        this.jwks = createRemoteJWKSet(jwksUrl, {
          cooldownDuration: ttl * 1000,
        });
        this.jwksSourceUrl = url;
        this.logger.log(`OIDC JWKS initialized: ${url} (ttl=${ttl}s)`);
      } catch (error) {
        this.logger.warn(
          `Failed to create OIDC JWKS client for ${url}`,
          error as Error,
        );
        return null;
      }
    }
    return this.jwks;
  }

  isShadowMode(): boolean {
    return this.shadowEnabled;
  }

  isEnforceMode(): boolean {
    return this.enabled;
  }

  isConfigured(): boolean {
    return !!this.identityUrl;
  }

  /**
   * Identity URL is set but issuer/audience binding is missing, so no
   * token can be identified as (or ruled out as) an OIDC JWT. Callers fail
   * closed on JWT-shaped bearers in this state instead of silently falling
   * back to legacy paths.
   */
  isMisconfigured(): boolean {
    return this.isConfigured() && (!this.issuer || !this.audience);
  }

  /**
   * Whether a Bearer token presents as an OIDC JWT: JWT-shaped with an `iss`
   * matching the configured issuer. Used by HybridAuthGuard so enforce mode
   * only hard-fails tokens that claim to be OIDC JWTs — opaque
   * session/MCP bearer tokens fall through to session auth in every mode.
   */
  isOidcToken(token: string): boolean {
    if (!isJwtShaped(token)) return false;
    const issuer = this.issuer;
    if (!issuer) return false;
    try {
      const payload = decodeJwt(token) as Record<string, unknown>;
      return payload.iss === issuer;
    } catch {
      return false;
    }
  }

  /**
   * Verify an OIDC JWT. Returns payload on success, null on failure or when disabled.
   * Never throws — caller decides to fallback or enforce.
   */
  async verify(token: string): Promise<OidcVerifyResult | null> {
    if (!token) return null;

    // Fail closed before any network work when the endpoint is configured
    // but issuer or audience is missing — otherwise any KMS-signed JWT
    // would be accepted without iss/aud binding.
    if (this.isConfigured() && (!this.issuer || !this.audience)) {
      this.logger.warn(
        'OIDC JWT misconfigured — OIDC_JWT_ISSUER and OIDC_JWT_AUDIENCE (or GIDEON_JWT_ISSUER/JWT_ISSUER and GIDEON_JWT_AUDIENCE/JWT_AUDIENCE) must be set when the issuer URL is set; rejecting token',
      );
      return null;
    }

    // Fast-path: peek iss without crypto/JWKS fetch. Avoids per-request JWKS work
    // for better-auth session Bearer tokens when the IdP is in shadow mode.
    if (this.issuer) {
      try {
        const peek = decodeJwt(token);
        // `iss` is optional in JWT but expected for OIDC; if present and mismatched, skip verify
        const peekIss: unknown = peek.iss;
        if (typeof peekIss === 'string' && peekIss !== this.issuer) {
          this.logger.debug(
            `OIDC JWT iss mismatch — expected ${stripControlChars(this.issuer)}, got ${stripControlChars(peekIss)}`,
          );
          return null;
        }
        // Also peek protected header for `kid` presence — non-JWT opaque tokens lack it
        try {
          const header = decodeProtectedHeader(token);
          if (!header.kid) {
            this.logger.debug(
              'OIDC JWT missing kid — likely not an OIDC JWT, skipping',
            );
            return null;
          }
        } catch {
          return null;
        }
      } catch {
        return null;
      }
    }

    const jwks = await this.getRemoteJWKSet();
    if (!jwks) return null;

    try {
      const { payload, protectedHeader } = await jwtVerify(token, jwks, {
        issuer: this.issuer || undefined,
        audience: this.audience || undefined,
      });

      // Phase 0 shadow logs only: low assurance is observed here, not
      // enforced. A future aal >= 2 gate will consume `oidcAal`.
      const aal = resolveOidcAal((payload as OidcJwtPayload).aal);
      if (aal !== undefined && aal < 2) {
        this.logger.warn(
          `OIDC JWT aal=${aal} <2 observed (no enforcement yet)`,
        );
      }

      return {
        payload: payload as OidcJwtPayload,
        protectedHeader: protectedHeader,
      };
    } catch (error) {
      this.logger.debug(`OIDC JWT verify failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** Strict contract with rejection reason (used by the tenant gate). */
  resolveTenantClaim(payload: OidcJwtPayload): OidcTenantClaimResult {
    return resolveOidcTenantClaim(payload);
  }

  /** Subject claim; non-string values reject as missing (fail closed). */
  resolveUserId(payload: OidcJwtPayload): string | null {
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  }
}
