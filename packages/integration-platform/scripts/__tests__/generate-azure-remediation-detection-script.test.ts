import { describe, expect, it } from 'vitest';
import {
  parseCliArgs,
  parseServiceEntry,
  runCli,
  USAGE,
} from '../generate-azure-remediation-detection-script';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const SP = '11111111-1111-1111-1111-111111111111';

describe('azure detection script CLI service entries', () => {
  it('parses Class:app-id pairs', () => {
    expect(parseServiceEntry(`Storage:${SP}`)).toEqual({ assetClass: 'Storage', appId: SP });
  });

  it('rejects entries without a separator or half', () => {
    expect(() => parseServiceEntry('Storage')).toThrow(/invalid --service/);
    expect(() => parseServiceEntry(`:${SP}`)).toThrow(/invalid --service/);
    expect(() => parseServiceEntry('Storage:')).toThrow(/invalid --service/);
  });
});

describe('azure detection script CLI args', () => {
  it('parses email, subscription, resource group, and repeatable services', () => {
    expect(
      parseCliArgs([
        '--email',
        'sec@example.com',
        '--subscription-id',
        SUB,
        '--resource-group',
        'rg-opencomp',
        '--service',
        `Storage:${SP}`,
        '--service',
        'Data:22222222-2222-2222-2222-222222222222',
      ]),
    ).toEqual({
      action: 'run',
      options: {
        email: 'sec@example.com',
        subscriptionId: SUB,
        resourceGroup: 'rg-opencomp',
        services: [
          { assetClass: 'Storage', appId: SP },
          { assetClass: 'Data', appId: '22222222-2222-2222-2222-222222222222' },
        ],
        actionGroupName: undefined,
      },
    });
  });

  it('accepts an explicit action group name', () => {
    const request = parseCliArgs([
      '--email',
      'sec@example.com',
      '--subscription-id',
      SUB,
      '--resource-group',
      'rg',
      '--service',
      `Storage:${SP}`,
      '--action-group-name',
      'Custom',
    ]);
    expect(request).toEqual({
      action: 'run',
      options: {
        email: 'sec@example.com',
        subscriptionId: SUB,
        resourceGroup: 'rg',
        services: [{ assetClass: 'Storage', appId: SP }],
        actionGroupName: 'Custom',
      },
    });
  });

  it('requires email, subscription, resource group, and at least one service', () => {
    const base = [
      '--email',
      'sec@example.com',
      '--subscription-id',
      SUB,
      '--resource-group',
      'rg',
      '--service',
      `Storage:${SP}`,
    ];
    const without = (flag: string): string[] => {
      const at = base.indexOf(flag);
      return base.filter((_, index) => index !== at && index !== at + 1);
    };
    expect(() => parseCliArgs(without('--email'))).toThrow(/missing required --email/);
    expect(() => parseCliArgs(without('--subscription-id'))).toThrow(
      /missing required --subscription-id/,
    );
    expect(() => parseCliArgs(without('--resource-group'))).toThrow(
      /missing required --resource-group/,
    );
    expect(() => parseCliArgs(without('--service'))).toThrow(/missing required --service/);
  });

  it('rejects unknown flags and missing values', () => {
    expect(() =>
      parseCliArgs([
        '--email',
        'a@b.c',
        '--subscription-id',
        SUB,
        '--resource-group',
        'rg',
        '--service',
        `Storage:${SP}`,
        '--bogus',
      ]),
    ).toThrow(/unknown argument/);
    expect(() => parseCliArgs(['--email'])).toThrow(/missing value for --email/);
  });

  it('answers --help without running', () => {
    expect(parseCliArgs(['--help'])).toEqual({ action: 'help' });
  });
});

describe('azure detection script CLI run', () => {
  it('prints the script for valid args', () => {
    const result = runCli([
      '--email',
      'sec@example.com',
      '--subscription-id',
      SUB,
      '--resource-group',
      'rg-opencomp',
      '--service',
      `Storage:${SP}`,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`SUBSCRIPTION="${SUB}"`);
    expect(result.stdout).toContain('OpenComp-RemediatorWrite-Storage');
    expect(result.stderr).toBe('');
  });

  it('prints usage on misuse and surfaces generator errors', () => {
    const misuse = runCli(['--email', 'sec@example.com']);
    expect(misuse.exitCode).toBe(1);
    expect(misuse.stderr).toContain(USAGE);
    const badSub = runCli([
      '--email',
      'sec@example.com',
      '--subscription-id',
      'nope',
      '--resource-group',
      'rg',
      '--service',
      `Storage:${SP}`,
    ]);
    expect(badSub.exitCode).toBe(1);
    expect(badSub.stderr).toMatch(/valid Azure subscription id/);
  });
});
