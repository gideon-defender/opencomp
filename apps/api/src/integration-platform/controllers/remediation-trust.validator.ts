import type { Logger } from '@nestjs/common';
import { AssumeRoleCommand, type STSClient } from '@aws-sdk/client-sts';

/**
 * Prove every remediation role (legacy single ARN plus per-pair map
 * entries) is assumable with the External ID and NOT assumable without
 * it. Returns an error message for the first failing role, or null when
 * all pass. An empty list passes trivially (no remediation configured).
 */
export async function validateRemediationRoleTrust(params: {
  roleAssumerSts: STSClient;
  roleArns: string[];
  externalId: string;
  logger: Pick<Logger, 'log'>;
}): Promise<string | null> {
  const { roleAssumerSts, roleArns, externalId, logger } = params;
  for (const remediationRoleArn of roleArns) {
    logger.log(
      `Validating AWS: Assuming remediation role ${remediationRoleArn}...`,
    );
    const remediationResp = await roleAssumerSts.send(
      new AssumeRoleCommand({
        RoleArn: remediationRoleArn,
        ExternalId: externalId,
        RoleSessionName: 'CompValidation',
        DurationSeconds: 900,
      }),
    );
    if (
      !remediationResp.Credentials?.AccessKeyId ||
      !remediationResp.Credentials.SecretAccessKey
    ) {
      throw new Error(
        `Failed to assume remediation role ${remediationRoleArn} - no credentials returned`,
      );
    }

    let externalIdEnforced = false;
    try {
      await roleAssumerSts.send(
        new AssumeRoleCommand({
          RoleArn: remediationRoleArn,
          RoleSessionName: 'CompValidation-NoExtId',
          DurationSeconds: 900,
        }),
      );
    } catch (err) {
      // Only an auth rejection proves the trust policy requires the
      // External ID. Anything else (network, throttling) is
      // inconclusive — rethrow so validation fails visibly instead of
      // wrongly certifying an open trust policy.
      const msg = err instanceof Error ? err.message : String(err);
      if (
        /AccessDenied|Unauthorized|InvalidClientTokenId|SignatureDoesNotMatch|not authorized/i.test(
          msg,
        )
      ) {
        externalIdEnforced = true;
      } else {
        throw err;
      }
    }
    if (!externalIdEnforced) {
      return `Remediation role ${remediationRoleArn} trust policy does not require the External ID (assume succeeded without it). Add a StringEquals sts:ExternalId condition to the role trust policy and try again.`;
    }
    logger.log(
      'Validating AWS: Remediation role assumption + ExternalId enforcement successful',
    );
  }
  return null;
}
