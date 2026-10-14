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
  resolveGideonAal,
  resolveGideonTenantClaim,
  type GideonTenantClaimResult,
} from './gideon-tenant-claim';
import { stripControlChars } from './app-access';

export interface GideonJwtPayload extends JWTPayload {
  sub: string;
  tid?: string;
  tenant_id?: string;
  organizationId?: string;
  email?: string;
  aal?: number | string;
  amr?: string[];
  scope?: string;
}

export interface GideonVerifyResult {
  payload: GideonJwtPayload;
  protectedHeader: Record<string, unknown>;
}

export {
  resolveGideonTenantClaim,
  type GideonTenantClaimError,
  type GideonTenantClaimFail,
  type GideonTenantClaimOk,
  type GideonTenantClaimResult,
} from './gideon-tenant-claim';

/**
 * Phase 0 — Read-only shadow JWKS verifier for Gideon Auth.
 *
 * Mirrors `agent-communications` `AUTH__IDENTITY_URL` / `AUTH__JWT_ISSUER` pattern
 * (auth/README.md:110, agent-communications/README.md:104).
 *
 * Behind flag `GIDEON_JWT_ENABLED` (enforce) and `GIDEON_JWT_SHADOW_ENABLED`
 * (shadow+log, default for Phase 0). When disabled, `verify()` returns null
 * and HybridAuthGuard falls through to better-auth session.
 *
 * Uses `jose` `createRemoteJWKSet` with built-in cooldown + cache, matching
 * `agent-communications` JWKS cache `AUTH__JWKS_CACHE_TTL_SECS:118`.
 */
@Injectable()
export class GideonJwtService {
  private readonly logger = new Logger(GideonJwtService.name);
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private warnedDisabled = false;

  private get identityUrl(): string | null {
    return (
      process.env.GIDEON_IDENTITY_URL || process.env.AUTH__IDENTITY_URL || null
    );
  }

  private get issuer(): string | null {
    return process.env.GIDEON_JWT_ISSUER || process.env.JWT_ISSUER || null;
  }

  private get audience(): string | null {
    return process.env.GIDEON_JWT_AUDIENCE || process.env.JWT_AUDIENCE || null;
  }

  private get enabled(): boolean {
    return process.env.GIDEON_JWT_ENABLED === 'true';
  }

  private get shadowEnabled(): boolean {
    // Phase 0 default: shadow on even if enforce off, when identityUrl is set
    if (process.env.GIDEON_JWT_SHADOW_ENABLED === 'true') return true;
    if (process.env.GIDEON_JWT_SHADOW_ENABLED === 'false') return false;
    // Auto-shadow when Gideon is configured but not enforced
    return !!this.identityUrl && !this.enabled;
  }

  private get jwksUrl(): string | null {
    if (!this.identityUrl) return null;
    const base = this.identityUrl.replace(/\/$/, '');
    return `${base}/.well-known/jwks.json`;
  }

