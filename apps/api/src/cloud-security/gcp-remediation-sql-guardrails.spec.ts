import { validateGcpSqlPatch } from './gcp-remediation-sql-guardrails';
import { validateGcpSqlEndpointShape } from './gcp-remediation-sql-guardrails';

const PREFIX = 'Step 1 (PATCH /instances/i)';
const URL = 'https://sqladmin.googleapis.com/v1/projects/p/instances/i';

function patch(
  body: Record<string, unknown>,
  args?: {
    realState?: Record<string, unknown>;
    readSteps?: Array<{ purpose: string; url: string }>;
    fixStep?: { url: string };
  },
) {
  return validateGcpSqlPatch(body, args?.realState, PREFIX, {
    ...(args?.readSteps ? { readSteps: args.readSteps } : {}),
    ...(args?.fixStep ? { fixStep: args.fixStep } : {}),
  });
}

describe('validateGcpSqlPatch connectivity', () => {
  it('refuses instead of crashing on a malformed ipAddresses list', () => {
    // A non-array ipAddresses used to throw TypeError inside `.some` —
    // a crash is not a refusal.
    const errors = patch(
      { settings: { ipConfiguration: { ipv4Enabled: false } } },
      {
        realState: { read: { settings: {}, ipAddresses: 'oops' } },
        fixStep: { url: URL },
      },
    );
    expect(errors.join(' ')).toMatch(/private IP/);
  });

  it('allows disabling public IP when a private IP exists', () => {
    const errors = patch(
      { settings: { ipConfiguration: { ipv4Enabled: false } } },
      {
        realState: {
          read: {
            settings: {},
            ipAddresses: [
              { type: 'PRIVATE', ipAddress: '10.0.0.1' },
              { type: 'PRIMARY', ipAddress: '1.2.3.4' },
            ],
          },
        },
        fixStep: { url: URL },
        readSteps: [{ purpose: 'read', url: URL }],
      },
    );
    expect(errors).toEqual([]);
  });

  it('refuses disabling public IP with no private IP in state', () => {
    const errors = patch(
      { settings: { ipConfiguration: { ipv4Enabled: false } } },
      {
        realState: {
          read: {
            settings: {},
            ipAddresses: [{ type: 'PRIMARY', ipAddress: '1.2.3.4' }],
          },
        },
        fixStep: { url: URL },
      },
    );
    expect(errors.join(' ')).toMatch(/private IP/);
  });
});

describe('validateGcpSqlPatch TLS enforcement', () => {
  it('refuses requireSsl:false without prior state', () => {
    const errors = patch(
      { settings: { ipConfiguration: { requireSsl: false } } },
      { fixStep: { url: URL } },
    );
    expect(errors.join(' ')).toMatch(/requireSsl/);
  });

  it('allows requireSsl:false when the instance already has it off', () => {
    const errors = patch(
      { settings: { ipConfiguration: { requireSsl: false } } },
      {
        realState: {
          read: { settings: { ipConfiguration: { requireSsl: false } } },
        },
        readSteps: [{ purpose: 'read', url: URL }],
        fixStep: { url: URL },
      },
    );
    expect(errors).toEqual([]);
  });

  it('refuses sslMode downgrade to unencrypted-allowed', () => {
    const errors = patch(
      {
        settings: {
          ipConfiguration: { sslMode: 'ALLOW_UNENCRYPTED_AND_ENCRYPTED' },
        },
      },
      {
        realState: {
          read: {
            settings: { ipConfiguration: { sslMode: 'ENCRYPTED_ONLY' } },
          },
        },
        readSteps: [{ purpose: 'read', url: URL }],
        fixStep: { url: URL },
      },
    );
    expect(errors.join(' ')).toMatch(/sslMode/);
  });
});

describe('validateGcpSqlEndpointShape', () => {
  const shape = (
    args: Partial<Parameters<typeof validateGcpSqlEndpointShape>[0]>,
  ) =>
    validateGcpSqlEndpointShape({
      method: 'PATCH',
      pathname: '/v1/projects/p/instances/i',
      nameQueryValues: [],
      body: {},
      prefix: PREFIX,
      ...args,
    });

  it('refuses export bodies that carry no settings', () => {
    const errors = shape({
      method: 'POST',
      pathname: '/v1/projects/p/instances/i/export',
      body: { exportContext: { uri: 'gs://attacker-bucket/dump.gz' } },
    });
    expect(errors.join(' ')).toMatch(/never exposure fixes/);
  });

  it('refuses user inserts even with a benign-looking body', () => {
    const errors = shape({
      method: 'POST',
      pathname: '/v1/projects/p/instances/i/users',
      body: { name: 'backup', password: 'x' },
    });
    expect(errors.join(' ')).toMatch(/password-rotation shape/);
  });

  it('refuses lifecycle verbs on the instance path', () => {
    const errors = shape({
      method: 'POST',
      pathname: '/v1/projects/p/instances/i/failover',
      body: {},
    });
    expect(errors.join(' ')).toMatch(/never exposure fixes/);
  });

  it('refuses instance PATCH that smuggles non-settings fields', () => {
    const errors = shape({
      body: { settings: { ipConfiguration: {} }, databaseVersion: 'MYSQL_8_0' },
    });
    expect(errors.join(' ')).toMatch(/settings-only body/);
  });

  it('allows the documented password rotation and nothing wider', () => {
    const rotation = shape({
      method: 'PUT',
      pathname: '/v1/projects/p/instances/i/users',
      nameQueryValues: ['root'],
      body: { password: 'rotated-secret' },
    });
    expect(rotation).toEqual([]);

    const extraKey = shape({
      method: 'PUT',
      pathname: '/v1/projects/p/instances/i/users',
      nameQueryValues: ['root'],
      body: { password: 'rotated-secret', type: 'BUILT_IN' },
    });
    expect(extraKey.join(' ')).toMatch(/password-rotation shape/);

    const unnamed = shape({
      method: 'PUT',
      pathname: '/v1/projects/p/instances/i/users',
      nameQueryValues: [],
      body: { password: 'rotated-secret' },
    });
    expect(unnamed.join(' ')).toMatch(/password-rotation shape/);
  });

  it('allows settings-only instance PATCH through to parameter checks', () => {
    expect(shape({ body: { settings: {} } })).toEqual([]);
    expect(shape({ body: {} })).toEqual([]);
  });
});

