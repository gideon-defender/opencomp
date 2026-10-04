import { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';

export const REMOVE_HOST_RESPONSES: Record<string, ApiResponseOptions> = {
  200: {
    status: 200,
    description: 'Host removed from Fleet successfully',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Indicates successful removal',
              example: true,
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
      'Unauthorized - Invalid authentication, insufficient permissions, or not organization owner',
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
