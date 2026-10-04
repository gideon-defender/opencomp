import type { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';

export const DOWNLOAD_WINDOWS_AGENT_RESPONSES: Record<
  number,
  ApiResponseOptions
> = {
  200: {
    status: 200,
    description:
      'Windows agent ZIP file download containing MSI installer and setup scripts',
    content: {
      'application/zip': {
        schema: {
          type: 'string',
          format: 'binary',
        },
        example: 'Binary ZIP file content',
      },
    },
    headers: {
      'Content-Disposition': {
        description:
          'Indicates file should be downloaded with specific filename',
        schema: {
          type: 'string',
          example: 'attachment; filename="compai-device-agent-windows.zip"',
        },
      },
      'Content-Type': {
        description: 'MIME type for ZIP archive',
        schema: {
          type: 'string',
          example: 'application/zip',
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
    description: 'Windows agent file not found in S3',
    type: ApiErrorResponseDto,
  },
  500: {
    status: 500,
    description: 'Internal server error',
    type: ApiErrorResponseDto,
  },
};
