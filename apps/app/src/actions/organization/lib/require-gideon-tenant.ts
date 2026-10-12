import { serverApi } from '@/lib/api-server';
import { z } from 'zod';

type SessionLike = {
  user?: { id?: string } | null;
} | null;

const tenantSchema = z.object({ tenantId: z.string().min(1) });

/** The API owns both the rollout policy and the session's owner proof. */
export async function requireGideonTenantId(
  session: SessionLike,
): Promise<{ tenantId: string } | { error: string }> {
  const userId = session?.user?.id;
  if (!userId) {
    return { error: 'Not authorized.' };
  }
  const response = await serverApi.get('/v1/auth/gideon/bootstrap');
  const tenant = tenantSchema.safeParse(response.data);
  if (response.error || !tenant.success) {
    return {
      error:
        'Sign in again with a Gideon owner assignment before creating an organization. Ask your identity admin for access.',
    };
  }
  return tenant.data;
}
