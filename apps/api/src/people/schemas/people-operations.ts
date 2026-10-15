import type { ApiOperationOptions } from '@nestjs/swagger';

export const PEOPLE_OPERATIONS: Record<string, ApiOperationOptions> = {
  getAllPeople: {
    summary: 'Get all people',
    description:
      'Returns all members for the authenticated organization with their user information. Supports both API key authentication (X-API-Key header) and session authentication (Bearer token or cookies).',
  },
  getPersonById: {
    summary: 'Get person by ID',
    description:
      'Returns a specific member by ID for the authenticated organization with their user information. Supports both API key authentication (X-API-Key header) and session authentication (Bearer token or cookies).',
  },
  unlinkDevice: {
    summary: 'Unlink device from member',
    description:
      'Resets the fleetDmLabelId for a member, effectively unlinking their device from FleetDM. This will disconnect the device from the organization. Supports both API key authentication (X-API-Key header) and session authentication (Bearer token or cookies).',
  },
  removeHost: {
    summary: 'Remove host (device) from Fleet',
    description:
      'Removes a single host (device) from FleetDM by host ID. Only organization owners can perform this action. Validates that the organization exists and the member exists within the organization. Supports both API key authentication (X-API-Key header) and session authentication (Bearer token or cookies).',
  },
};
