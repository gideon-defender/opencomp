import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPilotConversionPlan } from './pilot-conversion-plan.mjs';

const member = ({ email, ...overrides }) => ({
  email,
  gideonSub: `sub-${email}`,
  role: 'owner',
  roleSource: 'local',
  idpAccessRevoked: false,
  deactivated: false,
  isActive: true,
  banned: false,
  ...overrides,
});

for (const state of [{ deactivated: true }, { isActive: false }, { banned: true }]) {
  test(`rejects cutover when the only assigned owner is unavailable: ${JSON.stringify(state)}`, () => {
    assert.throws(
      () =>
        buildPilotConversionPlan({
          members: [
            member({ email: 'old-owner@example.com' }),
            member({ email: 'unavailable@example.com', ...state }),
          ],
          byEmail: new Map([['unavailable@example.com', ['owner']]]),
        }),
      /zero active owners/,
    );
  });
}

test('keeps an active owner and revokes members without assignments', () => {
  const { plan, owners } = buildPilotConversionPlan({
    members: [
      member({ email: 'owner@example.com' }),
      member({ email: 'removed@example.com', role: 'admin' }),
    ],
    byEmail: new Map([['owner@example.com', ['owner', 'admin']]]),
  });
  assert.equal(owners, 1);
  assert.equal(plan[0].newRole, 'owner,admin');
  assert.equal(plan[1].newRole, '');
  assert.equal(plan[1].revoke, true);
});

for (const gideonSub of [null, undefined, '', '   ']) {
  test(`revokes assigned unlinked members: ${JSON.stringify(gideonSub)}`, () => {
    const { plan, owners } = buildPilotConversionPlan({
      members: [
        member({ email: 'owner@example.com' }),
        member({ email: 'unlinked@example.com', gideonSub, role: 'admin', roleSource: 'sso' }),
      ],
      byEmail: new Map([
        ['owner@example.com', ['owner']],
        ['unlinked@example.com', ['admin']],
      ]),
    });
    assert.equal(owners, 1);
    assert.equal(plan[1].action, 'revoke');
    assert.equal(plan[1].newRole, '');
    assert.equal(plan[1].revoke, true);
  });

  test(`refuses cutover if the only assigned owner is unlinked: ${JSON.stringify(gideonSub)}`, () => {
    assert.throws(
      () =>
        buildPilotConversionPlan({
          members: [member({ email: 'owner@example.com', gideonSub })],
          byEmail: new Map([['owner@example.com', ['owner']]]),
        }),
      /zero active owners/,
    );
  });
}
