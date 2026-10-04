import { describe, expect, it } from 'vitest';
import { parseCliArgs, runCli } from '../generate-remediation-detection-script';

describe('parseCliArgs', () => {
  it('parses email with defaults for the rest', () => {
    expect(parseCliArgs(['--email', 'sec@example.com'])).toEqual({
      action: 'run',
      options: { email: 'sec@example.com', topicName: undefined, partition: undefined },
    });
  });

  it('parses topic name and partition', () => {
    expect(
      parseCliArgs([
        '--email',
        'sec@example.com',
        '--topic-name',
        'Custom_Topic-01',
        '--partition',
        'aws-us-gov',
      ]),
    ).toEqual({
      action: 'run',
      options: {
        email: 'sec@example.com',
        topicName: 'Custom_Topic-01',
        partition: 'aws-us-gov',
      },
    });
  });

  it('returns help without requiring email', () => {
    expect(parseCliArgs(['--help'])).toEqual({ action: 'help' });
  });

  it('rejects missing email, unknown flags, and missing values', () => {
    expect(() => parseCliArgs([])).toThrow(/missing required --email/);
    expect(() => parseCliArgs(['--email', 'a@b.c', '--bogus'])).toThrow(/unknown argument/);
    expect(() => parseCliArgs(['--email'])).toThrow(/missing value for --email/);
    expect(() => parseCliArgs(['--email', '--partition', 'aws'])).toThrow(
      /missing value for --email/,
    );
  });

  it('rejects unknown partitions before generating anything', () => {
    expect(() => parseCliArgs(['--email', 'a@b.c', '--partition', 'aws-cn'])).toThrow(
      /unknown partition/,
    );
  });
});

describe('runCli', () => {
  it('prints the wiring script for a minimal invocation', () => {
    const result = runCli(['--email', 'sec@example.com']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('OpenComp-Remediator-Alerts');
    expect(result.stdout).toContain('--notification-endpoint "sec@example.com"');
    expect(result.stdout.match(/put-rule --name/g)).toHaveLength(3);
  });

  it('emits GovCloud ARNs when asked', () => {
    const result = runCli(['--email', 'sec@example.com', '--partition', 'aws-us-gov']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('arn:aws-us-gov:iam:');
    expect(result.stdout).not.toContain('arn:aws:iam:');
  });

  it('fails with usage on bad args and with the message on generator errors', () => {
    const badArgs = runCli([]);
    expect(badArgs.exitCode).toBe(1);
    expect(badArgs.stdout).toBe('');
    expect(badArgs.stderr).toContain('Usage:');

    const hostileTopic = runCli([
      '--email',
      'sec@example.com',
      '--topic-name',
      'a"; rm -rf /; echo "',
    ]);
    expect(hostileTopic.exitCode).toBe(1);
    expect(hostileTopic.stdout).toBe('');
    expect(hostileTopic.stderr).toMatch(/invalid SNS topic name/);
  });

  it('prints usage for --help', () => {
    const result = runCli(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });
});
