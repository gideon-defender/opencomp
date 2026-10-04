import type { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';

export const DOWNLOAD_MAC_AGENT_RESPONSES: Record<number, ApiResponseOptions> =
  {
    200: {
      status: 200,
      description: 'macOS agent DMG file download',
      content: {
        'application/x-apple-diskimage': {
          schema: {
            type: 'string',
            format: 'binary',
          },
          example: 'Binary DMG file content',
        },
      },
      headers: {
        'Content-Disposition': {
          description:
            'Indicates file should be downloaded with specific filename',
          schema: {
            type: 'string',
            example: 'attachment; filename="OpenComp Agent-1.0.0-arm64.dmg"',
          },
        },
        'Content-Type': {
          description: 'MIME type for macOS disk image',
          schema: {
            type: 'string',
            example: 'application/x-apple-diskimage',
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
      description: 'macOS agent file not found in S3',
      type: ApiErrorResponseDto,
    },
    500: {
      status: 500,
      description: 'Internal server error',
      type: ApiErrorResponseDto,
    },
  };
