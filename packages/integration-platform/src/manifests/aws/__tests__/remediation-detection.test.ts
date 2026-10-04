import { describe, expect, it } from 'vitest';
import {
  buildDetectionPattern,
  buildRemediationAssumePattern,
  buildRemediationDeniedPattern,
  buildSecurityGlobalAssumePattern,
  getRemediationDetectionScript,
  REMEDIATION_DETECTION_RULES,
  REMEDIATION_DETECTION_SUBJECTS,
  REMEDIATION_DETECTION_TOPIC_NAME,
  REMEDIATION_LAKE_QUERIES,
  type RemediationDetectionRule,
} from '../remediation-detection';

const roleArnOf = (pattern: Record<string, unknown>): unknown[] => {
  const detail = pattern.detail as Record<string, unknown>;
  const params = detail.requestParameters as Record<string, unknown>;
  return params.roleArn as unknown[];
};

describe('remediation assume pattern', () => {
  it('matches AssumeRole on per-pair and legacy monolith roles', () => {
    const pattern = buildRemediationAssumePattern();
    expect(pattern.source).toEqual(['aws.sts']);
    const arns = roleArnOf(pattern).map((entry) => (entry as { wildcard: string }).wildcard);
    expect(arns).toContain('arn:aws:iam::*:role/OpenComp-Remediator');
    expect(arns).toContain('arn:aws:iam::*:role/OpenComp-Remediator-*');
  });

  it('uses the GovCloud partition when asked', () => {
    const arns = roleArnOf(buildRemediationAssumePattern({ partition: 'aws-us-gov' })).map(
      (entry) => (entry as { wildcard: string }).wildcard,
    );
    expect(arns).toEqual([
      'arn:aws-us-gov:iam::*:role/OpenComp-Remediator',
      'arn:aws-us-gov:iam::*:role/OpenComp-Remediator-*',
    ]);
  });

  it('is valid EventBridge JSON (no functions, no undefined)', () => {
    expect(() => JSON.stringify(buildRemediationAssumePattern())).not.toThrow();
    expect(JSON.stringify(buildRemediationAssumePattern())).toContain('AssumeRole');
  });

  it('rejects unknown partitions instead of emitting a broken ARN', () => {
    expect(() =>
      buildRemediationAssumePattern({
        partition: "aws'; evil #" as 'aws',
      }),
    ).toThrow(/unknown IAM partition/);
  });
});

describe('remediation denied pattern', () => {
  it('matches denied calls from remediator sessions without a source filter', () => {
    const pattern = buildRemediationDeniedPattern();
    // Denied calls arrive under the *called* service's source — scoping to
    // one source would miss hits, so the pattern must not set it.
    expect(pattern.source).toBeUndefined();
    const detail = pattern.detail as Record<string, unknown>;
    expect(detail.errorCode).toEqual(['AccessDenied', 'AccessDeniedException']);
    const identity = detail.userIdentity as Record<string, unknown>;
    const arns = (identity.arn as Array<{ wildcard: string }>).map((entry) => entry.wildcard);
    expect(arns).toEqual([
      'arn:aws:sts::*:assumed-role/OpenComp-Remediator/*',
      'arn:aws:sts::*:assumed-role/OpenComp-Remediator-*',
    ]);
  });

  it('does not match unrelated roles that share the name prefix', () => {
    const pattern = buildRemediationDeniedPattern();
    const detail = pattern.detail as Record<string, unknown>;
    const identity = detail.userIdentity as Record<string, unknown>;
    const arns = (identity.arn as Array<{ wildcard: string }>).map((entry) => entry.wildcard);
    // No bare `OpenComp-Remediator*` entry: that would also match
    // `OpenComp-RemediatorEvil`. The legacy entry pins the `/session` suffix
    // and the per-pair entry pins the `-` separator.
    expect(arns).not.toContain('arn:aws:sts::*:assumed-role/OpenComp-Remediator*');
  });

  it('uses the GovCloud partition when asked', () => {
    const pattern = buildRemediationDeniedPattern({ partition: 'aws-us-gov' });
    const detail = pattern.detail as Record<string, unknown>;
    const identity = detail.userIdentity as Record<string, unknown>;
    const arns = (identity.arn as Array<{ wildcard: string }>).map((entry) => entry.wildcard);
    expect(arns).toEqual([
      'arn:aws-us-gov:sts::*:assumed-role/OpenComp-Remediator/*',
      'arn:aws-us-gov:sts::*:assumed-role/OpenComp-Remediator-*',
    ]);
  });

  it('rejects unknown partitions instead of emitting a broken ARN', () => {
    expect(() =>
      buildRemediationDeniedPattern({
        partition: "aws'; evil #" as 'aws',
      }),
    ).toThrow(/unknown IAM partition/);
  });
});

