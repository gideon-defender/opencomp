import { Logger } from '@nestjs/common';
import { db } from '@db';
import { orgParticipantMemberWhere } from '../utils/org-participation';
import { FleetService } from '../lib/fleet.service';

const MDM_POLICY_ID = -9999;
const logger = new Logger('PeopleFleetHelper');

export interface FleetPolicyResult {
  id: number;
  name: string;
  response: string;
  attachments: unknown[];
  query?: string;
  critical?: boolean;
  description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractFirstHostId(data: unknown): number | null {
  if (!isRecord(data)) return null;
  const hosts = data.hosts;
  if (!Array.isArray(hosts) || hosts.length === 0) return null;
  const first = hosts[0];
  if (!isRecord(first)) return null;
  const id: unknown = first.id;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  if (typeof id === 'string' && id.trim() !== '' && Number.isFinite(Number(id)))
    return Number(id);
  return null;
}

function extractHostRecord(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  const host: unknown = data.host;
  return isRecord(host) ? host : null;
}

function extractHostId(host: Record<string, unknown>): number | null {
  const id: unknown = host.id;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  if (typeof id === 'string' && id.trim() !== '' && Number.isFinite(Number(id)))
    return Number(id);
  return null;
}

function extractHostsList(data: unknown): Record<string, unknown>[] {
  if (!isRecord(data)) return [];
  const hosts: unknown = data.hosts;
  if (!Array.isArray(hosts)) return [];
  return hosts.filter(isRecord);
}

function buildPoliciesWithResults(
  host: Record<string, unknown>,
  results: {
    fleetPolicyId: number;
    fleetPolicyResponse: string | null;
    attachments: unknown;
  }[],
) {
  const platform = (host.platform as string)?.toLowerCase();
  const osVersion = (host.os_version as string)?.toLowerCase();
  const isMacOS =
    platform === 'darwin' ||
    platform === 'macos' ||
    platform === 'osx' ||
    osVersion?.includes('mac');

  const hostPolicies = (host.policies || []) as {
    id: number;
    name: string;
    response: string;
  }[];
  const mdm = host.mdm as { connected_to_fleet?: boolean } | undefined;

  const allPolicies = [
    ...hostPolicies,
    ...(isMacOS && mdm
      ? [
          {
            id: MDM_POLICY_ID,
            name: 'MDM Enabled',
            response: mdm.connected_to_fleet ? 'pass' : 'fail',
          },
        ]
      : []),
  ];

  return allPolicies.map((policy) => {
    const policyResult = results.find((r) => r.fleetPolicyId === policy.id);
    return {
      ...policy,
      response:
        policy.response === 'pass' ||
        policyResult?.fleetPolicyResponse === 'pass'
          ? 'pass'
          : 'fail',
      attachments: policyResult?.attachments || [],
    };
  }) as FleetPolicyResult[];
}

export async function getFleetComplianceForMember(
  fleetService: FleetService,
  memberId: string,
  organizationId: string,
  memberFleetLabelId: number | null,
  memberUserId: string,
) {
  if (!memberFleetLabelId) {
    return { fleetPolicies: [], device: null };
  }

  try {
    const labelHostsData: unknown =
      await fleetService.getHostsByLabel(memberFleetLabelId);
    const firstHostId = extractFirstHostId(labelHostsData);

    if (firstHostId === null) {
      return { fleetPolicies: [], device: null };
    }

    const hostData: unknown = await fleetService.getHostById(firstHostId);
    const host = extractHostRecord(hostData);

    if (!host) {
      return { fleetPolicies: [], device: null };
    }

    const results = await db.fleetPolicyResult.findMany({
      where: { organizationId, userId: memberUserId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      fleetPolicies: buildPoliciesWithResults(host, results),
      device: host,
    };
  } catch (error) {
    logger.error(
      `Failed to get fleet compliance for member ${memberId}:`,
      error,
    );
    return { fleetPolicies: [], device: null };
  }
}

export async function getAllEmployeeDevices(
  fleetService: FleetService,
  organizationId: string,
) {
  try {
    const participantWhere = await orgParticipantMemberWhere(organizationId);
    const employees = await db.member.findMany({
      where: {
        organizationId,
        deactivated: false,
        ...participantWhere,
      },
      include: { user: true },
    });

    const membersWithLabels = employees.filter((e) => e.fleetDmLabelId);
    if (membersWithLabels.length === 0) return [];

    const labelResponses = await Promise.all(
      membersWithLabels.map(async (employee) => {
        try {
          const data: unknown = await fleetService.getHostsByLabel(
            employee.fleetDmLabelId!,
          );
          return {
            userId: employee.userId,
            userName: employee.user?.name,
            memberId: employee.id,
            hosts: extractHostsList(data),
          };
        } catch {
          return {
            userId: employee.userId,
            userName: employee.user?.name,
            memberId: employee.id,
            hosts: [],
          };
        }
      }),
    );

    const hostRequests = labelResponses.flatMap((entry) =>
      entry.hosts
        .map((host) => ({
          userId: entry.userId,
          memberId: entry.memberId,
          userName: entry.userName,
          hostId: extractHostId(host),
        }))
        .filter(
          (req): req is typeof req & { hostId: number } => req.hostId !== null,
        ),
    );

    if (hostRequests.length === 0) return [];

    const devices: unknown[] = await Promise.all(
      hostRequests.map(async ({ hostId }) => {
        try {
          const device: unknown = await fleetService.getHostById(hostId);
          return device;
        } catch {
          return null;
        }
      }),
    );

    const results = await db.fleetPolicyResult.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    return devices
      .map((device, index) => {
        const host = extractHostRecord(device);
        if (!host) return null;
        const req = hostRequests[index];
        const memberResults = results.filter((r) => r.userId === req.userId);

        return {
          ...host,
          user_name: req.userName,
          member_id: req.memberId,
          policies: buildPoliciesWithResults(host, memberResults),
        };
      })
      .filter(Boolean);
  } catch (error) {
    logger.error(
      `Failed to get employee devices for org ${organizationId}:`,
      error,
    );
    return [];
  }
}
