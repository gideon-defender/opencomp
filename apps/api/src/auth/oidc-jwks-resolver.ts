import { Logger } from '@nestjs/common';
import { oidcJwksCacheTtl } from './oidc-env';
import { fetchDiscoveryJwksUri, isUsableJwksUrl } from './oidc-jwks-url';

/**
 * Cached JWKS URL resolution for the Bearer path.
 *
 * Reads `jwks_uri` from the discovery document, falls back to the legacy
 * `/.well-known/jwks.json` path before the first successful discovery. Results are
 * cached per issuer base for the JWKS TTL so every verify call does not
 * pay for a discovery fetch.
 */
export class OidcJwksResolver {
  private readonly logger = new Logger(OidcJwksResolver.name);
  private cached: {
    base: string;
    url: string | null;
    expiresAt: number;
  } | null = null;
  private warnedFallback = false;
  private warnedUnusable = false;

  async resolve(identityUrl: string | null): Promise<string | null> {
    if (!identityUrl) return null;
    const base = identityUrl.replace(/\/+$/, '');
    const now = Date.now();
    if (
      this.cached &&
      this.cached.base === base &&
      this.cached.expiresAt > now
    ) {
      return this.cached.url;
    }
    // A discovery outage must not replace a working key endpoint for this issuer.
    const previousUrl = this.cached?.base === base ? this.cached.url : null;
    const discovered = await fetchDiscoveryJwksUri(base);
    const candidate =
      discovered ?? previousUrl ?? `${base}/.well-known/jwks.json`;
    if (!discovered && !previousUrl && !this.warnedFallback) {
      this.warnedFallback = true;
      this.logger.warn(
        `OIDC discovery has no usable jwks_uri for ${base} — falling back to ${candidate}`,
      );
    }
    if (!isUsableJwksUrl(candidate)) {
      if (!this.warnedUnusable) {
        this.warnedUnusable = true;
        this.logger.warn(
          `OIDC JWKS unreachable for ${base} — refusing plain-HTTP keys outside local dev`,
        );
      }
      this.cached = {
        base,
        url: null,
        expiresAt: now + oidcJwksCacheTtl() * 1000,
      };
      return null;
    }
    this.cached = {
      base,
      url: candidate,
      expiresAt: now + oidcJwksCacheTtl() * 1000,
    };
    return candidate;
  }

  /** Test-only cache and warn-flag reset. */
  resetForTests(): void {
    this.cached = null;
    this.warnedFallback = false;
    this.warnedUnusable = false;
  }
}
