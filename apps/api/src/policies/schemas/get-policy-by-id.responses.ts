import { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';

export const GET_POLICY_BY_ID_RESPONSES: Record<string, ApiResponseOptions> = {
  200: {
    status: 200,
    description: 'Policy retrieved successfully',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/PolicyResponseDto' },
        example: {
          id: 'pol_abc123def456',
          name: 'Data Privacy Policy',
          status: 'draft',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '...' }] },
          ],
          isRequiredToSign: true,
          signedBy: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-15T00:00:00.000Z',
          organizationId: 'org_abc123def456',
        },
      },
    },
  },
  401: {
    status: 401,
    description:
      'Unauthorized - Invalid authentication or insufficient permissions',
    type: ApiErrorResponseDto,
  },
  403: {
    status: 403,
    description:
      'Forbidden - User does not have permission to access this policy',
    type: ApiErrorResponseDto,
  },
  404: {
    status: 404,
    description: 'Policy not found',
    type: ApiErrorResponseDto,
  },
};
