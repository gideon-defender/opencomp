import { describe, expect, it } from 'vitest';
import { parseCliArgs, runCli, USAGE } from '../generate-gcp-remediation-detection-script';

describe('gcp detection script CLI args', () => {
  it('parses email and project id', () => {
    expect(parseCliArgs(['--email', 'sec@example.com', '--project-id', 'my-proj-123'])).toEqual({
      action: 'run',
      options: { email: 'sec@example.com', projectId: 'my-proj-123', channelName: undefined },
    });
  });

  it('accepts an explicit channel name', () => {
    const request = parseCliArgs([
      '--email',
      'sec@example.com',
      '--project-id',
      'my-proj-123',
      '--channel-name',
      'Custom',
    ]);
    expect(request).toEqual({
      action: 'run',
      options: { email: 'sec@example.com', projectId: 'my-proj-123', channelName: 'Custom' },
    });
  });

  it('requires email and project id', () => {
    expect(() => parseCliArgs(['--project-id', 'my-proj-123'])).toThrow(/missing required --email/);
    expect(() => parseCliArgs(['--email', 'sec@example.com'])).toThrow(
      /missing required --project-id/,
    );
  });

  it('rejects unknown flags and missing values', () => {
    expect(() => parseCliArgs(['--email', 'a@b.c', '--bogus'])).toThrow(/unknown argument/);
    expect(() => parseCliArgs(['--email'])).toThrow(/missing value for --email/);
  });

  it('answers --help without running', () => {
    expect(parseCliArgs(['--help'])).toEqual({ action: 'help' });
  });
});

describe('gcp detection script CLI run', () => {
  it('prints the script for valid args', () => {
    const result = runCli(['--email', 'sec@example.com', '--project-id', 'my-proj-123']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('PROJECT="my-proj-123"');
    expect(result.stdout).toContain(
      'gcloud logging metrics update opencomp-remediator-impersonate',
    );
    expect(result.stderr).toBe('');
  });

  it('prints usage on misuse and surfaces generator errors', () => {
    const misuse = runCli(['--project-id', 'my-proj-123']);
    expect(misuse.exitCode).toBe(1);
    expect(misuse.stderr).toContain(USAGE);
    const badProject = runCli(['--email', 'sec@example.com', '--project-id', 'BAD ID']);
    expect(badProject.exitCode).toBe(1);
    expect(badProject.stderr).toMatch(/valid GCP project id/);
  });
});
