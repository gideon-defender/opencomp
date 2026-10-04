import { ApiErrorResponseDto } from '../../../openapi/common-responses';
export const UPDATE_AUTOMATION_RESPONSES = {
  200: {
    status: 200,
    description: 'Automation updated successfully',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            automation: {
              type: 'object',
              properties: {
                id: { type: 'string', example: 'auto_abc123def456' },
                name: { type: 'string', example: 'Updated Automation Name' },
                description: { type: 'string', example: 'Updated description' },
              },
            },
          },
        },
      },
    },
  },
  400: {
    status: 400,
    description: 'Bad request - Invalid automation ID or data',
    type: ApiErrorResponseDto,
  },
  401: {
    status: 401,
    description: 'Unauthorized - Invalid authentication',
    type: ApiErrorResponseDto,
  },
  404: {
    status: 404,
    description: 'Automation not found',
    type: ApiErrorResponseDto,
  },
};
