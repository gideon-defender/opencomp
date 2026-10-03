'use client';

import { useApi } from '@/hooks/use-api';
import { apiClient } from '@/lib/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type AccessRequest = {
  id: string;
  name: string;
  email: string;
  company?: string | null;
  jobTitle?: string | null;
  purpose?: string | null;
  requestedDurationDays?: number | null;
  status: 'under_review' | 'approved' | 'denied' | 'canceled';
  createdAt: string;
  reviewedAt?: string | null;
  decisionReason?: string | null;
  reviewer?: {
    id: string;
    user: { name: string; email: string };
  } | null;
  grant?: {
    id: string;
    status: string;
    expiresAt: string;
  } | null;
};

export type AccessGrant = {
  id: string;
  subjectEmail: string;
  status: 'active' | 'expired' | 'revoked';
  expiresAt: string;
  accessRequestId: string;
  revokedAt?: string | null;
  revokeReason?: string | null;
  createdAt: string;
};

type ApproveAccessRequestResponse = {
  message: string;
  request?: AccessRequest;
  grant?: AccessGrant;
  ndaAgreement?: unknown;
};

export function useAccessRequests(orgId: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['trust-access-requests', orgId],
    queryFn: async () => {
      const response = await api.get<AccessRequest[]>('/v1/trust-access/admin/requests');

      if (response.error) {
        throw new Error(response.error);
      }

      return response.data!;
    },
  });
}

export function useApproveAccessRequest(orgId: string) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestId,
      durationDays,
    }: {
      requestId: string;
      durationDays: number;
    }) => {
      const response = await api.post<ApproveAccessRequestResponse>(
        `/v1/trust-access/admin/requests/${requestId}/approve`,
        { durationDays },
      );

      if (response.error) {
        throw new Error(response.error);
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['trust-access-requests', orgId],
      });
    },
  });
}

export function useDenyAccessRequest(orgId: string) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) => {
      const response = await api.post(`/v1/trust-access/admin/requests/${requestId}/deny`, {
        reason,
      });

      if (response.error) {
        throw new Error(response.error);
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['trust-access-requests', orgId],
      });
    },
  });
}

export function useAccessRequest(orgId: string, requestId: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['trust-access-request', orgId, requestId],
    queryFn: async () => {
      const response = await api.get<AccessRequest>(`/v1/trust-access/admin/requests/${requestId}`);

      if (response.error) {
        throw new Error(response.error);
      }

      return response.data!;
    },
  });
}

export function useAccessGrants(orgId: string) {
  const api = useApi();

  return useQuery({
    queryKey: ['trust-access-grants', orgId],
    queryFn: async () => {
      const response = await api.get<AccessGrant[]>('/v1/trust-access/admin/grants');

      if (response.error) {
        throw new Error(response.error);
      }

      return response.data!;
    },
  });
}

export function useRevokeAccessGrant(orgId: string) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ grantId, reason }: { grantId: string; reason: string }) => {
      const response = await api.post(`/v1/trust-access/admin/grants/${grantId}/revoke`, {
        reason,
      });

      if (response.error) {
        throw new Error(response.error);
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['trust-access-grants', orgId],
      });
    },
  });
}

export function useResendAccessEmail(orgId: string) {
  const api = useApi();

  return useMutation({
    mutationFn: async (grantId: string) => {
      const response = await api.post(
        `/v1/trust-access/admin/grants/${grantId}/resend-access-email`,
        {},
      );

      if (response.error) {
        throw new Error(response.error);
      }

      return response.data;
    },
  });
}

export function useResendNda(orgId: string) {
  const api = useApi();

  return useMutation({
    mutationFn: async (requestId: string) => {
      const response = await api.post(
        `/v1/trust-access/admin/requests/${requestId}/resend-nda`,
        {},
      );

      if (response.error) {
        throw new Error(response.error);
      }

      return response.data;
    },
  });
}

/**
 * Fetch the watermarked NDA preview PDF bytes through the API.
 * Uses the raw client (cookies authenticate the GET) so failures surface
 * as thrown errors instead of a blank tab or raw JSON.
 */
export async function fetchPreviewNdaPdf(requestId: string): Promise<Blob> {
  const endpoint = `/v1/trust-access/admin/requests/${encodeURIComponent(requestId)}/preview-nda`;
  const response = await apiClient.raw(endpoint, { method: 'GET' });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Access request not found');
    }
    if (response.status === 401) {
      throw new Error('Session expired — sign in again to preview');
    }
    if (response.status === 403) {
      throw new Error('Missing permission to preview this NDA');
    }
    throw new Error('Failed to generate preview');
  }

  return response.blob();
}
