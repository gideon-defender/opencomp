import type { RequirementColumnKey } from './MemberRow';
import {
  RequirementBadge,
  RequirementCount,
  RequirementDash,
  RequirementLoading,
} from './RequirementCell';
import type { TaskCompletion, TwoFactorStatus } from './TeamMembers';

interface MemberRequirementCellProps {
  column: RequirementColumnKey;
  taskCompletion?: TaskCompletion;
  deviceStatus?: 'compliant' | 'non-compliant' | 'stale' | 'not-installed';
  isDeviceStatusLoading: boolean;
  backgroundCheckStepEnabled: boolean;
  twoFactorStatus?: TwoFactorStatus;
  isDeactivated: boolean;
  memberExempt: boolean;
  isAuditorOnly: boolean;
  hasCompletedBackgroundCheck: boolean;
}

export function MemberRequirementCell({
  column,
  taskCompletion,
  deviceStatus,
  isDeviceStatusLoading,
  backgroundCheckStepEnabled,
  twoFactorStatus,
  isDeactivated,
  memberExempt,
  isAuditorOnly,
  hasCompletedBackgroundCheck,
}: MemberRequirementCellProps) {
  const shouldShowTaskRequirements = !isDeactivated;
  switch (column) {
    case 'policies':
      return taskCompletion && taskCompletion.policies.total > 0 ? (
        <RequirementCount
          label="Policies"
          completed={taskCompletion.policies.completed}
          total={taskCompletion.policies.total}
        />
      ) : (
        <RequirementDash />
      );
    case 'training':
      return taskCompletion && taskCompletion.training.total > 0 ? (
        <RequirementCount
          label="Training"
          completed={taskCompletion.training.completed}
          total={taskCompletion.training.total}
        />
      ) : (
        <RequirementDash />
      );
    case 'hipaa':
      return taskCompletion?.hipaa ? (
        <RequirementBadge
          label="HIPAA"
          state={taskCompletion.hipaa.completed >= taskCompletion.hipaa.total ? 'done' : 'missing'}
        />
      ) : (
        <RequirementDash />
      );
    case 'device':
      if (!shouldShowTaskRequirements) return <RequirementDash />;
      if (deviceStatus) {
        return (
          <RequirementBadge
            label="Device"
            state={deviceStatus === 'compliant' ? 'done' : 'missing'}
          />
        );
      }
      return isDeviceStatusLoading ? <RequirementLoading /> : <RequirementDash />;
    case 'background':
      return shouldShowTaskRequirements &&
        backgroundCheckStepEnabled &&
        !memberExempt &&
        !isAuditorOnly ? (
        <RequirementBadge
          label="Background"
          state={hasCompletedBackgroundCheck ? 'done' : 'missing'}
        />
      ) : (
        <RequirementDash />
      );
    case 'twoFactor':
      // 2FA applies to EVERY non-deactivated member (platform admins
      // included). Absent status = no 2FA source configured for the org.
      return !isDeactivated && twoFactorStatus ? (
        <RequirementBadge
          label="2FA"
          state={
            twoFactorStatus === 'enabled'
              ? 'done'
              : twoFactorStatus === 'missing'
                ? 'missing'
                : 'not-provided'
          }
        />
      ) : (
        <RequirementDash />
      );
  }
}
