import { db } from '@db';
import { splitRoleNames } from '../roles/role-holders';
import {
  parseObligationsField,
  resolveEffectiveObligations,
} from '../roles/role-obligations';

interface MemberWithRole {
  role: string;
}

/** Resolve tenant overrides before built-in defaults, then union each member's roles. */
export async function filterComplianceMembers<T extends MemberWithRole>(
  members: T[],
  organizationId: string,
): Promise<T[]> {
  if (members.length === 0) return [];

  const distinctRoles = new Set<string>();
  const memberRoles = members.map((member) => {
    const roleNames = splitRoleNames(member.role);
    for (const name of roleNames) distinctRoles.add(name);
    return { member, roleNames };
  });
  if (distinctRoles.size === 0) return [];

  const rows = await db.organizationRole.findMany({
    where: { organizationId, name: { in: [...distinctRoles] } },
    select: { name: true, obligations: true },
  });
  const overrides = new Map(
    rows.map((row) => [row.name, parseObligationsField(row.obligations)]),
  );
  const complianceRoles = new Set(
    [...distinctRoles].filter(
      (name) =>
        resolveEffectiveObligations(name, overrides.get(name) ?? null)
          .compliance,
    ),
  );

  return memberRoles
    .filter(({ roleNames }) =>
      roleNames.some((name) => complianceRoles.has(name)),
    )
    .map(({ member }) => member);
}
