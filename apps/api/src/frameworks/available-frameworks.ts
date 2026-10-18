import { db } from '@db';
import type { AuthContext } from '../auth/types';

export type AvailableFrameworksParams = Pick<
  AuthContext,
  'authType' | 'userId'
> & { organizationId?: string };

async function findTenantFrameworks({
  organizationId,
  authType,
  userId,
}: AvailableFrameworksParams) {
  if (!organizationId) return [];

  // Onboarding sessions carry tenant ownership without proving membership.
  if (authType !== 'api-key' && authType !== 'service') {
    if (!userId) return [];
    const membership = await db.member.findFirst({
      where: {
        userId,
        organizationId,
        isActive: true,
        deactivated: false,
        idpAccessRevoked: false,
      },
      select: { id: true },
    });
    if (!membership) return [];
  }

  return db.customFramework.findMany({
    where: { organizationId },
    include: { requirements: true },
    orderBy: { name: 'asc' },
  });
}

export async function findAvailableFrameworks(
  params: AvailableFrameworksParams,
) {
  const [platform, custom] = await Promise.all([
    db.frameworkEditorFramework.findMany({
      where: { visible: true },
      include: { requirements: true },
      orderBy: { name: 'asc' },
    }),
    findTenantFrameworks(params),
  ]);
  return [
    ...platform.map((f) => ({ ...f, isCustom: false as const })),
    ...custom.map((f) => ({ ...f, visible: true, isCustom: true as const })),
  ];
}
