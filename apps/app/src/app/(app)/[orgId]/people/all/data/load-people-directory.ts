import { serverApi } from '@/lib/api-server';
import type { MemberWithUser } from '../components/TeamMembers';

/** A failed directory read must not be presented as a successfully empty list. */
export async function loadPeopleDirectory(organizationId: string) {
  const response = await serverApi.get<{ data: MemberWithUser[]; count: number }>(
    '/v1/people?includeDeactivated=true',
    { 'X-Organization-Id': organizationId },
  );
  if (response.error || !Array.isArray(response.data?.data)) return null;
  return response.data.data;
}
