'use client';

import { format } from 'date-fns';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { parseRolesString } from '@/lib/permissions';
import { getInitials } from '@/lib/utils';
import type { Role } from '@db';
import { Avatar, AvatarFallback, AvatarImage } from '@gideon-defender/ui/avatar';
import { Badge } from '@gideon-defender/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@gideon-defender/ui/dropdown-menu';
import { TableCell, TableRow } from '@gideon-defender/ui/table';
import { Laptop, MoreVertical } from 'lucide-react';

import { toast } from 'sonner';
import { BackgroundCheckVerifiedTick } from '../../components/BackgroundCheckVerifiedTick';
import { MemberRequirementCell } from './MemberRequirementCell';
import { RemoveDeviceAlert } from './RemoveDeviceAlert';
import type {
  BackgroundCheckStatus,
  MemberWithUser,
  TaskCompletion,
  TwoFactorStatus,
} from './TeamMembers';

export type RequirementColumnKey =
  'policies' | 'training' | 'hipaa' | 'device' | 'background' | 'twoFactor';

const ALL_REQUIREMENT_COLUMNS: RequirementColumnKey[] = [
  'policies',
  'training',
  'hipaa',
  'device',
  'background',
  'twoFactor',
];

interface MemberRowProps {
  member: MemberWithUser;
  // Access is Gideon-synced (read-only). Only device unlink stays local.
  onRemoveDevice: (memberId: string) => void;
  isCurrentUserOwner: boolean;
  taskCompletion?: TaskCompletion;
  deviceStatus?: 'compliant' | 'non-compliant' | 'stale' | 'not-installed';
  isDeviceStatusLoading?: boolean;
  backgroundCheckStatus?: BackgroundCheckStatus;
  backgroundCheckStepEnabled?: boolean;
  /** From the org's configured 2FA source; absent when no source is configured. */
  twoFactorStatus?: TwoFactorStatus;
  /** Which requirement columns the table is rendering, in order. */
  requirementColumns?: RequirementColumnKey[];
}

