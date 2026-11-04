import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { closeIntakeRequestSchemas } from './closed-intake-schemas';
import {
  applyPublicOpenApiMetadata,
  PUBLIC_OPENAPI_DESCRIPTION,
  PUBLIC_OPENAPI_TITLE,
} from './public-docs-metadata';

/**
 * The cloud-security endpoints are split across focused controller classes
 * (scan/gcp/azure/legacy). The published OpenAPI operationIds and the MCP
 * tool contract are derived from the controller class name, so the split
 * would rename every operationId. The factory pins operationIds to the
 * pre-split public contract.
 */
export const OPERATION_ID_CLASS_ALIASES: Record<string, string> = {
  CloudSecurityScanController: 'CloudSecurityController',
  CloudSecurityGcpController: 'CloudSecurityController',
  CloudSecurityAzureController: 'CloudSecurityController',
  CloudSecurityAzureValidateController: 'CloudSecurityController',
  CloudSecurityTriggerController: 'CloudSecurityController',
  CloudSecurityLegacyController: 'CloudSecurityController',
};

/**
 * Derives the published operationId from the controller class name. Export the
 * factory so a test can assert the alias mapping without booting Nest.
 */
export function publicOperationIdFactory(
  controllerKey: string,
  methodKey: string,
  version?: string,
): string {
  const classKey = OPERATION_ID_CLASS_ALIASES[controllerKey] ?? controllerKey;
  return version
    ? `${classKey}_${methodKey}_${version}`
    : `${classKey}_${methodKey}`;
}

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
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: publicOperationIdFactory,
  });
  closeIntakeRequestSchemas(document);
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
