import { serverApi } from '@/lib/api-server';
import { filterComplianceMembers } from '@/lib/compliance';
import { HIPAA_TRAINING_ID } from '@/lib/data/hipaa-training-content';
import { trainingVideos as trainingVideosData } from '@/lib/data/training-videos';
import type { Invitation, Member, User } from '@db';
import { db } from '@db/server';
import type { BackgroundCheckStatus } from '../../[employeeId]/components/backgroundCheckTypes';
import { loadPeopleDirectory } from '../data/load-people-directory';
import { getEmployeeSyncConnections } from '../data/queries';
import { TeamMembersClient } from './TeamMembersClient';
import { buildTwoFactorStatusMap, type TwoFactorStatusesResponse } from './two-factor-status-map';

export type { TwoFactorStatus } from './two-factor-status-map';
export type { BackgroundCheckStatus };

export interface MemberWithUser extends Member {
  user: User;
  backgroundCheckRequests?: BackgroundCheckSummary[];
}

export interface BackgroundCheckSummary {
  id: string;
  status: BackgroundCheckStatus;
}

export interface TeamMembersData {
  members: MemberWithUser[];
  pendingInvitations: Invitation[];
}

export interface TaskCompletion {
  completed: number;
  total: number;
  policies: { completed: number; total: number };
  training: { completed: number; total: number };
  hipaa?: { completed: number; total: number };
}

interface TeamMembersProps {
  canManageMembers: boolean;
  canInviteUsers: boolean;
  isCurrentUserOwner: boolean;
  organizationId: string;
}

export async function TeamMembers(props: TeamMembersProps) {
  const { canManageMembers, canInviteUsers, isCurrentUserOwner, organizationId } = props;

  if (!organizationId) {
    return null;
  }

  // Fetch members, invitations, and 2FA statuses from API
  const tenantHeaders = { 'X-Organization-Id': organizationId };
  const [members, invitationsRes, twoFactorRes] = await Promise.all([
    loadPeopleDirectory(organizationId),
    serverApi.get<{ data: Invitation[] }>('/v1/auth/invitations', tenantHeaders),
    serverApi.get<TwoFactorStatusesResponse>(
      '/v1/integrations/sync/two-factor-statuses',
      tenantHeaders,
    ),
  ]);

  if (members === null) {
    return <p role="alert">Unable to load people. Please refresh the page or try again later.</p>;
  }
  const pendingInvitations: Invitation[] = Array.isArray(invitationsRes.data?.data)
    ? invitationsRes.data.data
    : [];

  const data: TeamMembersData = { members, pendingInvitations };

  // Empty when no 2FA source is configured (or the fetch failed) — rows then
  // show no 2FA entry rather than a wrong one.
  const twoFactorStatusMap = buildTwoFactorStatusMap(members, twoFactorRes.data ?? undefined);

  // Fetch employee sync connections server-side
  const employeeSyncData = await getEmployeeSyncConnections(organizationId);

  // Build task completion map for employees/contractors
  const taskCompletionMap: Record<string, TaskCompletion> = {};

  const employeeMembers = await filterComplianceMembers(members, organizationId);
  const complianceMemberIds = employeeMembers.map((m) => m.id);

  const [orgFlags, hipaaInstance] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        securityTrainingStepEnabled: true,
        backgroundCheckStepEnabled: true,
      },
    }),
    db.frameworkInstance.findFirst({
      where: { organizationId, framework: { name: 'HIPAA' } },
      select: { id: true },
    }),
  ]);
  const backgroundCheckStepEnabled = orgFlags?.backgroundCheckStepEnabled === true;
  const hasHipaaFramework = !!hipaaInstance;

  const policies = await db.policy.findMany({
    where: {
      organizationId,
      isRequiredToSign: true,
      status: 'published',
      isArchived: false,
    },
  });

  // Column visibility must come from ORG-LEVEL tracking, not from member data:
  // an org with tracking enabled but no compliance members yet still shows the
  // columns (as dashes), never silently hides them.
  const requirementTracking = {
    policies: policies.length > 0,
    training: orgFlags?.securityTrainingStepEnabled === true && trainingVideosData.length > 0,
    hipaa: hasHipaaFramework,
  };

  if (employeeMembers.length > 0) {
    const employeeIds = employeeMembers.map((m) => m.id);
    const trainingCompletions = orgFlags?.securityTrainingStepEnabled
      ? await db.employeeTrainingVideoCompletion.findMany({
          where: { memberId: { in: employeeIds } },
        })
      : [];

    const totalPolicies = policies.length;
    const totalTrainingVideos = orgFlags?.securityTrainingStepEnabled
      ? trainingVideosData.length
      : 0;
    const totalHipaaTraining = hasHipaaFramework ? 1 : 0;
    const totalTasks = totalPolicies + totalTrainingVideos + totalHipaaTraining;

    for (const employee of employeeMembers) {
      const policiesCompleted = policies.filter((p) => p.signedBy.includes(employee.id)).length;

      const trainingsCompleted = orgFlags?.securityTrainingStepEnabled
        ? trainingCompletions.filter(
            (tc) =>
              tc.memberId === employee.id &&
              tc.completedAt !== null &&
              tc.videoId !== HIPAA_TRAINING_ID,
          ).length
        : 0;

      const hipaaCompleted =
        hasHipaaFramework &&
        trainingCompletions.some(
          (tc) =>
            tc.memberId === employee.id &&
            tc.videoId === HIPAA_TRAINING_ID &&
            tc.completedAt !== null,
        )
          ? 1
          : 0;

      taskCompletionMap[employee.id] = {
        completed: policiesCompleted + trainingsCompleted + hipaaCompleted,
        total: totalTasks,
        policies: { completed: policiesCompleted, total: totalPolicies },
        training: { completed: trainingsCompleted, total: totalTrainingVideos },
        ...(hasHipaaFramework && {
          hipaa: { completed: hipaaCompleted, total: 1 },
        }),
      };
    }
  }

  return (
    <TeamMembersClient
      data={data}
      organizationId={organizationId}
      canManageMembers={canManageMembers}
      canInviteUsers={canInviteUsers}
      isCurrentUserOwner={isCurrentUserOwner}
      employeeSyncData={employeeSyncData}
      taskCompletionMap={taskCompletionMap}
      complianceMemberIds={complianceMemberIds}
      backgroundCheckStepEnabled={backgroundCheckStepEnabled}
      twoFactorStatusMap={twoFactorStatusMap}
      requirementTracking={requirementTracking}
    />
  );
}
