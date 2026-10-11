import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  applyPublicOpenApiMetadata,
  PUBLIC_OPENAPI_DESCRIPTION,
  PUBLIC_OPENAPI_TITLE,
} from './public-docs-metadata';

/** Shared by API startup and the offline, preview-only drift gate. */
export function createPublicDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle(PUBLIC_OPENAPI_TITLE)
    .setDescription(PUBLIC_OPENAPI_DESCRIPTION)
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'API key for authentication',
      },
      'apikey',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  applyPublicOpenApiMetadata(document);
  return document;
}

export function canonicalDocument(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, sort(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(sort(value));
}
