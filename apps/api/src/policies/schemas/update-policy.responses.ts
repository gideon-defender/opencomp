import { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';

export const UPDATE_POLICY_RESPONSES: Record<string, ApiResponseOptions> = {
  200: {
    status: 200,
    description: 'Policy updated successfully',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/PolicyResponseDto' },
        example: {
          id: 'pol_abc123def456',
          name: 'Data Privacy Policy',
          description:
            'This policy outlines how we handle and protect personal data',
          status: 'published',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Purpose' }],
            },
          ],
          frequency: 'yearly',
          department: 'it',
          isRequiredToSign: true,
          signedBy: ['usr_123'],
          reviewDate: '2024-12-31T00:00:00.000Z',
          isArchived: false,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-15T00:00:00.000Z',
          organizationId: 'org_abc123def456',
          assigneeId: 'usr_abc123def456',
          approverId: 'usr_xyz789abc123',
        },
      },
    },
  },
  400: {
    status: 400,
    description: 'Bad Request - Invalid update data',
    type: ApiErrorResponseDto,
  },
  401: {
    status: 401,
    description:
      'Unauthorized - Invalid authentication or insufficient permissions',
    type: ApiErrorResponseDto,
  },
  404: {
    status: 404,
    description: 'Policy not found',
    type: ApiErrorResponseDto,
  },
};
