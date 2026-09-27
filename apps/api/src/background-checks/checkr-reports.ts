import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { withErrorCode } from '../common/i18n/error-messages';
import {
  identityCreateResponseSchema,
  type IdentityCreateResponse,
} from './background-checks.types';
import { CheckrHttp } from './checkr.http';
import { toCreateStatus } from './checkr-create-status';
import { isRecord, parseInvitationReportId } from './checkr.utils';

/** Upper bound on 409-recovery search pages; an empty page stops early. */
const MAX_CANDIDATE_SEARCH_PAGES = 5;

/** Normalize the candidate search payload (array or `{ data: [...] }`). */
function toCandidateList(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (isRecord(json) && Array.isArray(json.data)) return json.data;
  return [];
}

/**
 * Read path for the Checkr API (report/invitation fetches, pointer
 * resolution, 409 duplicate recovery) plus the direct-report creation
 * fallback. Separated from CheckrClient to keep both files under the
 * 300-line limit.
 */
export class CheckrReportsReader extends CheckrHttp {
  async getReport(reportId: string): Promise<unknown> {
    if (!reportId) return null;
    // Fail loudly on missing config: returning null would read as "no
    // report yet" and commit terminal rows with no snapshot. Callers that
    // tolerate absence (getById, reconcile) pre-check the key themselves.
    this.apiKey();

    const res = await this.fetchCheckr(
      `/v1/reports/${encodeURIComponent(reportId)}`,
      {
        headers: { Authorization: this.authHeader() },
      },
    );

    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      this.logger.error('Checkr report lookup rejected', {
        status: res.status,
      });
      throw withErrorCode(
        new UnauthorizedException('Checkr credentials are invalid.'),
        'CHECKR_CREDENTIALS_INVALID',
      );
    }
    if (!res.ok) {
      // Transient vendor errors (500/429) are not fatal: callers treat
      // a null report as "nothing to apply yet" and back off via
      // lastSyncedAt instead of 400ing reads and manual syncs.
      this.logger.warn('Checkr getReport failed', {
        reportId,
        status: res.status,
      });
      return null;
    }

    return this.readJson(res);
  }

  /** Fetch a Checkr invitation (null when missing; throws when misconfigured). */
  async getInvitation(invitationId: string): Promise<unknown> {
    if (!invitationId) return null;
    this.apiKey();

    const res = await this.fetchCheckr(
      `/v1/invitations/${encodeURIComponent(invitationId)}`,
      {
        headers: { Authorization: this.authHeader() },
      },
    );

    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      this.logger.error('Checkr invitation lookup rejected', {
        status: res.status,
      });
      throw withErrorCode(
        new UnauthorizedException('Checkr credentials are invalid.'),
        'CHECKR_CREDENTIALS_INVALID',
      );
    }
    if (!res.ok) {
      this.logger.warn('Checkr getInvitation failed', {
        invitationId,
        status: res.status,
      });
      return null;
    }
    return this.readJson(res);
  }

  /**
   * Find a candidate by email for the 409 duplicate path. Checkr shares
   * candidate ids across organizations for the same email, so a search can
   * return several rows: scan every hit on every page for an exact email
   * match instead of trusting position zero. Auth problems surface as-is
   * so the caller never masks them as "lookup found nothing".
   */
  protected async findCandidateByEmail(email: string): Promise<unknown> {
    const wanted = email.trim().toLowerCase();
    for (let page = 1; page <= MAX_CANDIDATE_SEARCH_PAGES; page += 1) {
      const res = await this.fetchCheckr(
        `/v1/candidates?email=${encodeURIComponent(email)}&page=${page}&per_page=100`,
        {
          headers: { Authorization: this.authHeader() },
        },
      );
      if (res.status === 401 || res.status === 403) {
        this.logger.error('Checkr candidate lookup rejected', {
          status: res.status,
        });
        throw withErrorCode(
          new UnauthorizedException('Checkr credentials are invalid.'),
          'CHECKR_CREDENTIALS_INVALID',
        );
      }
      if (!res.ok) {
        this.throwForTransientFailure(res, 'find-candidate-by-email');
        this.logger.error('Checkr candidate lookup failed', {
          status: res.status,
        });
        throw new BadRequestException('Checkr candidate lookup failed.');
      }
      const items = toCandidateList(await this.readJson(res));
      for (const item of items) {
        if (
          isRecord(item) &&
          typeof item.email === 'string' &&
          item.email.trim().toLowerCase() === wanted
        ) {
          return item;
        }
      }
      // An empty page ends the search; a full page without a match may
      // still hide the candidate on the next one.
      if (items.length === 0) return null;
    }
    return null;
  }

  /**
   * Resolve the fetchable report for a row whose stored pointer may still
   * be an invitation id. Returns the report plus the id it was fetched
   * with, so callers can graduate a stale pointer.
   */
  async resolveReport({
    reportId,
    invitationId,
  }: {
    reportId: string;
    invitationId?: string | null;
  }): Promise<{ report: unknown; reportId: string }> {
    const report = await this.getReport(reportId);
    if (report) return { report, reportId };

    // The pointer is not a fetchable report yet — usually an invitation id
    // stored at creation. Ask the invitation whether a report exists now.
    if (invitationId) {
      const invitation = await this.getInvitation(invitationId);
      const graduatedId = parseInvitationReportId(invitation);
      if (graduatedId) {
        const graduated = await this.getReport(graduatedId);
        if (graduated) return { report: graduated, reportId: graduatedId };
      }
    }
    return { report: null, reportId };
  }

  /**
   * Fallback creation path: direct report when the invitations endpoint
   * itself is unavailable. Lives here (not on the client) so the creation
   * flow stays under the 300-line limit.
   */
  protected async createDirectReport({
    candidateId,
    pkg,
    idempotencyKey,
    invitationStatus,
  }: {
    candidateId: string;
    pkg: string;
    idempotencyKey: string;
    invitationStatus: number;
  }): Promise<IdentityCreateResponse> {
    const reportRes = await this.fetchCheckr('/v1/reports', {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        candidate_id: candidateId,
        package: pkg,
      }),
    });

    const reportJson = await this.readJson(reportRes);
    if (!reportRes.ok) {
      this.throwForTransientFailure(reportRes, 'create-report');
      // Auth failures surface as-is, mirroring the candidate and
      // invitation paths: a revoked key must read 401, not mask as a 400.
      if (reportRes.status === 401 || reportRes.status === 403) {
        this.logger.error('Checkr report creation rejected', {
          status: reportRes.status,
        });
        throw withErrorCode(
          new UnauthorizedException('Checkr credentials are invalid.'),
          'CHECKR_CREDENTIALS_INVALID',
        );
      }
      this.logger.error('Checkr create report/invitation failed', {
        invitationStatus,
        reportStatus: reportRes.status,
      });
      throw new BadRequestException('Checkr report creation failed.');
    }

    if (!isRecord(reportJson)) {
      this.logger.error(
        'Checkr report creation returned an unreadable payload',
        {
          reportStatus: reportRes.status,
        },
      );
      throw new BadRequestException('Checkr report creation failed.');
    }
    const report = reportJson as {
      id?: string;
      status?: string;
      adjudication?: string;
      candidate_id?: string;
    };
    if (typeof report.id !== 'string' || !report.id) {
      this.logger.error('Checkr report creation returned no id', {
        reportStatus: reportRes.status,
      });
      throw new BadRequestException('Checkr report creation failed.');
    }
    return identityCreateResponseSchema.parse({
      id: report.id,
      status: toCreateStatus(report),
      candidateUrl: null,
      candidateId,
      invitationId: null,
    });
  }
}
