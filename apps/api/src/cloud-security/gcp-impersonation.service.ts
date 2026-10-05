import { Injectable, Logger } from '@nestjs/common';

/**
 * Mints short-lived fix tokens for customer remediator service accounts
 * via `iamcredentials.generateAccessToken` (≤3600s).
 *
 * Separation-of-duties contract: the caller token is the BACKEND
 * impersonator identity (env `GCP_REMEDIATOR_IMPERSONATOR_SA` + runtime
 * credentials from workload identity / `GCP_IMPERSONATOR_ACCESS_TOKEN`),
 * never the end-user auditor OAuth token. Minted tokens live in memory
 * only and are never persisted.
 */
export interface MintedGcpToken {
  accessToken: string;
  /** Seconds until expiry as reported by IAM Credentials. */
  expiresInSeconds: number;
}

const MAX_TOKEN_LIFETIME_SECONDS = 3600;

@Injectable()
export class GcpImpersonationService {
  private readonly logger = new Logger(GcpImpersonationService.name);

  /**
   * Backend impersonator SA email (the only principal that may mint fix
   * tokens). Read from env so it can never arrive via client input.
   */
  getImpersonatorEmail(): string | undefined {
    const email = process.env.GCP_REMEDIATOR_IMPERSONATOR_SA?.trim();
    return email || undefined;
  }

  /**
   * Mint a short-lived access token for a remediator SA.
   * `callerToken` is the backend identity's own token; tests inject it
   * directly so no workload identity is needed.
   */
  async mintRemediatorToken(params: {
    saEmail: string;
    callerToken: string;
    scope?: string[];
    lifetimeSeconds?: number;
  }): Promise<MintedGcpToken> {
    const lifetimeSeconds = Math.min(
      params.lifetimeSeconds ?? MAX_TOKEN_LIFETIME_SECONDS,
      MAX_TOKEN_LIFETIME_SECONDS,
    );
    const endpoint = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(
      params.saEmail,
    )}:generateAccessToken`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.callerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scope: params.scope ?? [
          'https://www.googleapis.com/auth/cloud-platform',
        ],
        lifetime: `${lifetimeSeconds}s`,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Impersonation failed for ${params.saEmail} (${response.status}): ${body.slice(0, 300)}`,
      );
    }
    const data = (await response.json()) as {
      accessToken?: string;
      expireTime?: string;
    };
    if (!data.accessToken) {
      throw new Error(
        `Impersonation returned no access token for ${params.saEmail}`,
      );
    }
    this.logger.log(`Minted remediator token for ${params.saEmail}`);
    return {
      accessToken: data.accessToken,
      expiresInSeconds: lifetimeSeconds,
    };
  }

  /**
   * Resolve the backend caller token for impersonation. In production this
   * comes from workload identity via `GCP_IMPERSONATOR_ACCESS_TOKEN`
   * (sidecar/metadata-provided); tests pass the token explicitly instead.
   */
  resolveCallerToken(explicit?: string): string {
    const token = explicit ?? process.env.GCP_IMPERSONATOR_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        'GCP impersonation is not configured (missing caller credentials).',
      );
    }
    return token;
  }
}