describe('validateGcpSqlPatch public-IP enablement', () => {
  it('refuses enabling public IP without prior state', () => {
    const errors = patch(
      { settings: { ipConfiguration: { ipv4Enabled: true } } },
      { fixStep: { url: URL } },
    );
    expect(errors.join(' ')).toMatch(/enabling public IP/);
  });

  it('refuses enabling public IP when the instance is private', () => {
    const errors = patch(
      { settings: { ipConfiguration: { ipv4Enabled: true } } },
      {
        realState: {
          read: { settings: { ipConfiguration: { ipv4Enabled: false } } },
        },
        readSteps: [{ purpose: 'read', url: URL }],
        fixStep: { url: URL },
      },
    );
    expect(errors.join(' ')).toMatch(/enabling public IP/);
  });

  it('allows ipv4Enabled:true when the instance already has it on', () => {
    const errors = patch(
      { settings: { ipConfiguration: { ipv4Enabled: true } } },
      {
        realState: {
          read: { settings: { ipConfiguration: { ipv4Enabled: true } } },
        },
        readSteps: [{ purpose: 'read', url: URL }],
        fixStep: { url: URL },
      },
    );
    expect(errors).toEqual([]);
  });
});

describe('validateGcpSqlPatch authorizedNetworks', () => {
  const priorNets = (ranges: string[]) => ({
    realState: {
      read: {
        settings: {
          ipConfiguration: {
            authorizedNetworks: ranges.map((value) => ({ value })),
          },
        },
      },
    },
    readSteps: [{ purpose: 'read', url: URL }],
    fixStep: { url: URL },
  });

  it('refuses adding an attacker range beyond the pre-fix allowlist', () => {
    const errors = patch(
      {
        settings: {
          ipConfiguration: {
            authorizedNetworks: [
              { value: '10.0.0.0/8' },
              { value: '203.0.113.7/32' },
            ],
          },
        },
      },
      priorNets(['10.0.0.0/8']),
    );
    expect(errors.join(' ')).toMatch(/beyond the pre-fix allowlist/);
  });

  it('allows restating the exact pre-fix allowlist', () => {
    const errors = patch(
      {
        settings: {
          ipConfiguration: { authorizedNetworks: [{ value: '10.0.0.0/8' }] },
        },
      },
      priorNets(['10.0.0.0/8']),
    );
    expect(errors).toEqual([]);
  });

  it('refuses authorizedNetworks edits without pre-fix state', () => {
    const errors = patch(
      {
        settings: {
          ipConfiguration: { authorizedNetworks: [{ value: '10.0.0.0/8' }] },
        },
      },
      { fixStep: { url: URL } },
    );
    expect(errors.join(' ')).toMatch(/without pre-fix state/);
  });
});

describe('validateGcpSqlPatch backup protection', () => {
  it('refuses disabling automated backups', () => {
    const errors = patch(
      { settings: { backupConfiguration: { enabled: false } } },
      {
        realState: {
          read: { settings: { backupConfiguration: { enabled: true } } },
        },
        readSteps: [{ purpose: 'read', url: URL }],
        fixStep: { url: URL },
      },
    );
    expect(errors.join(' ')).toMatch(/disabling automated backups/);
  });

  it('allows backupConfiguration:enabled:false when already off', () => {
    const errors = patch(
      { settings: { backupConfiguration: { enabled: false } } },
      {
        realState: {
          read: { settings: { backupConfiguration: { enabled: false } } },
        },
        readSteps: [{ purpose: 'read', url: URL }],
        fixStep: { url: URL },
      },
    );
    expect(errors).toEqual([]);
  });

  it('refuses disabling backups without pre-fix state', () => {
    const errors = patch(
      { settings: { backupConfiguration: { enabled: false } } },
      { fixStep: { url: URL } },
    );
    expect(errors.join(' ')).toMatch(/disabling automated backups/);
  });
});
