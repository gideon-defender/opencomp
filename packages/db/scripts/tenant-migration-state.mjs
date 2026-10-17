export const CONTRACT_START = '20261013000004_user_tenant_enforce';
export const CONTRACT_END = '20261013000006_user_tenant_session_cleanup';
const OFFLINE_MIGRATIONS = new Set([
  CONTRACT_START,
  '20261013000005_user_tenant_validate',
  CONTRACT_END,
  '20261015000000_oidc_column_rename',
]);
const approvalFailures = new Map([
  ['20261013000005_user_tenant_validate', 'validation phase is not approved'],
  [CONTRACT_END, 'session cleanup is not approved'],
]);

export function planTenantMigrations({ phase, history, schema, migrationNames = [] }) {
  if (!['expand', 'contract', 'offline', 'online'].includes(phase))
    throw new Error('Expected expand, contract, offline, or online phase');
  if (phase === 'online') {
    const applied = new Set(
      history.filter((row) => row.finished && !row.rolledBack).map((row) => row.name),
    );
    const pendingOffline = migrationNames.find(
      (name) => OFFLINE_MIGRATIONS.has(name) && !applied.has(name),
    );
    if (pendingOffline) {
      throw new Error(
        `Migration ${pendingOffline} requires offline_migrations=true; no migrations were run`,
      );
    }
  }
  const recover = [];
  for (const row of history.filter((entry) => !entry.finished && !entry.rolledBack)) {
    if (phase === 'online') {
      throw new Error(
        `Migration ${row.name} needs explicit inspection; refusing automatic recovery`,
      );
    }
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
  return url.toString().replaceAll('+', '%20');
}

export function approveOfflineUrl(databaseUrl) {
  const url = new URL(approveContractUrl(databaseUrl));
  url.searchParams.set(
    'options',
    `${url.searchParams.get('options')} -c app.oidc_rename_approved=yes`,
  );
  return url.toString().replaceAll('+', '%20');
}
