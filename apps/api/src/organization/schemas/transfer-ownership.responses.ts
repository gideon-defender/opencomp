import type { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';

export const TRANSFER_OWNERSHIP_RESPONSES: Record<
  200 | 400 | 401 | 403 | 404,
  ApiResponseOptions
> = {
  200: {
    status: 200,
    description: 'Ownership transferred successfully',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            message: {
              type: 'string',
              example: 'Ownership transferred successfully',
            },
            currentOwner: {
              type: 'object',
              properties: {
                memberId: {
                  type: 'string',
                  example: 'mem_abc123',
                },
                previousRoles: {
                  type: 'array',
                  items: { type: 'string' },
                  example: ['owner', 'employee'],
                },
                newRoles: {
                  type: 'array',
                  items: { type: 'string' },
                  example: ['admin', 'employee'],
                },
              },
            },
            newOwner: {
              type: 'object',
              properties: {
                memberId: {
                  type: 'string',
                  example: 'mem_xyz789',
                },
                previousRoles: {
                  type: 'array',
                  items: { type: 'string' },
                  example: ['admin'],
                },
                newRoles: {
                  type: 'array',
                  items: { type: 'string' },
                  example: ['admin', 'owner'],
                },
              },
            },
          },
        },
      },
    },
  },
  400: {
    status: 400,
    description: 'Bad request - Invalid input',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            message: {
              type: 'string',
              example: 'New owner must be selected',
            },
          },
        },
      },
    },
  },
  401: {
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication',
    type: ApiErrorResponseDto,
  },
  403: {
    status: 403,
    description: 'Forbidden - Only organization owner can transfer ownership',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            message: {
              type: 'string',
              example: 'Only the organization owner can transfer ownership',
            },
          },
        },
      },
    },
  },
  404: {
    status: 404,
    description: 'Not found - Organization or member not found',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            message: {
              type: 'string',
              example: 'New owner not found or is deactivated',
            },
          },
        },
      },
    },
  },
};
