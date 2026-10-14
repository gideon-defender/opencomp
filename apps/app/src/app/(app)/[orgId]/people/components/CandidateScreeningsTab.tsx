import { serverApi } from '@/lib/api-server';
import { CandidateScreenings, type CandidateScreeningsResponse } from './CandidateScreenings';

export async function CandidateScreeningsTab({ organizationId }: { organizationId: string }) {
  const response = await serverApi.get<CandidateScreeningsResponse>(
    '/v1/people/candidate-screenings',
    { 'X-Organization-Id': organizationId },
  );
  return (
    <CandidateScreenings organizationId={organizationId} initialData={response.data ?? undefined} />
  );
}
