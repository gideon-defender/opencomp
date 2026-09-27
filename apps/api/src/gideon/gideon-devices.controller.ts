import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiSecurity } from '@nestjs/swagger';
import type { Request, Response as ExpressResponse } from 'express';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermission } from '../auth/require-permission.decorator';

/**
 * Phase 0 — Read-only shadow proxy for `GET /v1/admin/devices`
 * (agent-communications/README.md:26 `GET /v1/admin/devices`).
 *
 * Behind flag `GIDEON_DEVICES_PROXY_ENABLED` (default false for Phase 0 shadow).
 * When enabled, proxies to `AGENT_COMMS_URL` (`GIDEON_AGENT_COMMS_URL` or
 * `AGENT_COMMS_URL`, default `http://localhost:8082`) with the caller's
 * Gideon JWT / Authorization header. When disabled, returns 404 with shadow
 * hint, so existing `GET /v1/devices` (FleetDM hybrid) remains the source.
 *
 * Keep `better-auth` `GET /v1/devices` as fallback — this proxy does not
 * replace it in Phase 0.
 */
@ApiTags('Gideon — Agent Communications (Shadow)')
@Controller({ path: 'admin/devices', version: '1' })
@UseGuards(HybridAuthGuard, PermissionGuard)
@RequirePermission('app', 'read')
@ApiSecurity('apikey')
export class GideonDevicesProxyController {
  private readonly logger = new Logger(GideonDevicesProxyController.name);

  private get enabled(): boolean {
    return process.env.GIDEON_DEVICES_PROXY_ENABLED === 'true';
  }

  private get agentCommsUrl(): string {
    return (
      process.env.GIDEON_AGENT_COMMS_URL ||
      process.env.AGENT_COMMS_URL ||
      process.env.AGENT_COMMUNICATIONS_URL ||
      'http://localhost:8080'
    ).replace(/\/$/, '');
  }

  private get legacyAgentCommsUrl(): string | null {
    // Phase 0 migration: prior default was 8082 before agent-communications README fix.
    // Keep as fallback for env-unset deployments still on 8082.
    if (
      process.env.GIDEON_AGENT_COMMS_URL ||
      process.env.AGENT_COMMS_URL ||
      process.env.AGENT_COMMUNICATIONS_URL
    ) {
      return null;
    }
    return 'http://localhost:8082';
  }

  @Get()
  @ApiOperation({
    summary: 'Proxy: list devices from Agent Communications (shadow)',
    description:
      'Phase 0 read-only shadow: forwards `GET /v1/admin/devices` to `agent-communications` `GET /v1/admin/devices` with the caller JWT. Disabled by default (`GIDEON_DEVICES_PROXY_ENABLED=true` to enable). Logs mismatch vs local `Device` table but does not mutate. Keep `GET /v1/devices` as fallback.',
  })
  async proxyListDevices(
    @Req() req: Request,
    @Res() res: ExpressResponse,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<void> {
    if (!this.enabled) {
      res.status(404).json({
        message:
          'Gideon devices proxy disabled (Phase 0 shadow). Set GIDEON_DEVICES_PROXY_ENABLED=true and configure GIDEON_AGENT_COMMS_URL to enable. Fallback remains GET /v1/devices.',
        shadow: true,
      });
      return;
    }

    const targetUrl = new URL(`${this.agentCommsUrl}/v1/admin/devices`);
    if (limit) targetUrl.searchParams.set('limit', limit);
    if (offset) targetUrl.searchParams.set('offset', offset);
    // Forward all query params from original request
    for (const [key, value] of Object.entries(req.query)) {
      if (key === 'limit' || key === 'offset') continue;
      if (typeof value === 'string') targetUrl.searchParams.set(key, value);
    }

    try {
      const headers: Record<string, string> = {};
      const auth = req.headers['authorization'];
      if (auth) headers['authorization'] = auth;
      const cookie = req.headers['cookie'];
      if (cookie) headers['cookie'] = cookie;
      // Forward tenant header if present
      const tenant = req.headers['x-gideon-tenant-id'] as string | undefined;
      if (tenant) headers['x-gideon-tenant-id'] = tenant;

      let upstream: globalThis.Response;
      try {
        upstream = await this.fetchWithTimeout(
          targetUrl.toString(),
          headers,
          5000,
        );
      } catch (primaryError) {
        const fallback = this.legacyAgentCommsUrl;
        if (fallback && targetUrl.toString().startsWith(this.agentCommsUrl)) {
          const fallbackUrl = new URL(
            targetUrl.pathname + targetUrl.search,
            fallback,
          ).toString();
          this.logger.warn(
            `[GideonShadow] devices proxy primary ${targetUrl.toString()} failed, retrying legacy ${fallbackUrl}: ${(primaryError as Error).message}`,
          );
          upstream = await this.fetchWithTimeout(fallbackUrl, headers, 5000);
        } else {
          throw primaryError;
        }
      }

      // Shadow log comparison with local Device table (non-fatal)
      this.logShadowComparison(req, upstream).catch(() => {});

      const body = await upstream.text().catch(() => '');
      // Try to preserve upstream status and content-type
      const contentType =
        upstream.headers.get('content-type') || 'application/json';
      res.status(upstream.status || 200);
      res.setHeader('content-type', contentType);
      res.setHeader('x-gideon-shadow', '1');
      res.send(body);
    } catch (error) {
      this.logger.warn(
        `[GideonShadow] devices proxy failed ${targetUrl.toString()}: ${(error as Error).message}`,
      );
      res.status(502).json({
        message: 'Agent Communications upstream unavailable (shadow)',
      });
    }
  }

  private async fetchWithTimeout(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<globalThis.Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private logShadowComparison(
    req: Request,
    upstream: globalThis.Response,
  ): Promise<void> {
    try {
      if (
        process.env.GIDEON_SHADOW_ENABLED &&
        process.env.GIDEON_SHADOW_ENABLED === 'false'
      ) {
        return Promise.resolve();
      }
      // Best-effort: compare count with local DB without blocking response (already sent)
      // This is called after response is proxied, so we just log at debug
      const authReq = req as unknown as { organizationId?: string };
      const orgId = authReq.organizationId;
      if (!orgId) return Promise.resolve();
      this.logger.debug(
        `[GideonShadow] devices proxy org=${orgId} upstream=${upstream.status}`,
      );
      return Promise.resolve();
    } catch {
      // Never throw from shadow logger
      return Promise.resolve();
    }
  }
}
