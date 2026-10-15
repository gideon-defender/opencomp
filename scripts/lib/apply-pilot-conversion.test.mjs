import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPilotConversion } from './apply-pilot-conversion.mjs';
import { buildPilotConversionPlan } from './pilot-conversion-plan.mjs';

function fixture({ beforeLocks = () => {}, corruptWrite = false } = {}) {
  const members = [
    { memberId: 'old', email: 'old@example.com', role: 'owner' },
    { memberId: 'new', email: 'new@example.com', role: 'employee' },
  ].map((member) => ({
    ...member,
    oidcSub: member.email,
    roleSource: 'local',
    idpAccessRevoked: false,
    deactivated: false,
    isActive: true,
    banned: false,
  }));
  const byEmail = new Map([['new@example.com', ['owner']]]);
  const queries = [];
  let snapshot;
  const client = {
    async query(sql, values) {
      queries.push(sql);
      if (sql === 'BEGIN') snapshot = structuredClone(members);
      if (sql === 'ROLLBACK') members.splice(0, members.length, ...snapshot);
      if (sql.startsWith('SELECT id')) return { rows: [{ id: 'tenant' }] };
      if (sql.includes('FOR UPDATE OF')) {
        beforeLocks(members);
        snapshot = structuredClone(members);
      }
      if (sql.includes('JOIN "User"')) return { rows: structuredClone(members) };
      if (sql.startsWith('UPDATE')) {
        const member = members.find((row) => row.memberId === values[2]);
        assert.equal(values[3], 'tenant');
        Object.assign(member, {
          role: corruptWrite ? '' : values[0],
          roleSource: 'sso',
          idpAccessRevoked: values[1],
        });
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: sql.startsWith('DELETE') ? 2 : 0 };
    },
  };
  return { client, members, byEmail, queries };
}

for (const changedState of [{ deactivated: true }, { banned: true }, { isActive: false }]) {
  test(`rejects a prospective owner made unavailable after preview: ${JSON.stringify(changedState)}`, async () => {
    const f = fixture({ beforeLocks: (members) => Object.assign(members[1], changedState) });
    assert.equal(buildPilotConversionPlan(f).owners, 1);
    await assert.rejects(applyPilotConversion({ ...f, tenantId: 'tenant' }), /zero active owners/);
    assert.equal(f.members[0].role, 'owner');
    assert.ok(f.queries.includes('ROLLBACK'));
    assert.ok(!f.queries.includes('COMMIT'));
    assert.ok(!f.queries.some((sql) => sql.startsWith('DELETE')));
  });
}

test('checks persisted owner roles before invalidating sessions and rolls back failed writes', async () => {
  const f = fixture({ corruptWrite: true });
  await assert.rejects(applyPilotConversion({ ...f, tenantId: 'tenant' }), /zero active owners/);
  assert.equal(f.members[0].role, 'owner');
  assert.ok(!f.queries.some((sql) => sql.startsWith('DELETE')));
});

test('applies fresh assignments and invalidates sessions in the same transaction', async () => {
  const f = fixture();
  assert.deepEqual(await applyPilotConversion({ ...f, tenantId: 'tenant' }), {
    keep: 0,
    update: 1,
    revoke: 1,
    owners: 1,
    sessionsInvalidated: 2,
  });
  assert.equal(f.members[0].idpAccessRevoked, true);
  assert.equal(f.members[1].role, 'owner');
  assert.equal(f.queries[0], 'BEGIN');
  assert.equal(f.queries.at(-1), 'COMMIT');
});
