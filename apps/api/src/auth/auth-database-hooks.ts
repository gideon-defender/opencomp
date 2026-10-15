import type { BetterAuthOptions } from 'better-auth';
import { db } from '@db';
import { resolveActiveOrganizationId } from './oidc-provisioning';

export const authDatabaseHooks: NonNullable<
  BetterAuthOptions['databaseHooks']
> = {
  session: {
    create: {
      before: async (session) => {
        const isDev = process.env.NODE_ENV === 'development';
        if (isDev) {
          console.log(
            '[Better Auth] Session creation hook called for user:',
            session.userId,
          );
        }
        try {
          const activeOrganizationId = await resolveActiveOrganizationId({
            userId: session.userId,
          });

          if (activeOrganizationId) {
            if (isDev) {
              const org = await db.organization.findUnique({
                where: { id: activeOrganizationId },
                select: { name: true },
              });
              console.log(
                `[Better Auth] Setting activeOrganizationId to ${activeOrganizationId} (${org?.name}) for user ${session.userId}`,
              );
            }
            return {
              data: {
                ...session,
                activeOrganizationId,
              },
            };
          } else {
            if (isDev) {
              console.log(
                `[Better Auth] No organization found for user ${session.userId}`,
              );
            }
            return {
              data: session,
            };
          }
        } catch (error) {
          // Always log errors, even in production
          console.error('[Better Auth] Session creation hook error:', error);
          return {
            data: session,
          };
        }
      },
    },
  },
};
