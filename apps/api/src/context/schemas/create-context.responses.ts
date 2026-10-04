import type { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';

export const CREATE_CONTEXT_RESPONSES: Record<number, ApiResponseOptions> = {
  201: {
    status: 201,
    description: 'Context entry created successfully',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            organizationId: { type: 'string' },
            question: { type: 'string' },
            answer: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            authType: { type: 'string', enum: ['api-key', 'session'] },
          },
        },
        example: {
          id: 'ctx_abc123def456',
          organizationId: 'org_xyz789uvw012',
          question: 'How do we handle user authentication in our application?',
          answer:
            'We use a hybrid authentication system supporting both API keys and session-based authentication.',
          tags: ['authentication', 'security', 'api', 'sessions'],
          createdAt: '2024-01-15T10:30:00.000Z',
          updatedAt: '2024-01-15T10:30:00.000Z',
          authType: 'apikey',
        },
      },
    },
  },
  400: {
    status: 400,
    description: 'Bad request - Invalid input data',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            message: { type: 'array', items: { type: 'string' } },
            error: { type: 'string' },
            statusCode: { type: 'number' },
          },
        },
        example: {
          message: [
            'question should not be empty',
            'answer should not be empty',
          ],
          error: 'Bad Request',
          statusCode: 400,
        },
      },
    },
  },
  401: {
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication',
    type: ApiErrorResponseDto,
  },
  404: {
    status: 404,
    description: 'Organization not found',
    type: ApiErrorResponseDto,
  },
  500: {
    status: 500,
    description: 'Internal server error',
    type: ApiErrorResponseDto,
  },
};