describe('security-global assume pattern', () => {
  it('matches only the Security-Global role', () => {
    const arns = roleArnOf(buildSecurityGlobalAssumePattern()).map(
      (entry) => (entry as { wildcard: string }).wildcard,
    );
    expect(arns).toEqual(['arn:aws:iam::*:role/OpenComp-Remediator-Security-Global']);
  });

  it('uses the GovCloud partition when asked', () => {
    const arns = roleArnOf(buildSecurityGlobalAssumePattern({ partition: 'aws-us-gov' })).map(
      (entry) => (entry as { wildcard: string }).wildcard,
    );
    expect(arns).toEqual(['arn:aws-us-gov:iam::*:role/OpenComp-Remediator-Security-Global']);
  });

  it('rejects unknown partitions instead of emitting a broken ARN', () => {
    expect(() =>
      buildSecurityGlobalAssumePattern({
        partition: "aws'; evil #" as 'aws',
      }),
    ).toThrow(/unknown IAM partition/);
  });
});

describe('buildDetectionPattern', () => {
  it('routes every rule name to a pattern', () => {
    for (const rule of REMEDIATION_DETECTION_RULES) {
      const pattern = buildDetectionPattern({ rule });
      expect(pattern['detail-type']).toEqual(['AWS API Call via CloudTrail']);
      expect(REMEDIATION_DETECTION_SUBJECTS[rule]).toBeTruthy();
    }
  });

  it('forwards the partition to every pattern', () => {
    for (const rule of REMEDIATION_DETECTION_RULES) {
      const pattern = buildDetectionPattern({ rule, options: { partition: 'aws-us-gov' } });
      expect(JSON.stringify(pattern)).toContain('arn:aws-us-gov:');
      expect(JSON.stringify(pattern)).not.toContain('arn:aws:iam:');
      expect(JSON.stringify(pattern)).not.toContain('arn:aws:sts:');
    }
  });

  it('rejects unknown rule names', () => {
    expect(() =>
      buildDetectionPattern({ rule: 'OpenComp-Bogus' as RemediationDetectionRule }),
    ).toThrow(/unknown remediation detection rule/);
  });
});

describe('lake queries', () => {
  it('ships one query per signal with bounded, ordered SQL', () => {
    expect(REMEDIATION_LAKE_QUERIES).toHaveLength(3);
    for (const query of REMEDIATION_LAKE_QUERIES) {
      expect(query.sql).toContain('FROM <EDS_ID>');
      expect(query.sql).toContain('ORDER BY eventTime DESC LIMIT 100');
    }
  });

  it('scopes each query to remediator role names with terminated matchers', () => {
    const byName = Object.fromEntries(
      REMEDIATION_LAKE_QUERIES.map((query) => [query.name, query.sql]),
    );
    // Legacy monolith matches the exact name; per-pair roles match the
    // `OpenComp-Remediator-` prefix. Neither alternative may be a bare
    // `OpenComp-Remediator%` substring — that would also match unrelated
    // roles such as `OpenComp-RemediatorBackdoor`.
    expect(byName['remediator-assumes-7d']).toContain("'%:role/OpenComp-Remediator'");
    expect(byName['remediator-assumes-7d']).toContain("'%:role/OpenComp-Remediator-%'");
    expect(byName['remediator-denied-7d']).toContain("'%assumed-role/OpenComp-Remediator/%'");
    expect(byName['remediator-denied-7d']).toContain("'%assumed-role/OpenComp-Remediator-%'");
    expect(byName['security-global-use-30d']).toContain('Security-Global');
    for (const sql of Object.values(byName)) {
      expect(sql).not.toContain('OpenComp-Remediator%');
    }
  });
});

