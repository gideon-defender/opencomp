import type { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';

export const DELETE_VENDOR_RESPONSES: Record<number, ApiResponseOptions> = {
  200: {
    status: 200,
    description: 'Vendor deleted successfully',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              example: 'Vendor deleted successfully',
            },
            deletedVendor: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Deleted vendor ID',
                  example: 'vnd_abc123def456',
                },
                name: {
                  type: 'string',
                  description: 'Deleted vendor name',
                  example: 'CloudTech Solutions Inc.',
                },
              },
            },
            authType: {
              type: 'string',
              enum: ['api-key', 'session'],
              description: 'How the request was authenticated',
            },
            authenticatedUser: {
              type: 'object',
              description: 'User information (only for session auth)',
              properties: {
                id: { type: 'string', example: 'usr_def456ghi789' },
                email: { type: 'string', example: 'user@example.com' },
              },
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
    description: 'Vendor not found',
    type: ApiErrorResponseDto,
  },
  500: {
    status: 500,
    description: 'Internal server error',
    type: ApiErrorResponseDto,
  },
};
