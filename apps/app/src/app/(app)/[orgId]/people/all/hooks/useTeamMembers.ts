'use client';

import { usePeopleActions } from '@/hooks/use-people-api';
import { apiClient } from '@/lib/api-client';
import type { Invitation, Member, User } from '@db';
import { useCallback } from 'react';
import useSWR from 'swr';

interface MemberWithUser extends Member {
  user: User;
}

interface TeamMembersData {
  members: MemberWithUser[];
  pendingInvitations: Invitation[];
}

interface PeopleApiResponse {
  data: MemberWithUser[];
  count: number;
}

interface InvitationsApiResponse {
  data: Invitation[];
}

interface UseTeamMembersOptions {
  organizationId: string;
  initialData?: TeamMembersData;
}

async function fetchTeamMembers(): Promise<TeamMembersData> {
  const [membersRes, invitationsRes] = await Promise.all([
    apiClient.get<PeopleApiResponse>('/v1/people?includeDeactivated=true'),
    apiClient.get<InvitationsApiResponse>('/v1/auth/invitations'),
  ]);

  const members = Array.isArray(membersRes.data?.data) ? membersRes.data.data : [];

  // Handle case where invitations endpoint might not exist yet
  // Fall back to empty array if there's an error
  const pendingInvitations = Array.isArray(invitationsRes.data?.data)
    ? invitationsRes.data.data
    : [];

  return { members, pendingInvitations };
}

export function useTeamMembers({ organizationId, initialData }: UseTeamMembersOptions) {
  const { unlinkDevice } = usePeopleActions();

  const { data, error, isLoading, mutate } = useSWR<TeamMembersData>(
    organizationId ? ['team-members', organizationId] : null,
    fetchTeamMembers,
    {
      fallbackData: initialData,
      revalidateOnMount: !initialData,
      revalidateOnFocus: false,
    },
  );

  const members = Array.isArray(data?.members) ? data.members : [];
  const pendingInvitations = Array.isArray(data?.pendingInvitations) ? data.pendingInvitations : [];

  const removeDevice = useCallback(
    async (memberId: string) => {
      await unlinkDevice(memberId);
      await mutate();
    },
    [unlinkDevice, mutate],
  );

  const revalidate = useCallback(() => mutate(), [mutate]);

  return {
    members,
    pendingInvitations,
    isLoading,
    error,
    removeDevice,
    revalidate,
  };
}
