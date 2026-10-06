import { validateGcpSqlDatabaseFlags } from './gcp-remediation-sql-flags-guardrails';

const INSTANCE_URL =
  'https://sqladmin.googleapis.com/sql/v1beta4/projects/my-proj/instances/my-instance';

function argsFor(
  databaseFlags: unknown,
  priorFlags: Array<{ name: string; value: string }> | null,
) {
  return {
    databaseFlags,
    prefix: 'test',
    realState:
      priorFlags === null
        ? undefined
        : { 'read instance': { settings: { databaseFlags: priorFlags } } },
    readSteps: [{ purpose: 'read instance', url: INSTANCE_URL }],
    fixStep: { url: INSTANCE_URL },
  };
}

describe('validateGcpSqlDatabaseFlags', () => {
  it('accepts flags identical to the bound pre-fix state', () => {
    const prior = [
      { name: 'log_checkpoints', value: 'on' },
      { name: 'log_connections', value: 'on' },
    ];
    expect(
      validateGcpSqlDatabaseFlags(argsFor(structuredClone(prior), prior)),
    ).toEqual([]);
  });

  it('refuses a dropped pre-existing flag', () => {
    const prior = [
      { name: 'log_checkpoints', value: 'on' },
      { name: 'log_connections', value: 'on' },
    ];
    const errors = validateGcpSqlDatabaseFlags(
      argsFor([{ name: 'log_checkpoints', value: 'on' }], prior),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('drops pre-existing flag "log_connections"');
  });

  it('refuses a changed flag value', () => {
    const prior = [{ name: 'log_checkpoints', value: 'on' }];
    const errors = validateGcpSqlDatabaseFlags(
      argsFor([{ name: 'log_checkpoints', value: 'off' }], prior),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'changes the value of pre-existing flag "log_checkpoints"',
    );
  });

  it('refuses a new flag the pre-fix state cannot vouch for', () => {
    const prior = [{ name: 'log_checkpoints', value: 'on' }];
    const errors = validateGcpSqlDatabaseFlags(
      argsFor(
        [
          { name: 'log_checkpoints', value: 'on' },
          { name: 'skip_grant_tables', value: 'on' },
        ],
        prior,
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('adds new flag "skip_grant_tables"');
  });

  it('refuses a repeated flag name with different values', () => {
    const prior = [{ name: 'log_checkpoints', value: 'on' }];
    const errors = validateGcpSqlDatabaseFlags(
      argsFor(
        [
          { name: 'log_checkpoints', value: 'off' },
          { name: 'log_checkpoints', value: 'on' },
        ],
        prior,
      ),
    );
    // The collapsed map holds the benign value, so only the ambiguity
    // refusal must fire — never a silent pass.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'repeats flag "log_checkpoints" with different values',
    );
  });

  it('allows an identical repeated flag name (effect-equivalent)', () => {
    const prior = [{ name: 'log_checkpoints', value: 'on' }];
    expect(
      validateGcpSqlDatabaseFlags(
        argsFor(
          [
            { name: 'log_checkpoints', value: 'on' },
            { name: 'log_checkpoints', value: 'on' },
          ],
          prior,
        ),
      ),
    ).toEqual([]);
  });

  it('refuses without bound read state', () => {
    const errors = validateGcpSqlDatabaseFlags(
      argsFor([{ name: 'log_checkpoints', value: 'on' }], null),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('without bound read state');
  });

  it('refuses when several read records carry flags (ambiguous binding)', () => {
    const flags = [{ name: 'log_checkpoints', value: 'on' }];
    const errors = validateGcpSqlDatabaseFlags({
      databaseFlags: structuredClone(flags),
      prefix: 'test',
      realState: {
        'read instance': { settings: { databaseFlags: flags } },
        'read replica': { settings: { databaseFlags: flags } },
      },
      readSteps: [
        { purpose: 'read instance', url: INSTANCE_URL },
        { purpose: 'read replica', url: INSTANCE_URL },
      ],
      fixStep: { url: INSTANCE_URL },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('without bound read state');
  });
});