function getRoleLabel(role: string): string {
  const builtInLabels: Record<string, string> = {
    owner: 'Owner',
    admin: 'Admin',
    auditor: 'Auditor',
    employee: 'Employee',
    contractor: 'Contractor',
  };
  // Built-in roles get their known label; custom roles display their name as-is
  return builtInLabels[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

function parseRoles(role: Role | Role[] | string): string[] {
  if (Array.isArray(role)) return role as string[];
  return parseRolesString(role);
}

function isBackgroundCheckComplete(status?: BackgroundCheckStatus): boolean {
  return status === 'completed' || status === 'completed_with_flags';
}

export function MemberRow({
  member,
  onRemoveDevice,
  isCurrentUserOwner,
  taskCompletion,
  deviceStatus,
  isDeviceStatusLoading = false,
  backgroundCheckStatus,
  backgroundCheckStepEnabled = true,
  twoFactorStatus,
  requirementColumns = ALL_REQUIREMENT_COLUMNS,
}: MemberRowProps) {
  const { orgId } = useParams<{ orgId: string }>();

  const [isRemoveDeviceAlertOpen, setIsRemoveDeviceAlertOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isRemovingDevice, setIsRemovingDevice] = useState(false);

  const memberName = member.user.name || member.user.email || 'Member';
  const memberEmail = member.user.email || '';
  const memberAvatar = member.user.image;
  const memberId = member.id;
  const currentRoles = parseRoles(member.role);

  const isAuditorOnly = currentRoles.length > 0 && currentRoles.every((role) => role === 'auditor');
  const isDeactivated = member.deactivated || !member.isActive;
  const profileHref = `/${orgId}/people/${memberId}`;
  const hasCompletedBackgroundCheck = isBackgroundCheckComplete(backgroundCheckStatus);
  const memberExempt = member.backgroundCheckExempt === true;
  const handleRemoveDeviceClick = async () => {
    try {
      setIsRemoveDeviceAlertOpen(false);
      setIsRemovingDevice(true);
      await onRemoveDevice(memberId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to unlink device');
    } finally {
      setIsRemovingDevice(false);
    }
  };

  // Device unlink stays local (device management, not IdP access). All
  // role/invite/membership actions are Gideon-synced and have no local UI.
  const showDeviceAction =
    !isDeactivated &&
    (member.fleetDmLabelId || (deviceStatus && deviceStatus !== 'not-installed')) &&
    isCurrentUserOwner;

  return (
    <>
      <TableRow data-state={isDeactivated ? 'disabled' : undefined}>
        {/* NAME */}
        <TableCell>
          <div className="flex items-center gap-3">
            <div className={`flex-shrink-0 ${isDeactivated ? 'grayscale opacity-60' : ''}`}>
              <Avatar>
                <AvatarImage src={memberAvatar || undefined} />
                <AvatarFallback>{getInitials(memberName)}</AvatarFallback>
              </Avatar>
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <Link
                  href={profileHref}
                  className={`truncate text-sm font-medium hover:underline ${
                    isDeactivated ? 'text-muted-foreground' : ''
                  }`}
                >
                  {memberName}
                </Link>
                {backgroundCheckStepEnabled && !memberExempt && hasCompletedBackgroundCheck && (
                  <BackgroundCheckVerifiedTick />
                )}
              </div>
              <span className="text-muted-foreground">{memberEmail}</span>
            </div>
          </div>
        </TableCell>

        {/* STATUS */}
        <TableCell>
          {isDeactivated ? (
            <Badge variant="destructive">Inactive</Badge>
          ) : (
            <Badge variant="secondary">Active</Badge>
          )}
        </TableCell>

        {/* ROLE (read-only, synced from Gideon) */}
        <TableCell>
          <div className="w-[160px]">
            <div className="flex flex-wrap gap-1">
              {currentRoles.map((role) => (
                <Badge key={role} variant="outline" title="Access is synced from Gideon">
                  {getRoleLabel(role)}
                </Badge>
              ))}
            </div>
          </div>
        </TableCell>

        {/* ONBOARDED */}
        <TableCell>
          {member.onboardDate ? (
            <span className="text-sm text-muted-foreground">
              {format(member.onboardDate, 'MMM d, yyyy')}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* OFFBOARDED */}
        <TableCell>
          {member.offboardDate ? (
            <span className="text-sm text-muted-foreground">
              {format(member.offboardDate, 'MMM d, yyyy')}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Requirement columns */}
        {requirementColumns.map((key) => (
          <TableCell key={key}>
            <MemberRequirementCell
              column={key}
              taskCompletion={taskCompletion}
              deviceStatus={deviceStatus}
              isDeviceStatusLoading={isDeviceStatusLoading}
              backgroundCheckStepEnabled={backgroundCheckStepEnabled}
              twoFactorStatus={twoFactorStatus}
              isDeactivated={isDeactivated}
              memberExempt={memberExempt}
              isAuditorOnly={isAuditorOnly}
              hasCompletedBackgroundCheck={hasCompletedBackgroundCheck}
            />
          </TableCell>
        ))}

        {/* ACTIONS (device-only; access is Gideon-synced) */}
        <TableCell>
          <div className="flex justify-center">
            {showDeviceAction ? (
              <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger
                  aria-label="Member device actions"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <MoreVertical size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setDropdownOpen(false);
                      setIsRemoveDeviceAlertOpen(true);
                    }}
                  >
                    <Laptop size={16} className="mr-2" />
                    <span>Remove Device</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="text-sm text-muted-foreground" title="Access is synced from Gideon">
                —
              </span>
            )}
          </div>
        </TableCell>
      </TableRow>

      <RemoveDeviceAlert
        open={isRemoveDeviceAlertOpen}
        title="Remove Device"
        description={
          <>
            Are you sure you want to remove all devices for this user <strong>{memberName}</strong>?
            This will disconnect all devices from the organization.
          </>
        }
        onOpenChange={setIsRemoveDeviceAlertOpen}
        onRemove={handleRemoveDeviceClick}
        isRemoving={isRemovingDevice}
      />
    </>
  );
}