  private getRemoteJWKSet(): ReturnType<typeof createRemoteJWKSet> | null {
    const url = this.jwksUrl;
    if (!url) {
      if (!this.warnedDisabled) {
        this.warnedDisabled = true;
        this.logger.log(
          'Gideon JWT disabled — set GIDEON_IDENTITY_URL / AUTH__IDENTITY_URL to enable shadow verification',
        );
      }
      return null;
    }
    if (!this.jwks) {
      try {
        const jwksUrl = new URL(url);
        this.jwks = createRemoteJWKSet(jwksUrl, {
          cooldownDuration: this.getCacheTtl() * 1000,
        });
        this.logger.log(
          `Gideon JWKS initialized: ${url} (ttl=${this.getCacheTtl()}s)`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to create Gideon JWKS client for ${url}`,
          error as Error,
        );
        return null;
      }
    }
    return this.jwks;
  }

  private getCacheTtl(): number {
    const raw =
      process.env.GIDEON_JWKS_CACHE_TTL_SECS ||
      process.env.AUTH__JWKS_CACHE_TTL_SECS;
    const parsed = raw ? parseInt(raw, 10) : 300;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
  }

  isShadowMode(): boolean {
    return this.shadowEnabled;
  }

  isEnforceMode(): boolean {
    return this.enabled;
  }

  isConfigured(): boolean {
    return !!this.jwksUrl;
  }

  /**
   * Gideon endpoint configured but issuer/audience binding missing, so no
   * token can be identified as (or ruled out as) a Gideon JWT. Callers fail
   * closed on JWT-shaped bearers in this state instead of silently falling
   * back to legacy paths.
   */
  isMisconfigured(): boolean {
    return this.isConfigured() && (!this.issuer || !this.audience);
  }

  /**
   * Whether a Bearer token presents as a Gideon JWT: JWT-shaped with an `iss`
   * matching the configured issuer. Used by HybridAuthGuard so enforce mode
   * only hard-fails tokens that claim to be Gideon JWTs — opaque
   * session/MCP bearer tokens fall through to session auth in every mode.
   */
  isGideonToken(token: string): boolean {
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
   * Verify a Gideon JWT. Returns payload on success, null on failure or when disabled.
   * Never throws — caller decides to fallback or enforce.
   */
  async verify(token: string): Promise<GideonVerifyResult | null> {
    if (!token) return null;
    const jwks = this.getRemoteJWKSet();
    if (!jwks) return null;

    // Fail closed when Gideon is configured but issuer or audience is missing
    // — otherwise any KMS-signed JWT would be accepted without iss/aud binding.
    if (this.isConfigured() && (!this.issuer || !this.audience)) {
      this.logger.warn(
        'Gideon JWT misconfigured — GIDEON_JWT_ISSUER and GIDEON_JWT_AUDIENCE (or JWT_ISSUER/AUDIENCE) must be set when GIDEON_IDENTITY_URL is set; rejecting token',
      );
      return null;
    }

    // Fast-path: peek iss without crypto/JWKS fetch. Avoids per-request JWKS work
    // for better-auth session Bearer tokens when Gideon is in shadow mode.
    if (this.issuer) {
      try {
        const peek = decodeJwt(token);
        // `iss` is optional in JWT but expected for Gideon; if present and mismatched, skip verify
        const peekIss: unknown = peek.iss;
        if (typeof peekIss === 'string' && peekIss !== this.issuer) {
          this.logger.debug(
            `Gideon JWT iss mismatch — expected ${stripControlChars(this.issuer)}, got ${stripControlChars(peekIss)}`,
          );
          return null;
        }
        // Also peek protected header for `kid` presence — non-JWT opaque tokens lack it
        try {
          const header = decodeProtectedHeader(token);
          if (!header.kid) {
            this.logger.debug(
              'Gideon JWT missing kid — likely not a Gideon JWT, skipping',
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

    try {
      const { payload, protectedHeader } = await jwtVerify(token, jwks, {
        issuer: this.issuer || undefined,
        audience: this.audience || undefined,
      });

      // Phase 0 shadow logs only: low assurance is observed here, not
      // enforced. A future aal >= 2 gate will consume `gideonAal`.
      const aal = resolveGideonAal((payload as GideonJwtPayload).aal);
      if (aal !== undefined && aal < 2) {
        this.logger.warn(
          `Gideon JWT aal=${aal} <2 observed (no enforcement yet)`,
        );
      }

      return {
        payload: payload as GideonJwtPayload,
        protectedHeader: protectedHeader,
      };
    } catch (error) {
      this.logger.debug(
        `Gideon JWT verify failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Strict contract with rejection reason (used by the tenant gate). */
  resolveTenantClaim(payload: GideonJwtPayload): GideonTenantClaimResult {
    return resolveGideonTenantClaim(payload);
  }

  /** Subject claim; non-string values reject as missing (fail closed). */
  resolveUserId(payload: GideonJwtPayload): string | null {
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  }
}
