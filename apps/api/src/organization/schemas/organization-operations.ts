import type { ApiOperationOptions } from '@nestjs/swagger';

export const ORGANIZATION_OPERATIONS: Record<string, ApiOperationOptions> = {
  getOrganization: {
    summary: 'Get organization information',
    description:
      'Returns detailed information about the authenticated organization. Supports both API key authentication (X-API-Key header) and session authentication (Bearer token or cookies).',
  },
  updateOrganization: {
    summary: 'Update organization',
    description:
      'Partially updates the authenticated organization. Only provided fields will be updated. Supports both API key authentication (X-API-Key header) and session authentication (Bearer token or cookies).',
  },
  deleteOrganization: {
    summary: 'Delete organization',
    description:
      'Permanently deletes the authenticated organization. This action cannot be undone. Supports both API key authentication (X-API-Key header) and session authentication (Bearer token or cookies).',
  },
  getPrimaryColor: {
    summary: 'Get organization primary color',
    description:
      'Returns the primary color of the organization. Supports three access methods: 1) API key authentication (X-API-Key header), 2) Session authentication (Bearer token or cookies), or 3) Public access using an access token query parameter (?token=tok_xxx). When using an access token, no authentication is required.',
  },
};
