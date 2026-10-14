export const CONTRACT_START = '20261013000004_user_tenant_enforce';
export const CONTRACT_END = '20261013000006_user_tenant_session_cleanup';
const approvalFailures = new Map([
  ['20261013000005_user_tenant_validate', 'validation phase is not approved'],
  [CONTRACT_END, 'session cleanup is not approved'],
]);

export function planTenantMigrations({ phase, history, schema }) {
  if (!['expand', 'contract'].includes(phase)) throw new Error('Expected expand or contract phase');
  const recover = [];
  for (const row of history.filter((entry) => !entry.finished && !entry.rolledBack)) {
    // Prisma cannot always save the gate error inside the aborted transaction.
    // 00004 is explicitly atomic; check that its contract DDL never committed.
    const atomicContractRolledBack =
      row.name === CONTRACT_START &&
      schema.legacyEmailKey &&
      schema.nullableTenant &&
      row.steps === 0;
    const approval = approvalFailures.get(row.name);
    const rejectedBeforeWrites =
      approval &&
      row.steps === 0 &&
      row.logs?.includes('user tenant contract:') &&
      row.logs.includes(approval);
    if (!atomicContractRolledBack && !rejectedBeforeWrites) {
      throw new Error(
        `Migration ${row.name} needs explicit inspection; refusing automatic recovery`,
      );
    }
    recover.push(row.name);
  }
  const applied = new Set(
    history.filter((row) => row.finished && !row.rolledBack).map((row) => row.name),
  );
  return { recover, expansionOnly: phase === 'expand' && !applied.has(CONTRACT_END) };
}

export function approveContractUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const options = url.searchParams.get('options');
  url.searchParams.set(
    'options',
    `${options ? `${options} ` : ''}-c app.tenant_contract_approved=yes`,
  );
  return url.toString();
}
