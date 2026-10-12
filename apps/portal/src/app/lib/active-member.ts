/** HR deactivation and IdP revocation both deny portal access. */
export function activeMemberWhere({
  userId,
  organizationId,
  memberId,
}: {
  userId: string;
  organizationId?: string;
  memberId?: string;
}) {
  return {
    userId,
    deactivated: false,
    idpAccessRevoked: false,
    ...(organizationId ? { organizationId } : {}),
    ...(memberId ? { id: memberId } : {}),
  };
}
