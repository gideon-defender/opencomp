import { describe, expect, it } from 'vitest';
import {
  buildGcpAlertingPolicy,
  buildGcpApprovalGatedFilter,
  buildGcpDeniedFilter,
  buildGcpDetectionFilter,
  buildGcpImpersonationFilter,
  GCP_REMEDIATION_DETECTION_CHANNEL_NAME,
  GCP_REMEDIATION_DETECTION_DESCRIPTIONS,
  GCP_REMEDIATION_DETECTION_METRICS,
  GCP_REMEDIATION_DETECTION_RULES,
  GCP_REMEDIATION_LOG_QUERIES,
  getGcpRemediationDetectionScript,
  type GcpRemediationDetectionRule,
} from '../remediation-detection';

describe('gcp impersonation filter', () => {
  it('matches generateAccessToken on remediator SAs by target, not caller', () => {
    const filter = buildGcpImpersonationFilter();
    expect(filter).toContain('protoPayload.serviceName="iamcredentials.googleapis.com"');
    expect(filter).toContain('protoPayload.methodName="GenerateAccessToken"');
    expect(filter).toContain('protoPayload.resourceName:"opencomp-remediator@"');
  });

  it('does not match on the caller principal (the backend impersonator email is customer-specific)', () => {
    // The principal minting the token is the backend impersonator SA, whose
    // email this module cannot know — matching principalEmail here would
    // silently drop every alert.
    expect(buildGcpImpersonationFilter()).not.toContain('principalEmail');
  });

  it('does not match routine reads or fixes on other services', () => {
    const filter = buildGcpImpersonationFilter();
    expect(filter).not.toContain('storage.googleapis.com');
    expect(filter).not.toContain('compute.googleapis.com');
  });
});

describe('gcp denied filter', () => {
  it('matches PERMISSION_DENIED from a remediator SA without a service filter', () => {
    const filter = buildGcpDeniedFilter();
    expect(filter).toContain(
      'protoPayload.authenticationInfo.principalEmail:"opencomp-remediator@"',
    );
    expect(filter).toContain('protoPayload.status.code=7');
    // Denied calls arrive under the *called* service — scoping to one
    // service would miss most hits, so the filter must not set it.
    expect(filter).not.toContain('protoPayload.serviceName');
  });

  it('uses the numeric enum (a quoted "7" would compare as a string and never match)', () => {
    expect(buildGcpDeniedFilter()).not.toContain('code="7"');
  });
});

describe('gcp approval-gated filter', () => {
  it('matches remediator writes to IAM, KMS, org policy, DNS, firewalls, routes', () => {
    const filter = buildGcpApprovalGatedFilter();
    expect(filter).toContain(
      'protoPayload.authenticationInfo.principalEmail:"opencomp-remediator@"',
    );
    for (const fragment of [
      'protoPayload.serviceName="iam.googleapis.com"',
      'protoPayload.serviceName="cloudkms.googleapis.com"',
      'protoPayload.serviceName="orgpolicy.googleapis.com"',
      'protoPayload.serviceName="dns.googleapis.com"',
      'protoPayload.methodName:"firewalls"',
      'protoPayload.methodName:"routes"',
      'protoPayload.methodName:"IamPolicy"',
    ]) {
      expect(filter).toContain(fragment);
    }
  });

  it('excludes routine auto-fix surfaces so normal fixes never page', () => {
    const filter = buildGcpApprovalGatedFilter();
    // Storage, SQL, Pub/Sub, BigQuery, and Compute instances auto-execute —
    // matching them here would alert on every legitimate fix.
    for (const fragment of ['storage.googleapis.com', 'sqladmin', 'pubsub', 'bigquery']) {
      expect(filter).not.toContain(fragment);
    }
  });
});

describe('buildGcpDetectionFilter', () => {
  it('dispatches all three rules', () => {
    expect(buildGcpDetectionFilter({ rule: 'OpenComp-RemediatorImpersonate' })).toBe(
      buildGcpImpersonationFilter(),
    );
    expect(buildGcpDetectionFilter({ rule: 'OpenComp-RemediatorDenied' })).toBe(
      buildGcpDeniedFilter(),
    );
    expect(buildGcpDetectionFilter({ rule: 'OpenComp-RemediatorApprovalGated' })).toBe(
      buildGcpApprovalGatedFilter(),
    );
  });

  it('rejects unknown rules instead of emitting an empty filter', () => {
    expect(() =>
      buildGcpDetectionFilter({ rule: 'OpenComp-RemediatorEvil' as GcpRemediationDetectionRule }),
    ).toThrow(/unknown GCP remediation detection rule/);
  });
});

