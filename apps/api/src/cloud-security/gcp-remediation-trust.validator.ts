import type { Logger } from '@nestjs/common';
import { GcpImpersonationService } from './gcp-impersonation.service';

/**
 * Prove every bound remediator SA is impersonable by the BACKEND identity
 * and NOT impersonable by the auditor (end-user OAuth) token. Returns an
 * error message for the first failing SA, or null when all pass. An empty
 * list passes trivially (no remediation configured).
 *
 * Mirrors `validateRemediationRoleTrust` for AWS: only an auth rejection on
 * the negative probe proves the trust is closed. Anything else (network,
 * throttling) is inconclusive — rethrow so validation fails visibly
 * instead of wrongly certifying an open trust.
 */
export async function validateGcpRemediationTrust(params: {
  saEmails: string[];
  auditorToken: string;
  impersonationService: GcpImpersonationService;
  backendCallerToken: string;
  logger: Pick<Logger, 'log'>;
}): Promise<string | null> {
  const {
    saEmails,
    auditorToken,
    impersonationService,
    backendCallerToken,
    logger,
  } = params;
  for (const saEmail of saEmails) {
    logger.log(`Validating GCP: impersonating remediator SA ${saEmail}...`);
    await impersonationService.mintRemediatorToken({
      saEmail,
      callerToken: backendCallerToken,
      lifetimeSeconds: 600,
    });

    let impersonationEnforced = false;
    try {
      await impersonationService.mintRemediatorToken({
        saEmail,
        callerToken: auditorToken,
        lifetimeSeconds: 600,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only an authorization denial proves the trust is closed. A 401
      // means the auditor token failed authentication (expired, revoked,
      // malformed) — the negative case was never exercised, so treating it
      // as proof would certify an open trust as closed. Rethrow so the
      // binding is refused visibly instead of stored unverified. The status
      // arrives embedded in the composed mint error ("... (401): ..."), so
      // match the parenthesized code, not a bare substring.
      if (/\(401\)|UNAUTHENTICATED|invalid_token|unauthenticated/i.test(msg)) {
        throw err;
      }
      if (
        /403|PERMISSION_DENIED|AccessDenied|not authorized|Forbidden/i.test(msg)
      ) {
        impersonationEnforced = true;
      } else {
        throw err;
      }
    }
    if (!impersonationEnforced) {
      return `Remediator SA ${saEmail} is impersonable by the auditor token (mint succeeded without backend identity). Grant roles/iam.serviceAccountTokenCreator to the backend impersonator only and try again.`;
    }
    logger.log(
      'Validating GCP: remediator SA impersonation + trust enforcement successful',
    );
  }
  return null;
}
