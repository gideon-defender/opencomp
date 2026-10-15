import {
  Controller,
  ForbiddenException,
  Get,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { db } from '@db';
import { authorizeBootstrapSession } from './gideon-bootstrap-authorization';
import { HybridAuthGuard } from './hybrid-auth.guard';
import { SessionOnlyGuard } from './session-only.guard';
import { SkipOrgCheck } from './skip-org-check.decorator';
import type { AuthenticatedRequest } from './types';

// Pre-organization authorization uses verified login proof instead of a Member role.
@ApiExcludeController()
@Controller({ path: 'auth/gideon', version: '1' })
@UseGuards(HybridAuthGuard, SessionOnlyGuard)
export class GideonBootstrapController {
  @Get('bootstrap')
  @SkipOrgCheck()
  @ApiOperation({
    summary: 'Authorize organization setup',
    description:
      'Checks the browser session and tenant-bound owner proof before organization setup.',
  })
  async authorize(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ tenantId: string }> {
    if (!request.sessionId || !request.userId) {
      throw new UnauthorizedException(
        'A browser session is required for organization setup.',
      );
    }
    const user = await db.user.findUnique({
      where: { id: request.userId },
      select: { tenantId: true, oidcTenantId: true },
    });
    const tenantId = user?.tenantId ?? user?.oidcTenantId;
    if (!user || !tenantId) {
      throw new ForbiddenException(
        'Sign in with Gideon before creating an organization.',
      );
    }
    if (!user.tenantId) {
      // Expand-window row predating the tenant backfill: claim the legacy
      // login stamp (backfill rule 3c) instead of blocking setup until the
      // next login. Post-contract rows are never null, so this write runs
      // only inside the window.
      await db.user.update({
        where: { id: request.userId },
        data: { tenantId },
      });
    }
    await authorizeBootstrapSession({
      sessionId: request.sessionId,
      userId: request.userId,
      tenantId,
    });
    return { tenantId };
  }
}
