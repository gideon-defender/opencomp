export function buildPilotConversionPlan({ members, byEmail }) {
  const plan = members.map((member) => {
    const assigned = byEmail.get(String(member.email).trim().toLowerCase());
    const linked = typeof member.oidcSub === 'string' && member.oidcSub.trim() !== '';
    if (!assigned || !linked) {
      return { ...member, action: 'revoke', newRole: '', revoke: true };
    }
    const newRole = assigned.join(',');
    const same =
      member.role === newRole && member.roleSource === 'sso' && member.idpAccessRevoked === false;
    return { ...member, action: same ? 'keep' : 'update', newRole, revoke: false };
  });
  const owners = plan.filter(
    (member) =>
      !member.revoke &&
      !member.deactivated &&
      member.banned !== true &&
      member.isActive === true &&
      member.newRole.split(',').includes('owner'),
  ).length;
  if (owners < 1) {
    throw new Error('refusing cutover: tenant would have zero active owners afterwards');
  }
  return { plan, owners };
}
