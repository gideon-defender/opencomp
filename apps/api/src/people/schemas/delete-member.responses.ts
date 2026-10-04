import { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';

export const DELETE_MEMBER_RESPONSES: Record<string, ApiResponseOptions> = {
  200: {
    status: 200,
    description: 'Member deleted successfully',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Indicates successful deletion',
              example: true,
            },
            deletedMember: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The deleted member ID',
                  example: 'mem_abc123def456',
                },
                name: {
                  type: 'string',
                  description: 'The deleted member name',
                  example: 'John Doe',
                },
                email: {
                  type: 'string',
                  description: 'The deleted member email',
                  example: 'john.doe@company.com',
                },
              },
            },
            authType: {
              type: 'string',
              enum: ['api-key', 'session'],
              description: 'How the request was authenticated',
            },
          },
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
  404: {
    status: 404,
    description: 'Organization or member not found',
    type: ApiErrorResponseDto,
  },
  500: {
    status: 500,
    description: 'Internal server error',
    type: ApiErrorResponseDto,
  },
};
