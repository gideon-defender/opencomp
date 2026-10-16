import { z } from 'zod';
import { publicApiBase } from './api-config';

const ndaSchema = z.object({
  id: z.string(),
  organizationName: z.string(),
  friendlyUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  requesterName: z.string(),
  requesterEmail: z.string(),
  expiresAt: z.string(),
  portalUrl: z.string(),
  status: z.string(),
  message: z.string().optional(),
});

export type NdaDetails = z.infer<typeof ndaSchema>;

export async function readNda(token: string): Promise<NdaDetails | null> {
  const response = await fetch(
    `${publicApiBase()}/v1/trust-access/nda/${encodeURIComponent(token)}`,
    {
      cache: 'no-store',
      credentials: 'include',
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Trust API request failed');
  return ndaSchema.parse(await response.json());
}
