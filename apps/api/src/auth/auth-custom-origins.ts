import { db } from '@db';
import { redisClient } from '../redis/redis.client';
import { isStaticTrustedOrigin } from './origin-policy';

// ── Custom domain lookup via Redis cache ─────────────────────────────────────

const CORS_DOMAINS_CACHE_KEY = 'app:cors:custom-domains';
const CORS_DOMAINS_CACHE_TTL_SECONDS = 5 * 60; // 5 minutes

// The shared client falls back to in-memory when REDIS_URL is unset, so these
// commands are safe to run unconditionally — no hangs on a bogus endpoint.
const corsRedisClient = redisClient;

async function getCustomDomains(): Promise<Set<string>> {
  // Try Redis cache first (non-fatal if Redis is unavailable)
  if (corsRedisClient) {
    try {
      const cached = await corsRedisClient.get<string[]>(
        CORS_DOMAINS_CACHE_KEY,
      );
      if (cached) {
        return new Set(cached);
      }
    } catch (error) {
      console.error(
        '[CORS] Redis cache read failed, falling back to DB:',
        error,
      );
    }
  }

  // Cache miss or Redis unavailable — query DB
  try {
    const trusts = await db.trust.findMany({
      where: {
        domain: { not: null },
        status: 'published',
      },
      select: { domain: true },
    });

    const domains = trusts
      .map((t) => t.domain)
      .filter((d): d is string => d !== null);

    // Best-effort cache update (don't lose DB results if Redis SET fails)
    if (corsRedisClient) {
      try {
        await corsRedisClient.set(CORS_DOMAINS_CACHE_KEY, domains, {
          ex: CORS_DOMAINS_CACHE_TTL_SECONDS,
        });
      } catch {
        // Redis unavailable — continue without caching
      }
    }

    return new Set(domains);
  } catch (error) {
    console.error('[CORS] Failed to fetch custom domains from DB:', error);
    return new Set();
  }
}

/**
 * Check if an origin is trusted. Checks (in order):
 * 1. Static trusted origins list
 * 2. *.gideondefender.com subdomains
 * 3. Published custom domains from the DB (cached in Redis, TTL 5 min)
 */
export async function isTrustedOrigin(origin: string): Promise<boolean> {
  if (isStaticTrustedOrigin(origin)) {
    return true;
  }

  // Check verified custom domains from DB via Redis cache
  try {
    const url = new URL(origin);
    const customDomains = await getCustomDomains();
    return customDomains.has(url.hostname);
  } catch {
    return false;
  }
}