describe('gcp alerting policy', () => {
  it('fires on any match and references the run-time channel', () => {
    const policy = buildGcpAlertingPolicy({ rule: 'OpenComp-RemediatorDenied' });
    expect(policy.displayName).toBe('OpenComp-RemediatorDenied');
    expect(policy.notificationChannels).toEqual(['$CHANNEL_ID']);
    const condition = (
      policy.conditions as Array<{ conditionThreshold: Record<string, unknown> }>
    )[0].conditionThreshold;
    expect(condition.comparison).toBe('COMPARISON_GT');
    expect(condition.thresholdValue).toBe(0);
    expect(condition.filter).toContain(
      'metric.type="logging.googleapis.com/user/opencomp-remediator-denied"',
    );
  });

  it('uses a distinct metric per rule', () => {
    const filters = GCP_REMEDIATION_DETECTION_RULES.map(
      (rule) =>
        (
          buildGcpAlertingPolicy({ rule }).conditions as Array<{
            conditionThreshold: { filter: string };
          }>
        )[0].conditionThreshold.filter,
    );
    expect(new Set(filters).size).toBe(GCP_REMEDIATION_DETECTION_RULES.length);
    expect(GCP_REMEDIATION_DETECTION_METRICS['OpenComp-RemediatorImpersonate']).toBe(
      'opencomp-remediator-impersonate',
    );
  });

  it('is valid monitoring JSON (no functions, no undefined)', () => {
    for (const rule of GCP_REMEDIATION_DETECTION_RULES) {
      expect(() => JSON.stringify(buildGcpAlertingPolicy({ rule }))).not.toThrow();
    }
  });

  it('rejects unknown rules', () => {
    expect(() => buildGcpAlertingPolicy({ rule: 'nope' as GcpRemediationDetectionRule })).toThrow(
      /unknown GCP remediation detection rule/,
    );
  });
});

describe('gcp remediation log queries', () => {
  it('ships one query per signal with a remediator-scoped filter', () => {
    expect(GCP_REMEDIATION_LOG_QUERIES).toHaveLength(3);
    for (const query of GCP_REMEDIATION_LOG_QUERIES) {
      expect(query.name).toMatch(/^gcp-/);
      expect(query.description.length).toBeGreaterThan(0);
      expect(query.filter).toContain('opencomp-remediator@');
    }
  });

  it('keeps queries and alert filters in agreement (no drift)', () => {
    const byName = Object.fromEntries(GCP_REMEDIATION_LOG_QUERIES.map((q) => [q.name, q.filter]));
    expect(byName['gcp-remediator-impersonations']).toBe(buildGcpImpersonationFilter());
    expect(byName['gcp-remediator-denied']).toBe(buildGcpDeniedFilter());
    expect(byName['gcp-remediator-approval-gated']).toBe(buildGcpApprovalGatedFilter());
  });
});

describe('getGcpRemediationDetectionScript', () => {
  const options = { projectId: 'my-proj-123', email: 'security@example.com' };

  it('wires channel, metrics, and policies for the project', () => {
    const script = getGcpRemediationDetectionScript(options);
    expect(script).toContain('PROJECT="my-proj-123"');
    expect(script).toContain('gcloud beta monitoring channels create');
    expect(script).toContain('email_address="security@example.com"');
    for (const metric of Object.values(GCP_REMEDIATION_DETECTION_METRICS)) {
      expect(script).toContain(`gcloud logging metrics update ${metric}`);
    }
    expect(script.match(/gcloud alpha monitoring policies create/g)).toHaveLength(3);
    expect(script).toContain('$CHANNEL_ID');
  });

  it('is rerun-safe (metrics update, never create)', () => {
    // `metrics create` fails on an existing metric and `set -euo pipefail`
    // would abort the rerun midway; `update` creates when missing.
    const script = getGcpRemediationDetectionScript(options);
    expect(script).not.toContain('gcloud logging metrics create');
  });

  it('enables Data Access audit logs for the IAM API before the metrics', () => {
    // GenerateAccessToken emits a Data Access log, off by default — without
    // this step the impersonation metric stays empty on default projects.
    const script = getGcpRemediationDetectionScript(options);
    expect(script).toContain('auditConfigs');
    expect(script).toContain('ADMIN_READ');
    expect(script).toContain('iam.googleapis.com');
    const auditPos = script.indexOf('auditConfigs');
    const metricsPos = script.indexOf('gcloud logging metrics update');
    expect(auditPos).toBeGreaterThan(-1);
    expect(auditPos).toBeLessThan(metricsPos);
  });

  it('rejects invalid project ids instead of emitting a broken script', () => {
    expect(() =>
      getGcpRemediationDetectionScript({ projectId: 'BAD PROJECT"; evil #', email: 'a@b.c' }),
    ).toThrow(/valid GCP project id/);
  });

  it('escapes the email for the double-quoted shell string', () => {
    const script = getGcpRemediationDetectionScript({
      projectId: 'my-proj-123',
      email: 'a"b$(evil)`c@example.com',
    });
    expect(script).toContain('email_address="a\\"b\\$(evil)\\`c@example.com"');
  });

  it('covers every rule with a description', () => {
    expect(Object.keys(GCP_REMEDIATION_DETECTION_DESCRIPTIONS).sort()).toEqual(
      [...GCP_REMEDIATION_DETECTION_RULES].sort(),
    );
    expect(GCP_REMEDIATION_DETECTION_CHANNEL_NAME).toBe('OpenComp Remediator Alerts');
  });
});
