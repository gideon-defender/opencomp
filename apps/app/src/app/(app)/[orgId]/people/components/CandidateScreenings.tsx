'use client';

import { apiClient } from '@/lib/api-client';
import useSWR from 'swr';

export interface CandidateScreeningSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
}
export interface CandidateScreeningsResponse {
  data: CandidateScreeningSummary[];
  count: number;
}

const statusLabels: Record<string, string> = {
  queued: 'Queued',
  dispatching: 'Sending to Checkr',
  invited: 'Checkr invitation sent',
  refunding: 'Releasing screening allowance',
  failed: 'Dispatch failed',
  needs_review: 'Dispatch needs review',
};

export function CandidateScreenings({
  organizationId,
  initialData,
}: {
  organizationId: string;
  initialData?: CandidateScreeningsResponse;
}) {
  const { data, error, isLoading } = useSWR(
    ['/v1/people/candidate-screenings', organizationId],
    async ([endpoint, orgId]: [string, string]) => {
      const response = await apiClient.get<CandidateScreeningsResponse>(endpoint, orgId);
      if (response.error || !response.data) throw new Error('Could not load candidate screenings.');
      return response.data;
    },
    { fallbackData: initialData, revalidateOnMount: !initialData, refreshInterval: 30_000 },
  );
  if (error) return <p role="alert">Could not load candidate screenings.</p>;
  if (isLoading) return <p role="status">Loading candidate screenings…</p>;
  const screenings = Array.isArray(data?.data) ? data.data : [];
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Candidates are separate from user accounts. This view tracks screening dispatch and Checkr
        invitations; completion and identity provisioning are managed by Gideon.
      </p>
      {screenings.length === 0 ? (
        <p>No candidate screenings yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3">Candidate</th>
                <th className="p-3">Email</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {screenings.map((screening) => (
                <tr key={screening.id} className="border-b last:border-0">
                  <td className="p-3">
                    {screening.firstName} {screening.lastName}
                  </td>
                  <td className="p-3">{screening.email}</td>
                  <td className="p-3">
                    {statusLabels[screening.status] ?? 'Status unavailable'}
                    {screening.errorCode === 'background_check_subscription_required' && (
                      <p className="text-muted-foreground">
                        Choose a background check plan before screening.
                      </p>
                    )}
                    {screening.errorCode === 'background_check_subscription_exhausted' && (
                      <p className="text-muted-foreground">No screening allowance remaining.</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(data?.count ?? 0) > screenings.length && (
        <p className="text-muted-foreground text-sm">
          Showing the latest {screenings.length} of {data?.count} screening attempts.
        </p>
      )}
    </div>
  );
}
