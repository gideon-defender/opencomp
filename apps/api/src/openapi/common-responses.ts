import { applyDecorators } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiProperty,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

/**
 * Shared shape for every documented 4xx/5xx response.
 *
 * A single component referenced via `$ref` keeps the generated OpenAPI
 * (and every Speakeasy client) free of the dozens of structurally
 * identical inline `UnauthorizedError` / `ForbiddenError` copies that
 * hand-written per-endpoint schemas produce. Add new shared error shapes
 * here — never inline another `{ message, statusCode }` object.
 */
export class ApiErrorResponseDto {
  @ApiProperty({
    description: 'HTTP status code of the error',
    example: 401,
  })
  statusCode!: number;

  @ApiProperty({
    description: 'Human-readable error message',
    example: 'Unauthorized',
  })
  message!: string;
}

export const UNAUTHORIZED_ERROR_DESCRIPTION =
  'Unauthorized - Invalid or missing authentication';

export const FORBIDDEN_ERROR_DESCRIPTION =
  'Forbidden - Insufficient permissions for this operation';

export const NOT_FOUND_ERROR_DESCRIPTION =
  'Not found - The requested resource does not exist';

/**
 * Documents the 401 a guarded endpoint returns when the request carries
 * no (or invalid) credentials. Pair with `ApiForbiddenError` on any
 * endpoint behind `PermissionGuard` / `@RequirePermission`.
 */
export function ApiUnauthorizedError(
  description: string = UNAUTHORIZED_ERROR_DESCRIPTION,
) {
  return applyDecorators(
    ApiUnauthorizedResponse({ description, type: ApiErrorResponseDto }),
  );
}

/**
 * Documents the 403 a guarded endpoint returns when the caller is
 * authenticated but lacks the required permission.
 */
export function ApiForbiddenError(
  description: string = FORBIDDEN_ERROR_DESCRIPTION,
) {
  return applyDecorators(
    ApiForbiddenResponse({ description, type: ApiErrorResponseDto }),
  );
}

/**
 * Documents the 404 a lookup endpoint returns when the resource (portal,
 * file, member, …) does not exist. Accepts an endpoint-specific
 * description — prefer naming the missing resource.
 */
export function ApiNotFoundError(
  description: string = NOT_FOUND_ERROR_DESCRIPTION,
) {
  return applyDecorators(
    ApiNotFoundResponse({ description, type: ApiErrorResponseDto }),
  );
}

/**
 * Standard error pair for endpoints behind `HybridAuthGuard` +
 * `PermissionGuard` (the default for customer-facing endpoints).
 * Endpoints with extra failure modes keep their specific responses and
 * add this for the auth layer.
 */
export function ApiAuthErrors() {
  return applyDecorators(ApiUnauthorizedError(), ApiForbiddenError());
}