describe('detection setup script', () => {
  it('wires three rules to one confirmed SNS topic', () => {
    const script = getRemediationDetectionScript({ email: 'sec@example.com' });
    expect(script).toContain(`--name "${REMEDIATION_DETECTION_TOPIC_NAME}"`);
    expect(script).toContain('--protocol email --notification-endpoint "sec@example.com"');
    for (const rule of REMEDIATION_DETECTION_RULES) {
      expect(script).toContain(`put-rule --name "${rule}"`);
      expect(script).toContain(`put-targets --rule "${rule}"`);
    }
    // EventBridge needs permission to publish to the topic.
    expect(script).toContain('events.amazonaws.com');
    expect(script).toContain('sns:Publish');
  });

  it('escapes hostile email input so it cannot break out of the shell quoting', () => {
    const script = getRemediationDetectionScript({ email: 'a"b; rm -rf /' });
    expect(script).toContain('a\\"b; rm -rf /');
    expect(script).not.toContain('a"b; rm -rf /');
  });

  it('escapes dollar, backtick, and newline email input', () => {
    const script = getRemediationDetectionScript({ email: 'a$(b`c\nd\re$f\\g' });
    // `(` needs no escape inside double quotes; `$`, backtick, backslash do;
    // CR/LF are stripped so no new shell line can be injected.
    expect(script).toContain('a\\$(b\\`cde\\$f\\\\g');
    expect(script).not.toContain('"a$(b');
  });

  it('uses a valid custom topic name in the topic and the policy', () => {
    const script = getRemediationDetectionScript({
      email: 'sec@example.com',
      topicName: 'Custom_Topic-01',
    });
    expect(script).toContain('--name "Custom_Topic-01"');
    expect(script).not.toContain(REMEDIATION_DETECTION_TOPIC_NAME);
  });

  it('rejects hostile topic names instead of interpolating them', () => {
    expect(() =>
      getRemediationDetectionScript({
        email: 'sec@example.com',
        topicName: 'a"; rm -rf /; echo "',
      }),
    ).toThrow(/invalid SNS topic name/);
  });

  it('rejects unknown partitions instead of emitting a broken script', () => {
    expect(() =>
      getRemediationDetectionScript({
        email: 'sec@example.com',
        partition: "aws'; evil #" as 'aws',
      }),
    ).toThrow(/unknown IAM partition/);
  });

  it('scopes the topic policy to remediator rules', () => {
    const script = getRemediationDetectionScript({ email: 'sec@example.com' });
    expect(script).toContain('events.amazonaws.com');
    expect(script).toContain('sns:Publish');
    // The policy is embedded shell-escaped, so match the unescaped fragments.
    expect(script).toContain('ArnLike');
    expect(script).toContain('aws:SourceArn');
    expect(script).toContain('rule/OpenComp-Remediator*');
  });

  it('embeds a topic policy that survives shell unescaping as valid JSON', () => {
    const script = getRemediationDetectionScript({ email: 'sec@example.com' });
    const match = script.match(/--attribute-value "(.*)"$/m);
    expect(match).not.toBeNull();
    // The shell strips `\` before `"` inside double quotes, so unescape the
    // same way and require a parseable policy with the remediator condition.
    const policy = JSON.parse(match![1].replace(/\\"/g, '"')) as {
      Statement: Array<{ Condition: { ArnLike: { 'aws:SourceArn': string } } }>;
    };
    expect(policy.Statement).toHaveLength(1);
    expect(policy.Statement[0].Condition.ArnLike['aws:SourceArn']).toContain(
      'rule/OpenComp-Remediator*',
    );
  });

  it('embeds parseable event patterns', () => {
    const script = getRemediationDetectionScript({ email: 'sec@example.com' });
    const patterns = [...script.matchAll(/--event-pattern '(\{.*\})'/g)];
    expect(patterns).toHaveLength(3);
    for (const [, json] of patterns) {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      expect(parsed['detail-type']).toEqual(['AWS API Call via CloudTrail']);
    }
  });

  it('emits GovCloud ARNs throughout when asked', () => {
    const script = getRemediationDetectionScript({
      email: 'sec@example.com',
      partition: 'aws-us-gov',
    });
    expect(script).toContain('arn:aws-us-gov:iam:');
    expect(script).toContain('arn:aws-us-gov:sts:');
    expect(script).toContain('arn:aws-us-gov:events:');
    expect(script).not.toContain('arn:aws:iam:');
    expect(script).not.toContain('arn:aws:sts:');
    expect(script).not.toContain('arn:aws:events:');
  });
});
