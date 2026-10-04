import 'reflect-metadata';
import {
  ApiAuthErrors,
  ApiErrorResponseDto,
  ApiForbiddenError,
  ApiNotFoundError,
  ApiUnauthorizedError,
  FORBIDDEN_ERROR_DESCRIPTION,
  NOT_FOUND_ERROR_DESCRIPTION,
  UNAUTHORIZED_ERROR_DESCRIPTION,
} from './common-responses';

const API_RESPONSE_KEY = 'swagger/apiResponse';
// @nestjs/swagger v11 records declared model properties as an array of
// `:propertyKey` strings on the prototype (full options are consumed at
// schema-build time, so names are the stable assertion surface here).
const API_MODEL_PROPERTIES_ARRAY_KEY = 'swagger/apiModelPropertiesArray';

type ResponseEntry = {
  description?: string;
  type?: unknown;
};

function responsesOf(
  decorator: MethodDecorator,
): Record<string, ResponseEntry> {
  class Probe {
    run() {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(Probe.prototype, 'run');
  if (!descriptor) {
    throw new Error('Probe method descriptor missing');
  }
  decorator(Probe.prototype, 'run', descriptor);
  return (
    (Reflect.getMetadata(API_RESPONSE_KEY, descriptor.value) as Record<
      string,
      ResponseEntry
    >) ?? {}
  );
}

describe('common-responses', () => {
  describe('ApiErrorResponseDto', () => {
    it('declares statusCode and message via @ApiProperty', () => {
      const entries =
        (Reflect.getMetadata(
          API_MODEL_PROPERTIES_ARRAY_KEY,
          ApiErrorResponseDto.prototype,
        ) as string[] | undefined) ?? [];
      const properties = entries.map((entry) => entry.replace(/^:/, ''));

      expect(properties.sort()).toEqual(['message', 'statusCode']);
    });

    it('pins the shared error description literals', () => {
      expect(UNAUTHORIZED_ERROR_DESCRIPTION).toBe(
        'Unauthorized - Invalid or missing authentication',
      );
      expect(FORBIDDEN_ERROR_DESCRIPTION).toBe(
        'Forbidden - Insufficient permissions for this operation',
      );
      expect(NOT_FOUND_ERROR_DESCRIPTION).toBe(
        'Not found - The requested resource does not exist',
      );
    });
  });

  describe('ApiUnauthorizedError', () => {
    it('registers a 401 response with the shared DTO', () => {
      const responses = responsesOf(ApiUnauthorizedError());

      expect(responses['401']?.description).toBe(
        UNAUTHORIZED_ERROR_DESCRIPTION,
      );
      expect(responses['401']?.type).toBe(ApiErrorResponseDto);
    });

    it('accepts an endpoint-specific description', () => {
      const responses = responsesOf(ApiUnauthorizedError('Custom 401 text'));

      expect(responses['401']?.description).toBe('Custom 401 text');
      expect(responses['401']?.type).toBe(ApiErrorResponseDto);
    });
  });

  describe('ApiForbiddenError', () => {
    it('registers a 403 response with the shared DTO', () => {
      const responses = responsesOf(ApiForbiddenError());

      expect(responses['403']?.description).toBe(FORBIDDEN_ERROR_DESCRIPTION);
      expect(responses['403']?.type).toBe(ApiErrorResponseDto);
    });

    it('accepts an endpoint-specific description', () => {
      const responses = responsesOf(ApiForbiddenError('Custom 403 text'));

      expect(responses['403']?.description).toBe('Custom 403 text');
      expect(responses['403']?.type).toBe(ApiErrorResponseDto);
    });
  });

  describe('ApiAuthErrors', () => {
    it('registers the 401 + 403 pair together', () => {
      const responses = responsesOf(ApiAuthErrors());

      expect(Object.keys(responses).sort()).toEqual(['401', '403']);
      expect(responses['401']?.description).toBe(
        UNAUTHORIZED_ERROR_DESCRIPTION,
      );
      expect(responses['403']?.description).toBe(FORBIDDEN_ERROR_DESCRIPTION);
      expect(responses['401']?.type).toBe(ApiErrorResponseDto);
      expect(responses['403']?.type).toBe(ApiErrorResponseDto);
    });
  });

  describe('ApiNotFoundError', () => {
    it('registers a 404 response with the shared DTO', () => {
      const responses = responsesOf(ApiNotFoundError());

      expect(responses['404']?.description).toBe(NOT_FOUND_ERROR_DESCRIPTION);
      expect(responses['404']?.type).toBe(ApiErrorResponseDto);
    });

    it('accepts an endpoint-specific description', () => {
      const responses = responsesOf(ApiNotFoundError('Trust portal not found'));

      expect(responses['404']?.description).toBe('Trust portal not found');
      expect(responses['404']?.type).toBe(ApiErrorResponseDto);
    });
  });
});
