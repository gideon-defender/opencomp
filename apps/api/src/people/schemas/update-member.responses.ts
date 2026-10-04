import { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';

export const UPDATE_MEMBER_RESPONSES: Record<string, ApiResponseOptions> = {
  200: {
    status: 200,
    description: 'Member updated successfully',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/PeopleResponseDto' },
        example: {
          id: 'mem_abc123def456',
          organizationId: 'org_abc123def456',
          userId: 'usr_abc123def456',
          role: 'member',
          createdAt: '2024-01-01T00:00:00Z',
          department: 'it',
          isActive: true,
          fleetDmLabelId: 123,
          user: {
            id: 'usr_abc123def456',
            name: 'John Doe',
            email: 'john.doe@company.com',
            emailVerified: true,
            image: 'https://example.com/avatar.jpg',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-15T00:00:00Z',
            lastLogin: '2024-01-15T12:00:00Z',
          },
        },
      },
    },
  },
  400: {
    status: 400,
    description: 'Bad Request - Invalid update data or user conflict',
    type: ApiErrorResponseDto,
  },
  401: {
    status: 401,
    description:
      'Unauthorized - Invalid authentication or insufficient permissions',
    type: ApiErrorResponseDto,
  },
  409: {
    status: 409,
    description:
      'Conflict - Login email already used by another account, or the member belongs to other organizations',
    type: ApiErrorResponseDto,
  },
  404: {
    status: 404,
    description: 'Organization, member, or user not found',
    type: ApiErrorResponseDto,
  },
  500: {
    status: 500,
    description: 'Internal server error',
    type: ApiErrorResponseDto,
  },
};
