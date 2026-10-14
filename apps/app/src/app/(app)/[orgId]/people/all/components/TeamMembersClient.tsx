'use client';

import { useTranslations } from 'next-intl';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { usePeopleActions } from '@/hooks/use-people-api';
import type { Invitation } from '@db';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Separator,
  Stack,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@trycompai/design-system';
import { InProgress, Search, SettingsAdjust } from '@trycompai/design-system/icons';

import { useMemo } from 'react';
import { useAgentDevices } from '../../devices/hooks/useAgentDevices';
import { useFleetHosts } from '../../devices/hooks/useFleetHosts';
import { computeDeviceStatusMap } from './compute-device-status-map';
import { buildDisplayItems, filterDisplayItems } from './filter-members';
import { MemberRow, type RequirementColumnKey } from './MemberRow';
import { PendingInvitationRow } from './PendingInvitationRow';
import { PeopleFilters } from './PeopleFilters';
import type {
  MemberWithUser,
  TaskCompletion,
  TeamMembersData,
  TwoFactorStatus,
} from './TeamMembers';
import { TwoFactorSourceSelector } from './TwoFactorSourceSelector';

import type { EmployeeSyncConnectionsData } from '../data/queries';
import { useEmployeeSync } from '../hooks/useEmployeeSync';

// Sentinel value for the "Don't auto-sync" item in the sync-source dropdown.
// Radix Select items can't have an empty value, so disabling is modeled as a
// distinct option rather than the absence of a selection.
const NO_SYNC_VALUE = '__no_sync__';

const requirementColumnLabel = (
  key: RequirementColumnKey,
  t: ReturnType<typeof useTranslations<'people'>>,
): string => {
  switch (key) {
    case 'policies':
      return t('team.colPolicies');
    case 'training':
      return t('team.colTraining');
    case 'hipaa':
      return 'HIPAA';
    case 'device':
      return t('team.colDevice');
    case 'background':
      return t('team.colBackground');
    case 'twoFactor':
      return '2FA';
  }
};

interface TeamMembersClientProps {
  data: TeamMembersData;
  organizationId: string;
  canManageMembers: boolean;
  canInviteUsers: boolean;
  isCurrentUserOwner: boolean;
  employeeSyncData: EmployeeSyncConnectionsData;
  taskCompletionMap: Record<string, TaskCompletion>;
  complianceMemberIds: string[];
  backgroundCheckStepEnabled: boolean;
  twoFactorStatusMap: Record<string, TwoFactorStatus>;
  /** Org-level tracking flags — column visibility never depends on member data. */
  requirementTracking: { policies: boolean; training: boolean; hipaa: boolean };
}

