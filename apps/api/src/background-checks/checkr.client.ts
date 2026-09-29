import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  identityCreateResponseSchema,
  type IdentityCreateResponse,
} from './background-checks.types';
import { CheckrReportsReader } from './checkr-reports';
import { toCreateStatus } from './checkr-create-status';
import { isRecord, splitName } from './checkr.utils';
import { withErrorCode } from '../common/i18n/error-messages';

@Injectable()
export class CheckrClient extends CheckrReportsReader {
  private checkrPackage(): string {
    const pkg = process.env.CHECKR_PACKAGE?.trim();
    if (!pkg) {
      throw new BadRequestException(
        'Checkr package is not configured. Set CHECKR_PACKAGE.',
      );
    }
    return pkg;
  }

  /**
   * Fail fast before any charge or vendor write. Called by the service
   * before it claims the record slot so a misconfigured environment can
   * never leave a charged, half-created check behind.
   */
  assertConfigured(): void {
    this.apiKey();
    this.checkrPackage();
  }

  /**
   * Validate employee input before any charge or vendor write. Checkr
   * rejects candidates without a last name, so a mononym must 400 here —
   * not after Stripe and Checkr objects already exist.
   */
  assertCreatableInput(params: {
    employeeName: string;
    employeeEmail: string;
  }): void {
    const { first_name, last_name } = splitName(params.employeeName);
    if (!first_name || !last_name) {
      throw new BadRequestException(
        'Employee name must include a first and last name for a background check.',
      );
    }
    if (!params.employeeEmail?.trim()) {
      throw new BadRequestException('Employee email is required.');
    }
  }

  async createBackgroundCheck(params: {
    organizationId: string;
    memberId: string;
    employeeName: string;
    employeeEmail: string;
    idempotencyKey: string;
  }): Promise<IdentityCreateResponse> {
    const { first_name, last_name } = splitName(params.employeeName);
    const pkg = this.checkrPackage();

    // 1. Create candidate
    const candidateRes = await this.fetchCheckr('/v1/candidates', {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify({
        email: params.employeeEmail,
        first_name,
        last_name,
        metadata: {
          compOrganizationId: params.organizationId,
          compMemberId: params.memberId,
          rerunCount: params.idempotencyKey,
        },
      }),
    });

    const candidateJson = await this.readJson(candidateRes);
    if (!candidateRes.ok) {
      // Handle duplicate candidate (409) by fetching existing
      if (candidateRes.status === 409) {
        const existing = await this.findCandidateByEmail(params.employeeEmail);
        // Never trust the search positionally: confirm the hit is the same
        // person before attaching a new report to their candidate record.
        const existingId =
          existing && typeof existing === 'object' && 'id' in existing
            ? existing.id
            : undefined;
        const existingEmail =
          existing && typeof existing === 'object' && 'email' in existing
            ? existing.email
            : undefined;
        if (
          typeof existingId === 'string' &&
          existingId &&
          typeof existingEmail === 'string' &&
          existingEmail.trim().toLowerCase() ===
            params.employeeEmail.trim().toLowerCase()
        ) {
          return this.createReportForCandidate({
            candidateId: existingId,
            pkg,
            idempotencyKey: params.idempotencyKey,
          });
        }
        throw new BadRequestException(
          'Checkr reported a duplicate candidate but the lookup returned no matching candidate.',
        );
      }
      this.throwForTransientFailure(candidateRes, 'create-candidate');
      // Auth failures surface as-is, mirroring the invitation path: a
      // revoked key must read 401, not mask as a 400 client error.
      if (candidateRes.status === 401 || candidateRes.status === 403) {
        this.logger.error('Checkr candidate creation rejected', {
          status: candidateRes.status,
        });
        throw withErrorCode(
          new UnauthorizedException('Checkr credentials are invalid.'),
          'CHECKR_CREDENTIALS_INVALID',
        );
      }
      this.logger.error('Checkr create candidate failed', {
        status: candidateRes.status,
      });
      throw new BadRequestException('Checkr candidate creation failed.');
    }

    const candidate = candidateJson as { id: string };
    if (!candidate?.id) {
      throw new BadRequestException(
        'Checkr candidate creation returned no id.',
      );
    }

    return this.createReportForCandidate({
      candidateId: candidate.id,
      pkg,
      idempotencyKey: params.idempotencyKey,
    });
  }

