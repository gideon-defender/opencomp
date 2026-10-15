import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { db } from '@db';
import { LegacySessionRevocation } from './legacy-session-revocation';
import { getSessionCookieNames, unsignedSessionToken } from './session-cookie';

export interface NativeSessionUser {
  id: string;
  email: string;
}

export interface NativeSessionData {
  id: string;
  activeOrganizationId: string | null;
  deviceAgent: boolean;
  expiresAt: Date;
}

export interface NativeSessionResult {
  user: NativeSessionUser;
  session: NativeSessionData;
}

/**
 * Milestone 3 — Native session resolution (no better-auth).
 *
 * Reads the `Session` row directly from the database using the raw token
 * from the session cookie (either name variant, signed or unsigned) or a
 * bearer session token. Returns the user + session in the same shape
 * `HybridAuthGuard` previously built from `auth.api.getSession`, so the
 * guard can resolve sessions without the better-auth library.
 *
 * Sessions minted by EITHER path (legacy better-auth logins and Gideon OIDC
 * logins via `mintOidcSession`) are plain `Session` rows keyed by the raw
 * token — both resolve here identically.
 *
 * Never throws — returns null when no usable session is presented, letting
 * the caller fall back (dual-run) or 401.
 */
@Injectable()
export class NativeSessionService implements OnModuleInit {
  private readonly logger = new Logger(NativeSessionService.name);

  private readonly legacyRevocation = new LegacySessionRevocation();

  async onModuleInit(): Promise<void> {
    await this.legacyRevocation.onModuleInit();
  }

  async resolveFromHeaders({
    cookieHeader,
    authHeader,
  }: {
    cookieHeader?: string;
    authHeader?: string;
  }): Promise<NativeSessionResult | null> {
    for (const token of this.candidateTokens({ cookieHeader, authHeader })) {
      const result = await this.resolveToken(token);
      if (result) return result;
    }
    return null;
  }

  /** Raw session-token candidates: session cookies first, then bearer. */
  private candidateTokens({
    cookieHeader,
    authHeader,
  }: {
    cookieHeader?: string;
    authHeader?: string;
  }): string[] {
    const candidates: string[] = [];
    const cookies = parseCookies(cookieHeader);
    for (const name of getSessionCookieNames()) {
      const token = unsignedSessionToken(cookies[name]);
      if (token) candidates.push(token);
    }
    if (authHeader?.startsWith('Bearer ')) {
      const raw = authHeader.slice(7).trim();
      // A Gideon JWT also arrives as a bearer token — it is not a session
      // token (exactly 3 dot-segments; signed session cookies have 2, raw
      // hex tokens have none). Skip the DB lookup for JWTs; the Gideon-JWT
      // path in the guard handles those. The shape check runs on the RAW
      // value: unsignedSessionToken() strips the `.signature` suffix, which
      // would turn a JWT into a 2-segment string and defeat the check.
      if (raw && raw.split('.').length !== 3) {
        const token = unsignedSessionToken(raw);
        if (token) candidates.push(token);
      }
    }
    return candidates;
  }

  private async resolveToken(
    token: string,
  ): Promise<NativeSessionResult | null> {
    let session: {
      id: string;
      expiresAt: Date;
      activeOrganizationId: string | null;
      deviceAgent: boolean | null;
      user: { id: string; email: string };
    } | null;
    try {
      session = await db.session.findUnique({
        where: { token },
        select: {
          id: true,
          expiresAt: true,
          activeOrganizationId: true,
          deviceAgent: true,
          user: { select: { id: true, email: true } },
        },
      });
    } catch (error) {
      this.logger.warn(
        `Native session lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    if (await this.legacyRevocation.rejectsSession(session.id)) {
      this.logger.warn(
        `Rejected legacy impersonation session ${session.id} — revocation pending column drop`,
      );
      return null;
    }
    return {
      user: session.user,
      session: {
        id: session.id,
        activeOrganizationId: session.activeOrganizationId,
        deviceAgent: session.deviceAgent === true,
        expiresAt: session.expiresAt,
      },
    };
  }
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