export function TeamMembersClient({
  data,
  organizationId,
  canManageMembers,
  isCurrentUserOwner,
  employeeSyncData,
  taskCompletionMap,
  complianceMemberIds,
  backgroundCheckStepEnabled,
  twoFactorStatusMap,
  requirementTracking,
}: TeamMembersClientProps) {
  const t = useTranslations('people');
  const { agentDevices, isLoading: isAgentDevicesLoading } = useAgentDevices();
  const { fleetHosts, isLoading: isFleetHostsLoading } = useFleetHosts();
  const isDeviceStatusLoading = isAgentDevicesLoading || isFleetHostsLoading;

  const deviceStatusMap = useMemo(
    () => computeDeviceStatusMap({ agentDevices, fleetHosts, complianceMemberIds }),
    [agentDevices, fleetHosts, complianceMemberIds],
  );

  // Which requirement columns the table shows, in order. A column only exists
  // when the underlying tracking applies to this org (flag on / framework
  // present / 2FA source configured), so orgs never see empty dash columns.
  const requirementColumns = useMemo<RequirementColumnKey[]>(() => {
    const cols: RequirementColumnKey[] = [];
    if (requirementTracking.policies) cols.push('policies');
    if (requirementTracking.training) cols.push('training');
    if (requirementTracking.hipaa) cols.push('hipaa');
    if (complianceMemberIds.length > 0) cols.push('device');
    if (backgroundCheckStepEnabled) cols.push('background');
    if (Object.keys(twoFactorStatusMap).length > 0) cols.push('twoFactor');
    return cols;
  }, [requirementTracking, complianceMemberIds, backgroundCheckStepEnabled, twoFactorStatusMap]);
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [onboardFrom, setOnboardFrom] = useState<Date | undefined>();
  const [onboardTo, setOnboardTo] = useState<Date | undefined>();
  const [offboardFrom, setOffboardFrom] = useState<Date | undefined>();
  const [offboardTo, setOffboardTo] = useState<Date | undefined>();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const { unlinkDevice } = usePeopleActions();

  // Employee sync hook with server-fetched initial data
  const {
    googleWorkspaceConnectionId,
    ripplingConnectionId,
    jumpcloudConnectionId,
    selectedProvider,
    isSyncing,
    syncEmployees,
    setSyncProvider,
    hasAnyConnection,
    getProviderName,
    getProviderLogo,
    availableProviders,
  } = useEmployeeSync({ organizationId, initialData: employeeSyncData });

  const lastSyncAt = employeeSyncData.lastSyncAt;
  const nextSyncAt = employeeSyncData.nextSyncAt;
  const [isDisablingSync, setIsDisablingSync] = useState(false);

  const handleEmployeeSync = async (provider: string) => {
    const result = await syncEmployees(provider);
    if (result?.success) {
      router.refresh();
    }
  };

  // Turn off the daily auto-sync without disconnecting the integration (which
  // would also stop its compliance checks). Clears the org's sync provider so
  // the scheduled job skips it; already-imported people are left untouched.
  // Sets a busy flag (mirroring isSyncing) so the dropdown is locked while the
  // request is in flight, preventing an overlapping provider change from racing.
  const handleDisableSync = async () => {
    if (!selectedProvider || isDisablingSync) return;
    setIsDisablingSync(true);
    try {
      await setSyncProvider(null);
    } finally {
      setIsDisablingSync(false);
    }
  };

  const allItems = buildDisplayItems(data);
  const hasOffboardFilter = !!(offboardFrom || offboardTo);
  const effectiveStatusFilter = hasOffboardFilter && !statusFilter ? 'all' : statusFilter;
  const filteredItems = filterDisplayItems({
    items: allItems,
    searchQuery,
    roleFilter,
    statusFilter: effectiveStatusFilter,
  });

  const hasAnyDateFilter = !!(onboardFrom || onboardTo || offboardFrom || offboardTo);

  const dateFilteredItems = filteredItems.filter((item) => {
    if (item.type !== 'member') return !hasAnyDateFilter;
    const member = item as MemberWithUser;

    if (onboardFrom || onboardTo) {
      if (!member.onboardDate) return false;
      const onboard = member.onboardDate;
      const d = new Date(onboard);
      if (onboardFrom && d < onboardFrom) return false;
      if (onboardTo) {
        const end = new Date(onboardTo);
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
      }
    }

    if (offboardFrom || offboardTo) {
      if (!member.offboardDate) return false;
      const d = new Date(member.offboardDate);
      if (offboardFrom && d < offboardFrom) return false;
      if (offboardTo) {
        const end = new Date(offboardTo);
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
      }
    }

    return true;
  });

  const activeMembers = dateFilteredItems.filter((item) => item.type === 'member');
  const pendingInvites = dateFilteredItems.filter((item) => item.type === 'invitation');

  // Combine all items for table display
  const allDisplayItems = [...activeMembers, ...pendingInvites];
  const totalItems = allDisplayItems.length;
  const pageCount = Math.ceil(totalItems / perPage);
  const paginatedItems = allDisplayItems.slice((page - 1) * perPage, page * perPage);

  const pageSizeOptions = [10, 25, 50, 100];

  const handleRemoveDevice = async (memberId: string) => {
    await unlinkDevice(memberId);
    toast.success(t('team.deviceUnlinked'));
    router.refresh(); // Revalidate data to update UI
  };

  return (
    <Stack gap="4">
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Access is synced from Gideon. Roles, invitations, and membership changes happen in Gideon —
        this directory is read-only for access.
      </div>
      {/* Search and Filters */}
      {/* Left = query (search, filters); right = view configuration (data
          sources) — the Linear/Stripe toolbar convention. */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="w-full md:max-w-[300px]">
            <InputGroup>
              <InputGroupAddon>
                <Search size={16} />
              </InputGroupAddon>
              <InputGroupInput
                placeholder={t('team.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </InputGroup>
          </div>
          <PeopleFilters
            statusFilter={statusFilter}
            hasOffboardFilter={hasOffboardFilter}
            onStatusChange={(value) => {
              setStatusFilter(value ?? '');
              setPage(1);
            }}
            roleFilter={roleFilter}
            onRoleChange={(value) => {
              setRoleFilter(value === 'all' ? '' : (value ?? ''));
              setPage(1);
            }}
            onboardFrom={onboardFrom}
            onboardTo={onboardTo}
            onOnboardApply={(from, to) => {
              setOnboardFrom(from);
              setOnboardTo(to);
              setPage(1);
            }}
            onOnboardClear={() => {
              setOnboardFrom(undefined);
              setOnboardTo(undefined);
              setPage(1);
            }}
            offboardFrom={offboardFrom}
            offboardTo={offboardTo}
            onOffboardApply={(from, to) => {
              setOffboardFrom(from);
              setOffboardTo(to);
              setPage(1);
            }}
            onOffboardClear={() => {
              setOffboardFrom(undefined);
              setOffboardTo(undefined);
              setPage(1);
            }}
          />
        </div>
        {/* Source settings (sync / 2FA) — settings, not filters, so they get
            their own compact popover, symmetric with the Filters button. */}
        <Popover>
          <PopoverTrigger>
            <div className="border-border bg-background hover:bg-muted flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm transition-colors">
              <SettingsAdjust size={16} className="text-muted-foreground" />
              {t('team.syncSettings')}
            </div>
          </PopoverTrigger>
          <PopoverContent align="end" style={{ width: 'auto' }}>
            <div className="flex w-[280px] flex-col gap-4 p-1.5">
              {!hasAnyConnection && (
                <div className="flex w-full flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t('team.people')}</span>
                  <Link
                    href={`/${organizationId}/integrations`}
                    className="border-border text-muted-foreground hover:bg-muted flex h-8 items-center justify-between rounded-md border border-dashed px-3 text-sm transition-colors"
                  >
                    {t('team.connectIntegration')}
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              )}
              {hasAnyConnection && (
                <div className="flex w-full">
                  <div className="flex w-full flex-col gap-1">
                    <span id="employee-sync-source-label" className="text-xs text-muted-foreground">
                      {t('team.people')}
                    </span>
                    <Select
                      onValueChange={(value) => {
                        const provider = String(value);
                        if (!provider) return;
                        if (provider === NO_SYNC_VALUE) {
                          handleDisableSync();
                          return;
                        }
                        handleEmployeeSync(provider);
                      }}
                      disabled={isSyncing || isDisablingSync || !canManageMembers}
                    >
                      <SelectTrigger aria-label={t('team.syncPeopleFrom')}>
                        {isSyncing ? (
                          <>
                            <InProgress size={16} className="mr-2 animate-spin" />
                            {t('team.syncing')}
                          </>
                        ) : selectedProvider ? (
                          <div className="flex items-center gap-2">
                            {getProviderLogo(selectedProvider) && (
                              <Image
                                src={getProviderLogo(selectedProvider)}
                                alt=""
                                width={16}
                                height={16}
                                className="rounded-sm"
                                unoptimized
                              />
                            )}
                            <span className="truncate">{getProviderName(selectedProvider)}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{t('team.notSyncing')}</span>
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <div className="px-2 py-1.5 text-xs text-muted-foreground space-y-1">
                          {selectedProvider ? (
                            <>
                              <div>{t('team.autoSyncSchedule')}</div>
                              {lastSyncAt && (
                                <div className="text-xs text-muted-foreground/80">
                                  {t('team.lastSync', {
                                    date: new Date(lastSyncAt).toLocaleString(),
                                  })}
                                </div>
                              )}
                              {nextSyncAt && (
                                <div className="text-xs text-muted-foreground/80">
                                  {t('team.nextSync', {
                                    date: new Date(nextSyncAt).toLocaleString(),
                                  })}
                                </div>
                              )}
                            </>
                          ) : (
                            t('team.selectProviderHint')
                          )}
                        </div>
                        <Separator />
                        {googleWorkspaceConnectionId && (
                          <SelectItem value="google-workspace">
                            <div className="flex items-center gap-2">
                              <Image
                                src={getProviderLogo('google-workspace')}
                                alt="Google"
                                width={16}
                                height={16}
                                className="rounded-sm"
                                unoptimized
                              />
                              Google Workspace
                              {selectedProvider === 'google-workspace' && (
                                <span className="ml-auto text-xs text-muted-foreground">
                                  {t('team.active')}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        )}
                        {ripplingConnectionId && (
                          <SelectItem value="rippling">
                            <div className="flex items-center gap-2">
                              <Image
                                src={getProviderLogo('rippling')}
                                alt="Rippling"
                                width={16}
                                height={16}
                                className="rounded-sm"
                                unoptimized
                              />
                              Rippling
                              {selectedProvider === 'rippling' && (
                                <span className="ml-auto text-xs text-muted-foreground">
                                  {t('team.active')}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        )}
                        {jumpcloudConnectionId && (
                          <SelectItem value="jumpcloud">
                            <div className="flex items-center gap-2">
                              <Image
                                src={getProviderLogo('jumpcloud')}
                                alt="JumpCloud"
                                width={16}
                                height={16}
                                className="rounded-sm"
                                unoptimized
                              />
                              JumpCloud
                              {selectedProvider === 'jumpcloud' && (
                                <span className="ml-auto text-xs text-muted-foreground">
                                  {t('team.active')}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        )}
                        {/* Dynamic sync providers (from dynamic integrations) */}
                        {availableProviders
                          .filter(
                            (p) =>
                              p.connected &&
                              !['google-workspace', 'rippling', 'jumpcloud'].includes(p.slug),
                          )
                          .map((provider) => (
                            <SelectItem key={provider.slug} value={provider.slug}>
                              <div className="flex items-center gap-2">
                                {provider.logoUrl && (
                                  <Image
                                    src={provider.logoUrl}
                                    alt={provider.name}
                                    width={16}
                                    height={16}
                                    className="rounded-sm"
                                    unoptimized
                                  />
                                )}
                                {provider.name}
                                {selectedProvider === provider.slug && (
                                  <span className="ml-auto text-xs text-muted-foreground">
                                    {t('team.active')}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        <Separator />
                        <SelectItem value={NO_SYNC_VALUE}>
                          <div className="flex items-center gap-2">
                            <span>{t('team.dontAutoSync')}</span>
                            {!selectedProvider && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                {t('team.active')}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <TwoFactorSourceSelector />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Table */}
      {totalItems === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {searchQuery ? t('team.noPeopleFound') : t('team.noEmployeesYet')}
            </EmptyTitle>
            <EmptyDescription>
              {searchQuery
                ? t('team.tryAdjustingSearch')
                : 'No people yet. Membership is provisioned from Gideon assignments.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table
          variant="bordered"
          pagination={{
            page,
            pageCount,
            onPageChange: setPage,
            pageSize: perPage,
            pageSizeOptions,
            onPageSizeChange: (size) => {
              setPerPage(size);
              setPage(1);
            },
          }}
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t('team.colName')}</TableHead>
              <TableHead>{t('team.colStatus')}</TableHead>
              <TableHead>
                <div className="w-[160px]">{t('team.colRole')}</div>
              </TableHead>
              <TableHead>{t('team.colOnboarded')}</TableHead>
              <TableHead>{t('team.colOffboarded')}</TableHead>
              {requirementColumns.map((col) => (
                <TableHead key={col}>{requirementColumnLabel(col, t)}</TableHead>
              ))}
              <TableHead>{t('team.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedItems.map((item) =>
              item.type === 'member' ? (
                <MemberRow
                  key={item.displayId}
                  member={item as MemberWithUser}
                  onRemoveDevice={handleRemoveDevice}
                  isCurrentUserOwner={isCurrentUserOwner}
                  taskCompletion={taskCompletionMap[(item as MemberWithUser).id]}
                  deviceStatus={deviceStatusMap[(item as MemberWithUser).id]}
                  isDeviceStatusLoading={isDeviceStatusLoading}
                  backgroundCheckStatus={
                    (item as MemberWithUser).backgroundCheckRequests?.[0]?.status
                  }
                  backgroundCheckStepEnabled={backgroundCheckStepEnabled}
                  twoFactorStatus={twoFactorStatusMap[(item as MemberWithUser).id]}
                  requirementColumns={requirementColumns}
                />
              ) : (
                <PendingInvitationRow
                  key={item.displayId}
                  requirementColumnCount={requirementColumns.length}
                  invitation={item as Invitation}
                />
              ),
            )}
          </TableBody>
        </Table>
      )}
    </Stack>
  );
}
