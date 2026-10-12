import { buildPilotConversionPlan } from './pilot-conversion-plan.mjs';

const memberQuery = `SELECT m.id AS "memberId", u.email, u."gideonSub", u.banned,
  m.role, m."roleSource", m."idpAccessRevoked", m.deactivated, m."isActive"
  FROM "Member" m JOIN "User" u ON u.id = m."userId"
  WHERE m."organizationId"=$1 ORDER BY u.id, m.id`;

export async function applyPilotConversion({ client, tenantId, byEmail }) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    // The org lock also blocks new memberships through their foreign key.
    const org = await client.query('SELECT id FROM "Organization" WHERE id=$1 FOR UPDATE', [
      tenantId,
    ]);
    if (org.rows.length !== 1) throw new Error('tenant no longer exists');
    await client.query(`${memberQuery} FOR UPDATE OF m, u`, [tenantId]);
    // Re-read after waiting for locks; the printed dry-run is not apply input.
    const { rows: members } = await client.query(memberQuery, [tenantId]);
    const { plan } = buildPilotConversionPlan({ members, byEmail });
    const counts = { keep: 0, update: 0, revoke: 0 };
    for (const entry of plan) {
      counts[entry.action]++;
      if (entry.action === 'keep') continue;
      const result = await client.query(
        `UPDATE "Member" SET role=$1, "roleSource"='sso', "idpAccessRevoked"=$2
         WHERE id=$3 AND "organizationId"=$4`,
        [entry.newRole, entry.revoke, entry.memberId, tenantId],
      );
      if (result.rowCount !== 1) throw new Error('membership changed during conversion');
    }
    const { rows: finalMembers } = await client.query(memberQuery, [tenantId]);
    if (finalMembers.some((member) => member.roleSource !== 'sso')) {
      throw new Error('post-apply invariant violated: local rows remain');
    }
    const owners = finalMembers.filter(
      (member) =>
        !member.idpAccessRevoked &&
        !member.deactivated &&
        member.isActive === true &&
        member.banned !== true &&
        typeof member.gideonSub === 'string' &&
        member.gideonSub.trim() &&
        member.role.split(',').includes('owner'),
    ).length;
    if (owners < 1)
      throw new Error('refusing cutover: tenant would have zero active owners afterwards');
    const deleted = await client.query(
      `DELETE FROM "Session" WHERE "userId" IN
       (SELECT "userId" FROM "Member" WHERE "organizationId"=$1)`,
      [tenantId],
    );
    await client.query('COMMIT');
    return { ...counts, owners, sessionsInvalidated: deleted.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
