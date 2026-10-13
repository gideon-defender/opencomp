import { db } from '@db';
import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthMiddleware,
  getAuthoritativeSessionFromCtx,
} from 'better-auth/api';
import { z } from 'zod';

const sessionSchema = z
  .object({
    user: z.object({ id: z.string() }),
    session: z.object({ activeOrganizationId: z.string().nullish() }),
  })
  .nullable();
const targetSchema = z.object({
  organizationId: z.string().min(1).nullish(),
  organizationSlug: z.string().min(1).optional(),
});

/** Better Auth's row-exists check is insufficient for revoked/offboarded rows. */
export async function requireActiveIdpMembership({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): Promise<void> {
  const member = await db.member.findFirst({
    where: {
      userId,
      organizationId,
      deactivated: false,
      idpAccessRevoked: false,
    },
    select: { id: true },
  });
  if (!member)
    throw new APIError('FORBIDDEN', {
      message: 'Organization membership is inactive or revoked',
    });
}

export async function filterActiveIdpOrganizations<T extends { id: string }>({
  userId,
  organizations,
}: {
  userId: string;
  organizations: T[];
}): Promise<T[]> {
  const members = await db.member.findMany({
    where: { userId, deactivated: false, idpAccessRevoked: false },
    select: { organizationId: true },
  });
  const permitted = new Set(members.map((member) => member.organizationId));
  return organizations.filter((organization) => permitted.has(organization.id));
}

export async function requireOrganizationRequestAccess({
  userId,
  activeOrganizationId,
  path,
  body,
  query,
}: {
  userId: string;
  activeOrganizationId?: string | null;
  path?: string;
  body: unknown;
  query: unknown;
}): Promise<void> {
  const bodyTarget = targetSchema.parse(body ?? {});
  const queryTarget = targetSchema.parse(query ?? {});
  if (path === '/organization/set-active' && bodyTarget.organizationId === null)
    return;
  const targets = new Set(
    [bodyTarget.organizationId, queryTarget.organizationId].filter(
      (id): id is string => typeof id === 'string',
    ),
  );
  for (const slug of new Set([
    bodyTarget.organizationSlug,
    queryTarget.organizationSlug,
  ])) {
    if (!slug) continue;
    const organization = await db.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!organization)
      throw new APIError('FORBIDDEN', {
        message: 'Organization membership is inactive or revoked',
      });
    targets.add(organization.id);
  }
  // Some endpoints prioritize slugs, others IDs or the current selection.
  // Check every supplied scope so mixed inputs cannot bypass revocation.
  if (
    activeOrganizationId &&
    (targets.size === 0 || path !== '/organization/set-active')
  ) {
    targets.add(activeOrganizationId);
  }
  if (targets.size === 0)
    throw new APIError('FORBIDDEN', {
      message: 'No active organization membership',
    });
  for (const organizationId of targets)
    await requireActiveIdpMembership({ userId, organizationId });
}

export function idpOrganizationAccessPlugin() {
  return {
    id: 'idp-organization-access' as const,
    hooks: {
      before: [
        {
          matcher: (context) =>
            context.path?.startsWith('/organization/') === true,
          handler: createAuthMiddleware(async (context) => {
            const session = sessionSchema.parse(
              await getAuthoritativeSessionFromCtx(context),
            );
            if (!session)
              throw new APIError('UNAUTHORIZED', {
                message: 'Authentication required',
              });
            // The list response is filtered in the after hook; an inactive
            // current selection must not prevent choosing another valid org.
            if (context.path === '/organization/list') return;
            await requireOrganizationRequestAccess({
              userId: session.user.id,
              activeOrganizationId: session.session.activeOrganizationId,
              path: context.path,
              body: context.body,
              query: context.query,
            });
          }),
        },
      ],
      after: [
        {
          matcher: (context) => context.path === '/organization/list',
          handler: createAuthMiddleware(async (context) => {
            const session = sessionSchema.parse(
              await getAuthoritativeSessionFromCtx(context),
            );
            if (!session) return;
            const returned: unknown = context.context.returned;
            const body: unknown =
              returned instanceof Response
                ? await returned.clone().json()
                : returned;
            const organizations = z
              .array(z.object({ id: z.string() }).passthrough())
              .safeParse(body);
            if (!organizations.success) return; // Preserve the endpoint's error response.
            return context.json(
              await filterActiveIdpOrganizations({
                userId: session.user.id,
                organizations: organizations.data,
              }),
            );
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
