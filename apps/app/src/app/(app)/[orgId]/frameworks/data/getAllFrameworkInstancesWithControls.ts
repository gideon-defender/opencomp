'use server';

import type { FrameworkInstanceWithControls } from '@/lib/types/framework';
import type { Control, PolicyStatus, RequirementMap } from '@db';
import { db } from '@db/server';

export async function getAllFrameworkInstancesWithControls({
  organizationId,
}: {
  organizationId: string;
}): Promise<FrameworkInstanceWithControls[]> {
  const frameworkInstancesFromDb = await db.frameworkInstance.findMany({
    where: {
      organizationId,
    },
    include: {
      framework: true,
      customFramework: true,
      requirementsMapped: {
        include: {
          control: {
            include: {
              policies: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                },
              },
              requirementsMapped: true,
            },
          },
        },
      },
    },
  });

  const frameworksWithControls: FrameworkInstanceWithControls[] = frameworkInstancesFromDb.map(
    (fi) => {
      const controlsMap = new Map<
        string,
        Control & {
          policies: Array<{
            id: string;
            name: string;
            status: PolicyStatus;
          }>;
          requirementsMapped: RequirementMap[];
        }
      >();

      for (const rm of fi.requirementsMapped) {
        if (rm.control) {
          const controlData = { ...rm.control };
          delete (controlData as { requirementsMapped?: unknown }).requirementsMapped;
          if (!controlsMap.has(rm.control.id)) {
            controlsMap.set(rm.control.id, {
              ...controlData,
              policies: rm.control.policies || [],
              requirementsMapped: rm.control.requirementsMapped || [],
            });
          }
        }
      }

      const restOfFi = { ...fi };
      delete (restOfFi as { requirementsMapped?: unknown }).requirementsMapped;

      return {
        ...restOfFi,
        controls: Array.from(controlsMap.values()),
      };
    },
  );

  return frameworksWithControls;
}
