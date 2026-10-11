import { db } from '@db';
import type { User } from '@db';
import { z } from 'zod';

const identitySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().nullable(),
  status: z.enum([
    'active',
    'pending_enrollment',
    'suspended',
    'deprovisioned',
  ]),
});
const lookupSchema = z.object({
  tenant_id: z.string().uuid(),
  identity: identitySchema.nullable(),
});

export type HrIdentity = Pick<
  z.infer<typeof identitySchema>,
  'id' | 'email' | 'display_name'
>;
export type HrIdentityResolver = (params: {
  email: string;
}) => Promise<HrIdentity | null>;

/** Use tenant-linked local subjects first, with a per-run IdP fallback cache. */
export function createHrIdentityResolver({
  organizationId,
}: {
  organizationId: string;
}): HrIdentityResolver {
  const base =
    process.env.GIDEON_HR_IDENTITY_URL ||
    process.env.GIDEON_IDENTITY_URL ||
    process.env.AUTH__IDENTITY_URL;
  const token =
    process.env.GIDEON_INTERNAL_SERVICE_TOKEN ||
    process.env.INTERNAL_SERVICE_TOKEN;
  const pending = new Map<string, Promise<HrIdentity | null>>();
  return ({ email }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const cached = pending.get(normalizedEmail);
    if (cached) return cached;
    const lookup = async (): Promise<HrIdentity | null> => {
      const local = await db.user.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          gideonSub: { not: null },
          OR: [
            { gideonTenantId: organizationId },
            { gideonTenantId: null, members: { some: { organizationId } } },
          ],
        },
      });
      if (local?.gideonSub?.trim()) {
        return {
          id: local.gideonSub,
          email: local.email,
          display_name: local.name,
        };
      }
      if (!base || !token) {
        throw new Error(
          'HR sync requires the Gideon identity URL and internal service token for unlinked users',
        );
      }
      const url = new URL(
        `${base.replace(/\/$/, '')}/v1/internal/tenants/${encodeURIComponent(organizationId)}/hr-identity`,
      );
      url.searchParams.set('email', normalizedEmail);
      const response = await fetch(url, {
        headers: {
          'x-internal-service-token': token,
          'x-gideon-actor': 'opencomp-hr-sync',
        },
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok)
        throw new Error(`IdP identity lookup failed (HTTP ${response.status})`);
      const result = lookupSchema.parse(await response.json());
      if (
        result.tenant_id !== organizationId ||
        (result.identity &&
          result.identity.email.trim().toLowerCase() !== normalizedEmail)
      ) {
        throw new Error(
          'IdP identity lookup returned a mismatched tenant or email',
        );
      }
      return result.identity;
    };
    const result = lookup();
    pending.set(normalizedEmail, result);
    return result;
  };
}

/** Materialize identities verified through a local link or Gideon Auth lookup. */
export async function getHrSyncUser({
  identity,
  organizationId,
}: {
  identity: HrIdentity;
  organizationId: string;
}): Promise<User> {
  const email = identity.email.trim().toLowerCase();
  const bySubject = await db.user.findUnique({
    where: { gideonSub: identity.id },
  });
  if (bySubject)
    return linkIdentity({ existing: bySubject, identity, organizationId });

  const existing = await db.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (existing) return linkIdentity({ existing, identity, organizationId });
  try {
    return await db.user.create({
      data: {
        email,
        name: identity.display_name || email.split('@')[0] || email,
        emailVerified: false,
        gideonSub: identity.id,
        gideonTenantId: organizationId,
      },
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'P2002'
    )
      throw error;
    const raced = await db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (raced)
      return linkIdentity({ existing: raced, identity, organizationId });
    const bySubject = await db.user.findUnique({
      where: { gideonSub: identity.id },
    });
    if (!bySubject) throw error;
    return linkIdentity({ existing: bySubject, identity, organizationId });
  }
}

async function linkIdentity({
  existing,
  identity,
  organizationId,
}: {
  existing: User;
  identity: HrIdentity;
  organizationId: string;
}): Promise<User> {
  if (existing.gideonSub && existing.gideonSub !== identity.id)
    throw new Error(
      'HR sync IdP identity conflicts with the existing user link',
    );
  if (existing.banned)
    throw new Error('HR sync cannot provision a disabled local user');
  if (existing.gideonSub) {
    const email = identity.email.trim().toLowerCase();
    if (existing.email.toLowerCase() === email) return existing;
    return db.user.update({
      where: { id: existing.id, gideonSub: identity.id },
      data: { email },
    });
  }
  return db.user.update({
    where: { id: existing.id, AND: { gideonSub: null } },
    data: { gideonSub: identity.id, gideonTenantId: organizationId },
  });
}
