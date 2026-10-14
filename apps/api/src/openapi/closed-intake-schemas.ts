import type { OpenAPIObject } from '@nestjs/swagger';

/** Match the intake DTOs' forbidNonWhitelisted runtime contract in discovery. */
export function closeIntakeRequestSchemas(document: OpenAPIObject): void {
  for (const name of [
    'StartCandidateScreeningDto',
    'ConfigureCheckrIntakeDto',
  ]) {
    const schema = document.components?.schemas?.[name];
    if (schema && !('$ref' in schema)) schema.additionalProperties = false;
  }
}