  private async createReportForCandidate({
    candidateId,
    pkg,
    idempotencyKey,
  }: {
    candidateId: string;
    pkg: string;
    idempotencyKey: string;
  }): Promise<IdentityCreateResponse> {
    // Prefer invitations (hosted flow) - Checkr recommends invitations for candidate-completed flow
    // Fall back to direct report if invitations not available for package
    const invitationRes = await this.fetchCheckr('/v1/invitations', {
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

    const invitationJson = await this.readJson(invitationRes);
    if (invitationRes.ok && isRecord(invitationJson)) {
      const inv = invitationJson as {
        id?: string;
        invitation_url?: string;
        report_id?: string;
        report?: { id: string };
        status?: string;
      };
      // An invitation without a report id means the candidate has not
      // completed the flow yet. Store the invitation id as the placeholder:
      // it is unique per request (unlike the candidate id, which Checkr
      // shares across organizations for the same email and can never
      // resolve back to this row), and invitation webhooks carry it in
      // data.id so they resolve on first lookup.
      // The pointer graduates to the report id via getInvitation recovery
      // (sync/reconcile) or the first report webhook.
      const attachedReportId = inv.report_id || inv.report?.id || null;
      const reportId = attachedReportId || inv.id;
      if (!reportId) {
        throw new BadRequestException('Checkr invitation returned no id.');
      }
      // A bare invitation is not a report: its lifecycle status (e.g.
      // `pending`) describes the hosted flow, not the check. Persist it as
      // `invited` — mapping it through the report lifecycle would land the
      // row in `in_progress` and strand it there, since the invitation-expiry
      // escapes in webhooks, sync, and retry only run on `invited` rows.
      const status = attachedReportId
        ? toCreateStatus(inv.report ?? invitationJson)
        : 'invited';
      return identityCreateResponseSchema.parse({
        id: reportId,
        status,
        candidateUrl: inv.invitation_url ?? null,
        candidateId,
        invitationId: inv.id ?? null,
      });
    }

    if (invitationRes.ok) {
      // A 200 with an unreadable body is a vendor anomaly, not a missing
      // invitation: fail loudly instead of issuing a second chargeable
      // vendor write for the same request.
      this.logger.error('Checkr invitation returned an unreadable payload', {
        status: invitationRes.status,
      });
      throw new BadRequestException('Checkr invitation failed.');
    }
    this.throwForTransientFailure(invitationRes, 'create-invitation');

    // Auth failures surface as-is: no second vendor write with a rejected key.
    if (invitationRes.status === 401 || invitationRes.status === 403) {
      this.logger.error('Checkr invitation rejected', {
        status: invitationRes.status,
      });
      throw withErrorCode(
        new UnauthorizedException('Checkr credentials are invalid.'),
        'CHECKR_CREDENTIALS_INVALID',
      );
    }

    // Fall back to direct report creation only when the invitations endpoint
    // itself is unavailable (404). Any other 4xx means the request was bad
    // (unknown package, invalid candidate): fail loudly instead of issuing
    // a second chargeable vendor write for a request already known-bad.
    if (invitationRes.status !== 404) {
      this.logger.error('Checkr invitation failed', {
        status: invitationRes.status,
      });
      throw new BadRequestException('Checkr invitation failed.');
    }

    // Fallback: direct report creation
    return this.createDirectReport({
      candidateId,
      pkg,
      idempotencyKey,
      invitationStatus: invitationRes.status,
    });
  }
}
