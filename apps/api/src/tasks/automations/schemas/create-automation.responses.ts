import { ApiErrorResponseDto } from '../../../openapi/common-responses';
export const CREATE_AUTOMATION_RESPONSES = {
  201: {
    status: 201,
    description: 'Automation created successfully',
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
                name: {
                  type: 'string',
                  example: 'Task Name - Evidence Collection',
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
    description: 'Bad request - Invalid task ID or organization ID',
    type: ApiErrorResponseDto,
  },
  401: {
    status: 401,
    description: 'Unauthorized - Invalid authentication',
    type: ApiErrorResponseDto,
  },
  404: {
    status: 404,
    description: 'Task not found',
    type: ApiErrorResponseDto,
  },
};
