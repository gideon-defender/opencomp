import { Injectable, Logger } from '@nestjs/common';
import { db } from '@db';

export interface PlatformOperationsComparison {
  tenantId: string;
  gideon: unknown;
  opencomp: unknown;
  mismatched: boolean;
  details?: string;
}

/**
 * Phase 0 — Read-only shadow for `GET /v1/platform/tenants/:id/operations`
 * (auth/README.md:203). Calls Gideon Auth's platform operations endpoint
 * with the validated Gideon JWT, compares with opencomp's local
 * organization projection, and logs mismatches without failing the request.
 *
 * Behind flag `GIDEON_SHADOW_ENABLED` (default: shadow when Gideon JWT is
 * configured). Never throws — shadow failures are logged at debug.
 */
@Injectable()
export class GideonShadowService {
  private readonly logger = new Logger(GideonShadowService.name);

  private get enabled(): boolean {
    if (process.env.GIDEON_SHADOW_ENABLED === 'true') return true;
    if (process.env.GIDEON_SHADOW_ENABLED === 'false') return false;
    // Phase 0 default: shadow when Gideon is configured
    return !!(
      process.env.GIDEON_IDENTITY_URL || process.env.AUTH__IDENTITY_URL
    );
  }

  private get identityUrl(): string | null {
    return (
      process.env.GIDEON_IDENTITY_URL || process.env.AUTH__IDENTITY_URL || null
    );
  }

  private get internalToken(): string | null {
    return (
      process.env.GIDEON_INTERNAL_SERVICE_TOKEN ||
      process.env.INTERNAL_SERVICE_TOKEN ||
      null
    );
  }

  /**
   * Fetch Gideon tenant operations and compare with opencomp.
   * Call from HybridAuthGuard after successful Gideon JWT auth (shadow).
   */
  async logTenantOperationsMismatch(
    tenantId: string,
    gideonToken: string,
  ): Promise<void> {
    if (!this.enabled) return;
    if (!tenantId) return;
    const base = this.identityUrl;
    if (!base) return;

    try {
      const url = `${base.replace(/\/$/, '')}/v1/platform/tenants/${encodeURIComponent(tenantId)}/operations`;
      if (!gideonToken && !this.internalToken) {
        this.logger.debug(
          `[GideonShadow] skip tenant operations fetch tid=${tenantId}: no token (shadow, non-fatal)`,
        );
        return;
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${gideonToken || this.internalToken}`,
        'Content-Type': 'application/json',
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      let gideonData: unknown = null;
      try {
        const res = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        if (res.ok) {
          gideonData = await res.json().catch(() => null);
        } else {
          this.logger.debug(
            `[GideonShadow] /platform/tenants/${tenantId}/operations -> ${res.status} (shadow, non-fatal)`,
          );
          return;
        }
      } finally {
        clearTimeout(timeout);
      }

      // OpenComp local projection for same tenant. Tenant is the org:
      // the tid IS the organization id.
      const opencompOrg = await db.organization
        .findUnique({
          where: { id: tenantId },
          select: {
            id: true,
            name: true,
            createdAt: true,
          },
        })
        .catch(() => null);

      const hasMembers = opencompOrg
        ? await db.member
            .findFirst({
              where: { organizationId: opencompOrg.id },
              select: { id: true },
            })
            .then((m) => !!m)
            .catch(() => false)
        : false;

      const opencompData = opencompOrg
        ? { id: opencompOrg.id, name: opencompOrg.name, hasMembers }
        : null;

      // Compare: if Gideon returns tenant but opencomp has no org, or names differ, log
      const gideonAny = gideonData as Record<string, unknown> | null;
      const gideonTenantName =
        (gideonAny?.tenant as Record<string, unknown>)?.name ||
        (gideonAny as Record<string, unknown>)?.name ||
        null;

      const mismatched =
        (!opencompData && !!gideonData) ||
        (!!opencompData &&
          !!gideonTenantName &&
          opencompData.name !== gideonTenantName);

      if (mismatched) {
        this.logger.warn(
          `[GideonShadow] tenant operations mismatch tid=${tenantId} gideonName=${gideonTenantName == null ? 'n/a' : typeof gideonTenantName === 'string' ? gideonTenantName : JSON.stringify(gideonTenantName)} opencompName=${String(opencompData?.name ?? 'n/a')} hasMembers=${String(opencompData?.hasMembers ?? false)}`,
        );
      } else {
        this.logger.debug(
          `[GideonShadow] tenant operations match tid=${tenantId}`,
        );
      }
    } catch (error) {
      this.logger.debug(
        `[GideonShadow] tenant operations fetch failed tid=${tenantId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Generic helper to log any shadow comparison without throwing.
   */
  logMismatch(context: string, details: Record<string, unknown>): void {
    if (!this.enabled) return;
    this.logger.warn(`[GideonShadow] ${context} ${JSON.stringify(details)}`);
  }
}
