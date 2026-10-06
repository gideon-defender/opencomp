/**
 * Provisioning and destructive-write guardrails for GCP hosts without a
 * dedicated parameter validator (KMS, DNS, monitoring, BigQuery).
 *
 * The class allowlist grants method+prefix over whole APIs, but on these
 * hosts every create is provisioning and every delete is destructive —
 * neither is ever an exposure fix. Creating keys, zones, alert policies,
 * or datasets provisions instead of repairing; deleting them destroys data
 * the finding never owned. PATCH repairs (dataset access removal, DNSSEC
 * enablement) stay allowed, but a PATCH that weakens posture without
 * touching grants sails past the generic public-grant backstop — so the
 * known-weakening PATCH shapes refuse here. Every rejection routes the
 * plan to guided-only, never to execution.
 */
import { asRecord } from './gcp-remediation-validator-shared';

const PROVISIONING_GUARDED_HOSTS: readonly string[] = [
  'cloudkms.googleapis.com',
  'dns.googleapis.com',
  'monitoring.googleapis.com',
  'bigquery.googleapis.com',
];

/** True when the host has no dedicated validator and needs this gate. */
export function isProvisioningGuardedHost(hostname: string): boolean {
  return PROVISIONING_GUARDED_HOSTS.includes(hostname);
}

/**
 * Refuse creates and deletes on hosts without a dedicated validator, plus
 * posture-weakening PATCH shapes the generic grant backstop cannot see.
 * Rollback replays of a reviewed creation skip the create refusal:
 * replaying is constrained by prior-state comparison
 * (`validatePostRollback`), not by the fix-flow gates — the same
 * exemption the Pub/Sub provisioning refusal carries. Rollback PATCH
 * shapes skip the weakening check for the same reason: `validatePatchRollback`
 * already constrains them to prior-equal masked fields. DELETE stays
 * refused on both paths: a rollback DELETE must remove something a fix
 * created, and no valid fix on these hosts creates anything to remove.
 */
export function validateGcpProvisioningWrite(args: {
  method: string;
  prefix: string;
  hostname?: string;
  body?: Record<string, unknown>;
  isRollback?: boolean;
}): string[] {
  if (args.method === 'POST' || args.method === 'PUT') {
    if (args.isRollback) return [];
    return [
      `${args.prefix}: creating resources is provisioning, not remediation — refused for safety`,
    ];
  }
  if (args.method === 'DELETE') {
    return [
      `${args.prefix}: deleting resources is destructive, it never fixes an exposure — refused for safety`,
    ];
  }
  if (args.method === 'PATCH' && !args.isRollback) {
    return validateProvisioningPatchWeakening({
      hostname: args.hostname ?? '',
      body: args.body,
      prefix: args.prefix,
    });
  }
  return [];
}

/**
 * PATCH repairs stay allowed — but a PATCH that weakens posture without
 * touching grants never trips the generic public-grant backstop, so the
 * known-weakening shapes refuse here: DNSSEC off, KMS rotation removal,
 * alert-policy disablement, dataset encryption removal. Each has a
 * repair-direction counterpart (DNSSEC on, rotation set, policy enabled)
 * that keeps passing.
 */
function validateProvisioningPatchWeakening(args: {
  hostname: string;
  body: Record<string, unknown> | undefined;
  prefix: string;
}): string[] {
  const body = args.body;
  if (!body) return [];
  if (args.hostname === 'dns.googleapis.com') {
    // A null message field clears the config under PATCH merge semantics —
    // the same posture loss as `state: 'off'`, under a spelling the old
    // string-only check missed.
    if (body.dnssecConfig === null) {
      return [
        `${args.prefix}: clearing dnssecConfig disables DNSSEC, it never fixes an exposure — refused for safety`,
      ];
    }
    const dnssec = asRecord(body.dnssecConfig);
    const state =
      dnssec && typeof dnssec.state === 'string'
        ? dnssec.state.toLowerCase()
        : '';
    if (state === 'off') {
      return [
        `${args.prefix}: disabling DNSSEC weakens posture, it never fixes an exposure — refused for safety`,
      ];
    }
    return [];
  }
  if (args.hostname === 'cloudkms.googleapis.com') {
    const stripsRotation =
      ('rotationPeriod' in body &&
        (body.rotationPeriod === null || body.rotationPeriod === '')) ||
      ('rotationSchedule' in body &&
        (body.rotationSchedule === null || body.rotationSchedule === ''));
    if (stripsRotation) {
      return [
        `${args.prefix}: removing key rotation weakens posture, it never fixes an exposure — refused for safety`,
      ];
    }
    return [];
  }
  if (args.hostname === 'monitoring.googleapis.com') {
    if (body.enabled === false) {
      return [
        `${args.prefix}: disabling an alert policy silences detection, it never fixes an exposure — refused for safety`,
      ];
    }
    return [];
  }
  if (args.hostname === 'bigquery.googleapis.com') {
    if (
      'defaultEncryptionConfiguration' in body &&
      body.defaultEncryptionConfiguration === null
    ) {
      return [
        `${args.prefix}: removing dataset encryption weakens posture, it never fixes an exposure — refused for safety`,
      ];
    }
    return [];
  }
  return [];
}
