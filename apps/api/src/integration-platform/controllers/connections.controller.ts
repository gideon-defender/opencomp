import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpException,
  HttpStatus,
  Logger,
  UseGuards,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { db } from '@db';
import {
  AssumeRoleCommand,
  GetCallerIdentityCommand,
  STSClient,
} from '@aws-sdk/client-sts';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequirePermission } from '../../auth/require-permission.decorator';
import { OrganizationId } from '../../auth/auth-context.decorator';
import { ConnectionService } from '../services/connection.service';
import { CredentialVaultService } from '../services/credential-vault.service';
import { OAuthCredentialsService } from '../services/oauth-credentials.service';
import { AutoCheckRunnerService } from '../services/auto-check-runner.service';
import { ProviderRepository } from '../repositories/provider.repository';
import { ConnectionRepository } from '../repositories/connection.repository';
import {
  getManifest,
  getAllManifests,
  getActiveManifests,
  getGcpRemediationMapParseError,
  getRemediationRolesParseError,
  parseGcpRemediationMap,
  parseRemediationRolesMap,
  TASK_TEMPLATE_INFO,
  type TaskTemplateId,
} from '@gideon-defender/integration-platform';
import {
  getAwsBaseCredentials,
  getAwsRoleAssumerArn,
  getAwsRoleAssumerEnvName,
  normalizeAwsPartition,
  parseAwsRoleArn,
  validateAwsPartitionConfig,
} from '../../cloud-security/aws-partition.utils';
import { getProviderSummary } from '../utils/provider-summary';
import { validateRemediationRoleTrust } from './remediation-trust.validator';
import { validateGcpRemediationTrust } from '../../cloud-security/gcp-remediation-trust.validator';
import { GcpImpersonationService } from '../../cloud-security/gcp-impersonation.service';
import { generateAwsExternalId } from './external-id.utils';
import { ApiAuthErrors } from '../../openapi/common-responses';

/**
 * AWS credential fields that must never carry leading/trailing whitespace
 * into the vault. Exported for tests.
 */
const AWS_TRIMMED_CREDENTIAL_KEYS = [
  'roleArn',
  'externalId',
  'remediationRoles',
] as const;

/**
 * Strip surrounding whitespace from pasted AWS credential strings in
 * place. STS rejects ARNs with a trailing space, so the stored value must
 * be the trimmed one — validation alone being trim-tolerant is not enough.
 */
export function trimAwsCredentialStrings(
  credentials: Record<string, string | string[]>,
): void {
  for (const key of AWS_TRIMMED_CREDENTIAL_KEYS) {
    const value = credentials[key];
    if (typeof value === 'string') credentials[key] = value.trim();
  }
}

// Class (not interface) so @nestjs/swagger can introspect it — interfaces are
// erased at runtime and produce an empty OpenAPI body schema, which means MCP
// tools have no input fields and agents have to blind-guess the body.
//
// IMPORTANT: every property also carries class-validator decorators
// (@IsString / @IsOptional / @IsObject). The global ValidationPipe runs with
// `whitelist: true, forbidNonWhitelisted: true`, so a class with @ApiProperty
// but no class-validator metadata would have zero "known" properties — the
// pipe would reject the body with "property X should not exist". Keep both
// decorator stacks in sync when you add fields here.
class CreateConnectionDto {
  // The UI historically posts `organizationId` in the body even though the
  // controller derives it from auth via @OrganizationId(). Accept it as
  // optional so strict ValidationPipe (whitelist + forbidNonWhitelisted)
  // doesn't 400 the request. Handler ignores this field.
  @ApiPropertyOptional({
    description:
      'Auto-resolved from your API key / session. You can omit this; it is ignored by the server.',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({
    description:
      "Provider slug for the integration. Call list-providers first to see the available slugs (e.g. 'aws', 'gcp', 'azure', 'github').",
    example: 'aws',
  })
  @IsString()
  providerSlug!: string;

  @ApiPropertyOptional({
    description:
      "Provider-specific credential fields. Keys differ by provider — call get-provider-details for the exact shape. For AWS (Cloud Tests) the fields are: connectionName (display name), awsType ('aws-commercial' or 'aws-govcloud'), roleArn (auditor role), regions (string array), remediationRoles (JSON string map of '<AssetClass>:<region>' to remediation role ARN, e.g. '{\"Storage:us-east-1\":\"arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1\"}' — one role per pair; the removed single remediationRoleArn is rejected for new connections and ignored on existing ones, whose stored values are dropped on the next credential update), and awsScanMode ('comp_scanners' or 'security_hub'). The externalId is always minted server-side (org_<orgId>_<uuid>) — any client-supplied value is ignored. Omit roleArn to create a pending connection: the response returns the minted externalId show-once for the CloudShell setup script, then PUT credentials with the Role ARN to validate and activate. Omit credentials for OAuth providers — use POST /v1/integrations/oauth/start instead.",
    type: 'object',
    additionalProperties: true,
    example: {
      connectionName: 'Production AWS',
      awsType: 'aws-commercial',
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
      regions: ['us-east-1', 'us-west-2'],
      remediationRoles:
        '{"Storage:us-east-1":"arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1"}',
      awsScanMode: 'comp_scanners',
    },
  })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string | string[]>;
}

// Body for PATCH /v1/integrations/connections/:id (update connection metadata).
// Same dual-decorator pattern as CreateConnectionDto: @ApiProperty drives the
// MCP/docs schema, class-validator decorators keep the ValidationPipe happy.
class UpdateConnectionDto {
  // UI sends organizationId in the body; ignored by the handler (derived from auth).
  @ApiPropertyOptional({
    description:
      'Auto-resolved from your API key / session. You can omit this; it is ignored by the server.',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({
    description:
      "Connection metadata to merge into the existing record. Common AWS keys: connectionName, regions (string array), awsScanMode ('comp_scanners' or 'security_hub'). The server shallow-merges this with the existing metadata, so include only the keys you want to change.",
    type: 'object',
    additionalProperties: true,
    example: {
      connectionName: 'Production AWS (renamed)',
      regions: ['us-east-1', 'us-west-2'],
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

// Body for PUT /v1/integrations/connections/:id/services (set enabled services).
class UpdateConnectionServicesDto {
  // UI sends organizationId in the body; ignored by the handler (derived from auth).
  @ApiPropertyOptional({
    description:
      'Auto-resolved from your API key / session. You can omit this; it is ignored by the server.',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({
    description:
      "Service IDs to enable on this connection. Any service IDs from the provider's manifest that are NOT in this list become disabled. Pass an empty array to disable all services.",
    type: 'array',
    items: { type: 'string' },
    example: ['s3', 'iam', 'cloudtrail'],
  })
  @IsArray()
  @IsString({ each: true })
  services!: string[];
}

// Body for PUT /v1/integrations/connections/:id/credentials (rotate credentials
// on a connection that's already established).
class UpdateConnectionCredentialsDto {
  // UI sends organizationId in the body; ignored by the handler (derived from auth).
  @ApiPropertyOptional({
    description:
      'Auto-resolved from your API key / session. You can omit this; it is ignored by the server.',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({
    description:
      "New credential fields for the connection. Keys match the provider's auth shape (same shape used when the connection was created — see create-connection for the AWS field list). For AWS the stored External ID is pinned: any client-supplied externalId is ignored and the minted value is kept.",
    type: 'object',
    additionalProperties: true,
    example: {
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
    },
  })
  @IsObject()
  credentials!: Record<string, string | string[]>;
}

class EnsureValidCredentialsDto {
  @ApiPropertyOptional({
    description:
      'Force an OAuth token refresh even when the stored expiry has not been reached. Use after a provider returns 401.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
}

const hasCredentialValue = (value?: string | string[]): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return typeof value === 'string' && value.trim().length > 0;
};

@Controller({ path: 'integrations/connections', version: '1' })
@ApiTags('Integrations')
@UseGuards(HybridAuthGuard, PermissionGuard)
@ApiSecurity('apikey')
export class ConnectionsController {
  private readonly logger = new Logger(ConnectionsController.name);

  constructor(
    private readonly connectionService: ConnectionService,
    private readonly credentialVaultService: CredentialVaultService,
    private readonly oauthCredentialsService: OAuthCredentialsService,
    private readonly autoCheckRunnerService: AutoCheckRunnerService,
    private readonly providerRepository: ProviderRepository,
    private readonly connectionRepository: ConnectionRepository,
    @Inject(forwardRef(() => GcpImpersonationService))
    private readonly gcpImpersonationService: GcpImpersonationService,
  ) {}

  /**
   * List all available integration providers
   */
  @Get('providers')
  @ApiOperation({ summary: 'List available integration providers' })
  @RequirePermission('integration', 'read')
  @ApiOkResponse({
    description: 'Integration providers retrieved successfully',
  })
  @ApiAuthErrors()
  async listProviders(
    @OrganizationId() organizationId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    const manifests =
      activeOnly === 'true' ? getActiveManifests() : getAllManifests();

    // OAuth availability is org OR platform (matches checkAvailability):
    // an org with its own custom app must not see "Coming soon".
    const oauthProviderSlugs = manifests
      .filter((m) => m.auth.type === 'oauth2')
      .map((m) => m.id);

    const availabilityMap = new Map<string, boolean>();
    for (const slug of oauthProviderSlugs) {
      const availability = await this.oauthCredentialsService.checkAvailability(
        slug,
        organizationId,
      );
      availabilityMap.set(slug, availability.available);
    }

    return manifests.map((m) => {
      // Get credential fields - from custom auth config or from manifest
      const credentialFields =
        m.auth.type === 'custom' && m.auth.config.credentialFields
          ? m.auth.config.credentialFields
          : m.credentialFields;

      // Surface setup instructions for any credential-entry auth type (custom, api_key,
      // basic, jwt) — not just custom. oauth2 is excluded because its setupInstructions are
      // admin app-creation steps, not customer connect steps.
      const setupInstructions =
        m.auth.type !== 'oauth2' && 'setupInstructions' in m.auth.config
          ? m.auth.config.setupInstructions
          : undefined;

      const setupScript =
        m.auth.type === 'custom' ? m.auth.config.setupScript : undefined;

      // For OAuth providers, available when org OR platform creds exist
      const oauthConfigured =
        m.auth.type === 'oauth2'
          ? (availabilityMap.get(m.id) ?? false)
          : undefined;

      // Get mapped tasks from checks and collect required variables
      const mappedTasks: Array<{ id: string; name: string }> = [];
      const seenTaskIds = new Set<string>();
      const requiredVariables = new Set<string>();

      // Collect manifest-level required variables
      for (const variable of m.variables || []) {
        if (variable.required) {
          requiredVariables.add(variable.id);
        }
      }

      // Collect check-level required variables
      for (const check of m.checks || []) {
        if (check.taskMapping && !seenTaskIds.has(check.taskMapping)) {
          seenTaskIds.add(check.taskMapping);
          const taskInfo = TASK_TEMPLATE_INFO[check.taskMapping];
          if (taskInfo) {
            mappedTasks.push({ id: check.taskMapping, name: taskInfo.name });
          }
        }
        if (check.variables) {
          for (const variable of check.variables) {
            if (variable.required) {
              requiredVariables.add(variable.id);
            }
          }
        }
      }

      return {
        id: m.id,
        name: m.name,
        description: m.description,
        category: m.category,
        logoUrl: m.logoUrl,
        authType: m.auth.type,
        capabilities: m.capabilities,
        isActive: m.isActive,
        docsUrl: m.docsUrl,
        credentialFields,
        setupInstructions,
        setupScript,
        oauthConfigured,
        mappedTasks,
        requiredVariables: Array.from(requiredVariables),
        supportsMultipleConnections: m.supportsMultipleConnections ?? false,
        services:
          m.services?.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            enabledByDefault: s.enabledByDefault ?? true,
            implemented: s.implemented ?? true,
            mappedTasks: this.buildServiceTaskMappings(m.checks, s.id),
          })) ?? [],
      };
    });
  }

  /**
   * Evidence tasks a single service's checks satisfy: distinct taskMappings of
   * the manifest checks whose `service` equals serviceId, resolved to names.
   */
  private buildServiceTaskMappings(
    checks:
      | ReadonlyArray<{ service?: string; taskMapping?: TaskTemplateId }>
      | undefined,
    serviceId: string,
  ): Array<{ id: string; name: string }> {
    const out: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();
    for (const check of checks ?? []) {
      if (check.service !== serviceId || !check.taskMapping) continue;
      if (seen.has(check.taskMapping)) continue;
      seen.add(check.taskMapping);
      const info = TASK_TEMPLATE_INFO[check.taskMapping];
      if (info) out.push({ id: check.taskMapping, name: info.name });
    }
    return out;
  }

  /**
   * Get a specific provider's details
   */
  @Get('providers/:slug')
  @ApiOperation({ summary: 'Get an integration provider by slug' })
  @RequirePermission('integration', 'read')
  @ApiOkResponse({
    description: 'An integration provider by slug retrieved successfully',
  })
  @ApiAuthErrors()
  async getProvider(
    @Param('slug') slug: string,
    @OrganizationId() organizationId: string,
  ) {
    const manifest = getManifest(slug);
    if (!manifest) {
      throw new HttpException(
        `Provider ${slug} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    // OAuth availability is org OR platform (same as list-providers) so the
    // detail-page onboarding gate matches the list gate.

    // Get credential fields - from custom auth config or from manifest
    const credentialFields =
      manifest.auth.type === 'custom' && manifest.auth.config.credentialFields
        ? manifest.auth.config.credentialFields
        : manifest.credentialFields;

    // Surface setup instructions for any credential-entry auth type (custom, api_key,
    // basic, jwt) — not just custom. oauth2 is excluded because its setupInstructions are
    // admin app-creation steps, not customer connect steps.
    const setupInstructions =
      manifest.auth.type !== 'oauth2' &&
      'setupInstructions' in manifest.auth.config
        ? manifest.auth.config.setupInstructions
        : undefined;

    const setupScript =
      manifest.auth.type === 'custom'
        ? manifest.auth.config.setupScript
        : undefined;

    // Get mapped tasks from checks
    const mappedTasks: Array<{ id: string; name: string }> = [];
    const seenTaskIds = new Set<string>();

    // Collect required variables (manifest-level and check-level)
    const requiredVariables = new Set<string>();

    // Manifest-level variables
    for (const variable of manifest.variables || []) {
      if (variable.required) {
        requiredVariables.add(variable.id);
      }
    }

    // Check-level variables
    for (const check of manifest.checks || []) {
      if (check.taskMapping && !seenTaskIds.has(check.taskMapping)) {
        seenTaskIds.add(check.taskMapping);
        const taskInfo = TASK_TEMPLATE_INFO[check.taskMapping];
        if (taskInfo) {
          mappedTasks.push({ id: check.taskMapping, name: taskInfo.name });
        }
      }
      if (check.variables) {
        for (const variable of check.variables) {
          if (variable.required) {
            requiredVariables.add(variable.id);
          }
        }
      }
    }

    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      logoUrl: manifest.logoUrl,
      authType: manifest.auth.type,
      capabilities: manifest.capabilities,
      isActive: manifest.isActive,
      docsUrl: manifest.docsUrl,
      credentialFields,
      setupInstructions,
      setupScript,
      oauthConfigured:
        manifest.auth.type === 'oauth2'
          ? (
              await this.oauthCredentialsService.checkAvailability(
                manifest.id,
                organizationId,
              )
            ).available
          : undefined,
      mappedTasks,
      requiredVariables: Array.from(requiredVariables),
      supportsMultipleConnections:
        manifest.supportsMultipleConnections ?? false,
      services:
        manifest.services?.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          enabledByDefault: s.enabledByDefault ?? true,
          implemented: s.implemented ?? true,
          mappedTasks: this.buildServiceTaskMappings(manifest.checks, s.id),
        })) ?? [],
    };
  }

  /**
   * List connections for an organization (excludes soft-deleted/disconnected)
   */
  @Get()
  @ApiOperation({ summary: 'List integration connections' })
  @RequirePermission('integration', 'read')
  @ApiOkResponse({
    description: 'Integration connections retrieved successfully',
  })
  @ApiAuthErrors()
  async listConnections(@OrganizationId() organizationId: string) {
    const connections =
      await this.connectionService.getOrganizationConnections(organizationId);

    return connections
      .filter((c) => c.status !== 'disconnected')
      .map((c) => {
        const provider = getProviderSummary(c);

        return {
          id: c.id,
          providerId: c.providerId,
          providerSlug: provider?.slug,
          providerName: provider?.name,
          status: c.status,
          authStrategy: c.authStrategy,
          lastSyncAt: c.lastSyncAt,
          nextSyncAt: c.nextSyncAt,
          errorMessage: c.errorMessage,
          variables: c.variables,
          metadata: c.metadata,
          createdAt: c.createdAt,
        };
      });
  }

  /**
   * Get a specific connection
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get an integration connection by ID' })
  @RequirePermission('integration', 'read')
  @ApiOkResponse({
    description: 'An integration connection by ID retrieved successfully',
  })
  @ApiAuthErrors()
  async getConnection(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    const connection = await this.connectionService.getConnectionForOrg(
      id,
      organizationId,
    );
    const providerSlug = getProviderSummary(connection)?.slug;

    // Get credential fields for custom auth integrations
    let credentialFields: Array<{
      id: string;
      label: string;
      type: string;
      required: boolean;
      placeholder?: string;
      helpText?: string;
      options?: Array<{ value: string; label: string }>;
    }> = [];

    if (providerSlug) {
      const manifest = getManifest(providerSlug);
      if (
        manifest?.auth.type === 'custom' &&
        manifest.auth.config.credentialFields
      ) {
        credentialFields = manifest.auth.config.credentialFields;
      }
    }

    // Backfill metadata from credentials if missing (for connections created before metadata sync)
    let metadata = (connection.metadata ?? {}) as Record<string, unknown>;
    if (providerSlug === 'aws' && !metadata.accountId) {
      try {
        const creds =
          await this.credentialVaultService.getDecryptedCredentials(id);
        if (creds) {
          const updates: Record<string, unknown> = {};
          if (typeof creds.roleArn === 'string') {
            updates.roleArn = creds.roleArn;
            const parsedRoleArn = parseAwsRoleArn(creds.roleArn);
            if (parsedRoleArn) updates.accountId = parsedRoleArn.accountId;
          }
          // Sync the parsed pair map (not the raw JSON) so settings UI can
          // render per-pair status without vault access. ARNs are not
          // secrets. Stored legacy single ARNs are deliberately not synced:
          // the monolith role is removed and nothing reads that key.
          if (typeof creds.remediationRoles === 'string') {
            const pairs = parseRemediationRolesMap(creds.remediationRoles);
            if (Object.keys(pairs).length > 0) updates.remediationRoles = pairs;
          }
          if (typeof creds.awsType === 'string') {
            updates.awsType = creds.awsType;
          }
          if (Array.isArray(creds.regions)) {
            updates.regions = creds.regions;
          }
          if (typeof creds.externalId === 'string') {
            updates.externalId = creds.externalId;
          }
          if (Object.keys(updates).length > 0) {
            metadata = { ...metadata, ...updates };
            // Persist so this only runs once
            await this.connectionRepository.update(id, { metadata });
          }
        }
      } catch {
        // Non-critical — just use whatever metadata we have
      }
    }

    return {
      id: connection.id,
      providerId: connection.providerId,
      providerSlug,
      providerName: (connection as { provider?: { name: string } }).provider
        ?.name,
      status: connection.status,
      authStrategy: connection.authStrategy,
      lastSyncAt: connection.lastSyncAt,
      nextSyncAt: connection.nextSyncAt,
      syncCadence: connection.syncCadence,
      metadata,
      variables: connection.variables,
      errorMessage: connection.errorMessage,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      credentialFields,
    };
  }

  /**
   * Create a new connection with API key credentials
   */
  @Post()
  @ApiOperation({ summary: 'Create an integration connection' })
  @ApiBody({ type: CreateConnectionDto })
  @RequirePermission('integration', 'create')
  @ApiCreatedResponse({
    description: 'Integration connection created successfully',
  })
  @ApiAuthErrors()
  async createConnection(
    @OrganizationId() organizationId: string,
    @Body() body: CreateConnectionDto,
  ) {
    const { providerSlug, credentials } = body;

    // Validate provider
    const manifest = getManifest(providerSlug);
    if (!manifest) {
      throw new HttpException(
        `Provider ${providerSlug} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    // For OAuth providers, redirect to OAuth flow
    if (manifest.auth.type === 'oauth2') {
      throw new HttpException(
        'Use /integrations/oauth/start for OAuth providers',
        HttpStatus.BAD_REQUEST,
      );
    }

    // ============================================================
    // VALIDATE BEFORE CREATING - For AWS, check IAM role + Security Hub
    // ============================================================
    // Server-generated External IDs (Phase 1 item 6): any client-supplied
    // `externalId` is replaced before anything else, so validation, the
    // vault, and metadata all see the minted value — never a user-typed one.
    // Without a Role ARN this is a pending create: the connection is stored
    // inactive and the minted value is returned show-once for the setup
    // script. The Role ARN arrives later via update-credentials (validated).
    // Always mint from an object base for AWS — even when the caller sends
    // no `credentials` at all — so every AWS connection (pending or not)
    // gets an External ID and no orphan pending row can exist without one.
    const effectiveCredentials =
      providerSlug === 'aws'
        ? {
            ...(credentials ?? {}),
            externalId: generateAwsExternalId(organizationId),
          }
        : credentials;
    // Normalize before metadata, validation, and storage all read it — the
    // vault must hold the trimmed value STS actually receives.
    if (providerSlug === 'aws' && effectiveCredentials)
      trimAwsCredentialStrings(effectiveCredentials);
    // New AWS connections cannot use the legacy single remediation role.
    // The monolith `OpenComp-Remediator` was removed in favor of one role
    // per asset-class/region pair (`remediationRoles` map). Reject before any
    // STS call or row creation so no legacy-shaped connection can be minted.
    // Existing connections keep working for reads while they migrate: the
    // pair map resolves first and stored legacy values are ignored.
    if (
      providerSlug === 'aws' &&
      !!effectiveCredentials &&
      typeof effectiveCredentials.remediationRoleArn === 'string' &&
      effectiveCredentials.remediationRoleArn.trim().length > 0
    ) {
      throw new HttpException(
        'remediationRoleArn is no longer accepted for new connections. Create one role per asset-class/region pair and send them as remediationRoles (a JSON string map of "<AssetClass>:<region>" to role ARN).',
        HttpStatus.BAD_REQUEST,
      );
    }
    const hasAwsRoleArn =
      providerSlug === 'aws' &&
      !!effectiveCredentials &&
      typeof effectiveCredentials.roleArn === 'string' &&
      effectiveCredentials.roleArn.trim().length > 0;
    if (providerSlug === 'aws' && effectiveCredentials && hasAwsRoleArn) {
      const validationResult =
        await this.validateAwsCredentials(effectiveCredentials);
      if (!validationResult.success) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: validationResult.message,
            error: 'Validation Failed',
            details: validationResult.details,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      this.logger.log('AWS credentials validated successfully');
    }

    // Ensure provider exists in DB
    await this.providerRepository.upsert({
      slug: manifest.id,
      name: manifest.name,
      category: manifest.category,
      capabilities: manifest.capabilities,
      isActive: manifest.isActive,
    });

    // Extract metadata from credentials for display purposes
    // These fields are also stored encrypted in credentials, but we need them in metadata for quick access
    const metadata: Record<string, unknown> = {};
    const metadataSource = effectiveCredentials ?? credentials;
    if (metadataSource) {
      const credentials = metadataSource;
      if (typeof credentials.connectionName === 'string') {
        metadata.connectionName = credentials.connectionName;
      }
      if (typeof credentials.awsType === 'string') {
        metadata.awsType = credentials.awsType;
      }
      if (Array.isArray(credentials.regions)) {
        metadata.regions = credentials.regions;
      }
      // AWS only — which scan engine the customer chose at onboarding
      // (OpenComp scanners vs Security Hub). Read on every scan by
      // cloud-security.service.ts. Customers can change it later from
      // CloudSettingsModal via aws-scan-mode.service.updateMode.
      if (
        typeof credentials.awsScanMode === 'string' &&
        (credentials.awsScanMode === 'comp_scanners' ||
          credentials.awsScanMode === 'security_hub')
      ) {
        metadata.awsScanMode = credentials.awsScanMode;
      }
      // Store roleArn and externalId in metadata for pre-filling the configure form
      // Neither is a secret: roleArn is visible in the AWS console, and the
      // externalId is server-minted (unpredictable) at create time.
      if (typeof credentials.roleArn === 'string') {
        metadata.roleArn = credentials.roleArn;
        const parsedRoleArn = parseAwsRoleArn(credentials.roleArn);
        if (parsedRoleArn) metadata.accountId = parsedRoleArn.accountId;
      }
      if (typeof credentials.externalId === 'string') {
        metadata.externalId = credentials.externalId;
      }
      if (
        typeof credentials.remediationRoles === 'string' &&
        credentials.remediationRoles.trim()
      ) {
        const pairs = parseRemediationRolesMap(credentials.remediationRoles);
        if (Object.keys(pairs).length > 0) metadata.remediationRoles = pairs;
      }
      // Store Azure tenant/subscription IDs in metadata for display and pre-filling
      if (typeof credentials.tenantId === 'string') {
        metadata.tenantId = credentials.tenantId;
      }
      if (typeof credentials.subscriptionId === 'string') {
        metadata.subscriptionId = credentials.subscriptionId;
      }
    }

    // Create connection (only after validation passes — or as a pending
    // connection when the AWS Role ARN arrives later via update-credentials)
    const connection = await this.connectionService.createConnection({
      providerSlug,
      organizationId,
      authStrategy: manifest.auth.type,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    // Store credentials if provided. The row above is useless without its
    // vault entry (phase 2 pins the External ID from the vault), so a vault
    // failure must not leave an orphan pending row behind that can never
    // complete — delete the row and surface the error.
    const storedCredentials = effectiveCredentials ?? credentials;
    if (storedCredentials && Object.keys(storedCredentials).length > 0) {
      try {
        await this.credentialVaultService.storeApiKeyCredentials(
          connection.id,
          storedCredentials,
        );
      } catch (error) {
        this.logger.error(
          `Vault write failed for new connection ${connection.id} — deleting orphan row`,
          error instanceof Error ? error.stack : String(error),
        );
        try {
          await this.connectionService.deleteConnection(connection.id);
        } catch (cleanupError) {
          this.logger.error(
            `Failed to delete orphan connection ${connection.id} after vault failure`,
            cleanupError instanceof Error
              ? cleanupError.stack
              : String(cleanupError),
          );
        }
        throw error;
      }
    }

    const isPendingAwsCreate = providerSlug === 'aws' && !hasAwsRoleArn;
    if (isPendingAwsCreate) {
      // No Role ARN yet: the IAM role cannot exist, so there is nothing to
      // validate or activate. The minted External ID below is the show-once
      // value the setup UI injects into the CloudShell script.
      this.logger.log(
        `Created pending AWS connection ${connection.id}, org: ${organizationId}`,
      );
      return {
        id: connection.id,
        providerId: connection.providerId,
        status: 'pending',
        authStrategy: connection.authStrategy,
        createdAt: connection.createdAt,
        externalId:
          typeof storedCredentials?.externalId === 'string'
            ? storedCredentials.externalId
            : undefined,
      };
    }

    // Mark connection as active since validation already passed
    await this.connectionService.activateConnection(connection.id);

    this.logger.log(
      `Created connection for ${providerSlug}, org: ${organizationId}`,
    );

    // Auto-run checks if possible (fire and forget)
    this.autoCheckRunnerService
      .tryAutoRunChecks(connection.id)
      .then((didRun) => {
        if (didRun) {
          this.logger.log(
            `Auto-ran checks for ${providerSlug} after connection created`,
          );
        }
      })
      .catch((err) => {
        this.logger.warn(
          `Failed to auto-run checks after connection: ${err.message}`,
        );
      });

    return {
      id: connection.id,
      providerId: connection.providerId,
      status: 'active', // We already activated it
      authStrategy: connection.authStrategy,
      createdAt: connection.createdAt,
      // Show-once: the minted External ID, so API callers can inject it
      // into the CloudShell script without a second round trip.
      externalId:
        providerSlug === 'aws' &&
        typeof storedCredentials?.externalId === 'string'
          ? storedCredentials.externalId
          : undefined,
    };
  }

  /**
   * Validate AWS credentials (IAM role + Security Hub) WITHOUT creating a connection
   */
  private async validateAwsCredentials(
    credentials: Record<string, string | string[]>,
  ): Promise<{ success: boolean; message: string; details?: unknown }> {
    // Trim pasted credential strings in place before anything else. The
    // vault stores raw credential strings, so a pasted ARN with a trailing
    // space would otherwise pass trim-tolerant validation here yet fail
    // later STS calls that send the stored value verbatim. Both callers
    // pass the to-be-stored object (same reference), so normalizing here
    // fixes the vault value and the metadata built from it downstream.
    trimAwsCredentialStrings(credentials);
    // Validate types before using values
    const roleArnValue = credentials.roleArn;
    const externalIdValue = credentials.externalId;
    const regionsValue = credentials.regions;
    const partition = normalizeAwsPartition(credentials.awsType);

    if (typeof roleArnValue !== 'string' || !roleArnValue.trim()) {
      return { success: false, message: 'Missing or invalid IAM Role ARN' };
    }
    if (typeof externalIdValue !== 'string' || !externalIdValue.trim()) {
      return { success: false, message: 'Missing or invalid External ID' };
    }
    // Fail closed on control characters: the External ID is interpolated
    // into generated CloudShell setup scripts (`EXTERNAL_ID="..."`), where
    // a newline breaks out of the assignment and injects shell commands run
    // by a later admin. Reject before anything persists it.
    if (/[\r\n]/.test(externalIdValue)) {
      return {
        success: false,
        message:
          'External ID must not contain line breaks. Use the server-issued value for this connection.',
      };
    }
    if (!Array.isArray(regionsValue) || regionsValue.length === 0) {
      return { success: false, message: 'No AWS regions selected' };
    }

    // Now we have validated types
    const roleArn = roleArnValue.trim();
    const externalId = externalIdValue.trim();
    const regions = regionsValue.filter(
      (r): r is string => typeof r === 'string' && r.trim() !== '',
    );
    // Per-pair map, stored as a JSON string (`{"Class:region": "arn:..."}`).
    // Parsed here so every entry gets the same fail-closed validation as
    // the legacy single ARN below. Malformed JSON is rejected outright:
    // the lenient parser yields `{}` for garbage, which would otherwise
    // loop over zero entries and pass validation with no errors.
    // Object-form values are rejected: storage and validation both expect
    // the JSON-string shape, so an object would skip every pair check
    // below yet still persist.
    if (
      credentials.remediationRoles !== undefined &&
      credentials.remediationRoles !== null &&
      typeof credentials.remediationRoles !== 'string'
    ) {
      return {
        success: false,
        message:
          'remediationRoles: must be a JSON object mapping "<AssetClass>:<region>" to role ARN.',
      };
    }
    if (
      typeof credentials.remediationRoles === 'string' &&
      credentials.remediationRoles.trim()
    ) {
      const rawRolesError = getRemediationRolesParseError(
        credentials.remediationRoles,
      );
      if (rawRolesError) {
        return { success: false, message: rawRolesError };
      }
    }
    const remediationRoles =
      typeof credentials.remediationRoles === 'string' &&
      credentials.remediationRoles.trim()
        ? parseRemediationRolesMap(credentials.remediationRoles)
        : undefined;

    if (regions.length === 0) {
      return { success: false, message: 'No valid AWS regions selected' };
    }

    // Fail closed on placeholder External IDs left over from the setup
    // instructions. A guessable/documented default defeats the
    // confused-deputy protection the External ID exists for.
    if (externalId.toUpperCase() === 'YOUR_EXTERNAL_ID') {
      return {
        success: false,
        message:
          'External ID is still the placeholder from the setup instructions. Generate a connection first and use the issued value.',
      };
    }

    // Allowlist the External ID to the STS charset (alphanumerics plus
    // `_+=,.@:/-`). The value is interpolated into generated CloudShell
    // scripts, so anything outside this set (spaces, quotes, shell
    // metacharacters) is rejected before it can persist — including values
    // stored before server-side minting. Server-minted values always match.
    if (!/^[A-Za-z0-9_+=,.@:/-]+$/.test(externalId)) {
      return {
        success: false,
        message:
          'External ID contains unsupported characters. Use the server-issued value for this connection.',
      };
    }

    const partitionErrors = validateAwsPartitionConfig({
      partition,
      roleArn,
      regions,
      remediationRoles,
    });
    if (partitionErrors.length > 0) {
      return { success: false, message: partitionErrors.join(' ') };
    }

    const parsedRoleArn = parseAwsRoleArn(roleArn);
    if (!parsedRoleArn) {
      return {
        success: false,
        message: 'Invalid IAM Role ARN format.',
      };
    }

    const roleAssumerArn = getAwsRoleAssumerArn(partition);
    if (!roleAssumerArn) {
      const envName = getAwsRoleAssumerEnvName(partition);
      this.logger.error(`Missing ${envName} environment variable`);
      return {
        success: false,
        message: 'Server configuration error - contact support',
      };
    }

    const primaryRegion = regions[0];

    try {
      // Step 1: Assume our role assumer role
      this.logger.log('Validating AWS: Assuming role assumer...');
      const baseSts = new STSClient({
        region: primaryRegion,
        credentials: getAwsBaseCredentials(partition),
      });
      const roleAssumerResp = await baseSts.send(
        new AssumeRoleCommand({
          RoleArn: roleAssumerArn,
          RoleSessionName: 'CompValidation',
          DurationSeconds: 900,
        }),
      );

      const roleAssumerCreds = roleAssumerResp.Credentials;
      if (!roleAssumerCreds?.AccessKeyId || !roleAssumerCreds.SecretAccessKey) {
        throw new Error(
          'Failed to assume role assumer - no credentials returned',
        );
      }

      // Step 2: Assume the customer's role
      this.logger.log(`Validating AWS: Assuming customer role ${roleArn}...`);
      const roleAssumerSts = new STSClient({
        region: primaryRegion,
        credentials: {
          accessKeyId: roleAssumerCreds.AccessKeyId,
          secretAccessKey: roleAssumerCreds.SecretAccessKey,
          sessionToken: roleAssumerCreds.SessionToken,
        },
      });

      const customerResp = await roleAssumerSts.send(
        new AssumeRoleCommand({
          RoleArn: roleArn,
          ExternalId: externalId,
          RoleSessionName: 'CompValidation',
          DurationSeconds: 900,
        }),
      );

      const customerCreds = customerResp.Credentials;
      if (!customerCreds?.AccessKeyId || !customerCreds.SecretAccessKey) {
        throw new Error(
          'Failed to assume customer role - no credentials returned',
        );
      }

      this.logger.log(
        'Validating AWS: Role assumption successful, verifying identity...',
      );

      // Step 3: Verify assumed identity works
      const awsCredentials = {
        accessKeyId: customerCreds.AccessKeyId,
        secretAccessKey: customerCreds.SecretAccessKey,
        sessionToken: customerCreds.SessionToken,
      };

      const customerSts = new STSClient({
        region: primaryRegion,
        credentials: awsCredentials,
      });
      const identity = await customerSts.send(new GetCallerIdentityCommand({}));
      this.logger.log(
        `Validated AWS identity: ${identity.Arn} (Account: ${identity.Account})`,
      );

      // Step 4 (remediation only): assume each remediation role with a
      // short session, then prove the trust policy actually requires the
      // External ID — an assume that succeeds WITHOUT it means the trust
      // policy is too open and the ARN must not be stored. Every per-pair
      // map entry gets the identical proof.
      const remediationTrustError = await validateRemediationRoleTrust({
        roleAssumerSts,
        roleArns: [...Object.values(remediationRoles ?? {})],
        externalId,
        logger: this.logger,
      });
      if (remediationTrustError) {
        return { success: false, message: remediationTrustError };
      }

      // All validations passed!
      const remediationConfigured =
        Object.keys(remediationRoles ?? {}).length > 0;
      const remediationNote = remediationConfigured
        ? ' Remediation roles validated.'
        : '';
      const message =
        regions.length === 1
          ? `Validated! Connected to AWS account ${identity.Account} in ${regions[0]}.${remediationNote}`
          : `Validated! Connected to AWS account ${identity.Account} in ${regions.length} regions.${remediationNote}`;

      return {
        success: true,
        message,
        details: {
          account: identity.Account ?? parsedRoleArn.accountId,
          regions,
        },
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Validation failed';

      // Provide user-friendly error messages
      let friendlyMessage = errorMessage;
      if (
        errorMessage.includes('is not authorized to perform: sts:AssumeRole')
      ) {
        friendlyMessage = `Cannot assume the IAM role. Please verify: (1) The Role ARN is correct, (2) The trust policy allows our role assumer (${roleAssumerArn}), (3) The External ID matches exactly.`;
      } else if (errorMessage.includes('AccessDenied')) {
        friendlyMessage =
          'Access denied. Please check that your IAM role has the required permissions (SecurityAudit policy).';
      } else if (errorMessage.includes('InvalidIdentityToken')) {
        friendlyMessage =
          'Invalid credentials. Please check your IAM role configuration.';
      }

      // Use warn instead of error - this is a user configuration issue, not a system error
      this.logger.warn(`AWS validation failed: ${errorMessage}`);
      return { success: false, message: friendlyMessage };
    }
  }

  /**
   * Test a connection's credentials
   */
  @Post(':id/test')
  @ApiOperation({ summary: 'Test an integration connection' })
  @RequirePermission('integration', 'update')
  @ApiCreatedResponse({
    description: 'Test an integration connection completed successfully',
  })
  @ApiAuthErrors()
  async testConnection(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    const connection = await this.connectionService.getConnectionForOrg(
      id,
      organizationId,
    );
    const providerSlug = getProviderSummary(connection)?.slug;

    if (!providerSlug) {
      throw new HttpException(
        'Provider not found for connection',
        HttpStatus.NOT_FOUND,
      );
    }

    // Get credentials
    const credentials =
      await this.credentialVaultService.getDecryptedCredentials(connection.id);
    if (!credentials) {
      throw new HttpException(
        'No credentials found for connection',
        HttpStatus.BAD_REQUEST,
      );
    }

    // AWS-specific validation
    if (providerSlug === 'aws') {
      return this.testAwsConnection(connection.id, credentials);
    }

    // For other providers, use the manifest handler
    const manifest = getManifest(providerSlug);
    if (!manifest?.handler?.testConnection) {
      // No handler defined - just activate the connection
      await this.connectionService.activateConnection(connection.id);
      return { success: true, message: 'Connection activated' };
    }

    try {
      const isValid = await manifest.handler.testConnection(credentials);

      if (isValid) {
        await this.connectionService.activateConnection(connection.id);
        return { success: true, message: 'Connection test successful' };
      } else {
        await this.connectionService.setConnectionError(
          connection.id,
          'Connection test failed',
        );
        return { success: false, message: 'Connection test failed' };
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Connection test failed';
      await this.connectionService.setConnectionError(
        connection.id,
        errorMessage,
      );
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Test AWS connection by validating and updating connection status
   */
  private async testAwsConnection(
    connectionId: string,
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; message: string; details?: unknown }> {
    // Use the shared validation method
    const result = await this.validateAwsCredentials(
      credentials as Record<string, string | string[]>,
    );

    // Update connection status based on validation result
    if (result.success) {
      await this.connectionService.activateConnection(connectionId);
    } else {
      await this.connectionService.setConnectionError(
        connectionId,
        result.message,
      );
    }

    return result;
  }

  /**
   * Pause a connection
   */
  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause an integration connection' })
  @RequirePermission('integration', 'update')
  @ApiCreatedResponse({
    description: 'Pause an integration connection completed successfully',
  })
  @ApiAuthErrors()
  async pauseConnection(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    await this.connectionService.getConnectionForOrg(id, organizationId);
    const connection = await this.connectionService.pauseConnection(id);
    return { id: connection.id, status: connection.status };
  }

  /**
   * Resume a paused connection
   */
  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume an integration connection' })
  @RequirePermission('integration', 'update')
  @ApiCreatedResponse({
    description: 'Resume an integration connection completed successfully',
  })
  @ApiAuthErrors()
  async resumeConnection(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    await this.connectionService.getConnectionForOrg(id, organizationId);
    const connection = await this.connectionService.activateConnection(id);
    return { id: connection.id, status: connection.status };
  }

  /**
   * Disconnect (soft delete) a connection
   */
  @Post(':id/disconnect')
  @ApiOperation({ summary: 'Disconnect an integration' })
  @RequirePermission('integration', 'delete')
  @ApiCreatedResponse({
    description: 'Disconnect an integration completed successfully',
  })
  @ApiAuthErrors()
  async disconnectConnection(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    await this.connectionService.getConnectionForOrg(id, organizationId);
    const connection = await this.connectionService.disconnectConnection(id);
    return { id: connection.id, status: connection.status };
  }

  /**
   * Delete a connection permanently
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an integration connection' })
  @RequirePermission('integration', 'delete')
  @ApiOkResponse({
    description: 'An integration connection deleted successfully',
  })
  @ApiAuthErrors()
  async deleteConnection(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    await this.connectionService.getConnectionForOrg(id, organizationId);
    await this.connectionService.deleteConnection(id);
    return { success: true };
  }

  /**
   * Update connection metadata (connectionName, regions, etc.)
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update an integration connection' })
  @ApiBody({ type: UpdateConnectionDto })
  @RequirePermission('integration', 'update')
  @ApiOkResponse({
    description: 'An integration connection updated successfully',
  })
  @ApiAuthErrors()
  async updateConnection(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
    @Body() body: UpdateConnectionDto,
  ) {
    const connection = await this.connectionService.getConnectionForOrg(
      id,
      organizationId,
    );

    if (body.metadata && Object.keys(body.metadata).length > 0) {
      // Merge with existing metadata
      const existingMetadata = (connection.metadata || {}) as Record<
        string,
        unknown
      >;
      // The External ID display value is server-owned (minted at create,
      // synced from the vault on credential updates). Dropping a
      // client-supplied value here keeps the setup script showing the real
      // one instead of a spoofed value that validation would reject.
      const { externalId: _ignoredExternalId, ...clientMetadata } =
        body.metadata;
      const updatedMetadata = { ...existingMetadata, ...clientMetadata };

      await this.connectionService.updateConnectionMetadata(
        id,
        updatedMetadata,
      );
    }

    return { success: true };
  }

  /**
   * Get valid credentials for a connection, refreshing OAuth tokens if needed.
   * Used by scheduled jobs to ensure tokens are valid before running checks.
   */
  @Post(':id/ensure-valid-credentials')
  @ApiOperation({ summary: 'Ensure valid credentials for a connection' })
  @ApiBody({ type: EnsureValidCredentialsDto, required: false })
  @RequirePermission('integration', 'update')
  async ensureValidCredentials(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
    @Body() body?: EnsureValidCredentialsDto,
  ) {
    const connection = await this.connectionService.getConnectionForOrg(
      id,
      organizationId,
    );

    if (connection.status !== 'active') {
      throw new HttpException(
        'Connection is not active',
        HttpStatus.BAD_REQUEST,
      );
    }

    const providerSlug = getProviderSummary(connection)?.slug;
    if (!providerSlug) {
      throw new HttpException(
        'Provider not found for connection',
        HttpStatus.NOT_FOUND,
      );
    }

    const manifest = getManifest(providerSlug);
    if (!manifest) {
      throw new HttpException(
        `Manifest not found for ${providerSlug}`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Check if token needs refresh (for OAuth integrations that support it)
    if (manifest.auth.type === 'oauth2') {
      const oauthConfig = manifest.auth.config;

      // Skip refresh for providers that don't support refresh tokens (e.g., GitHub)
      const supportsRefresh = oauthConfig.supportsRefreshToken !== false;

      if (supportsRefresh) {
        const forceRefresh = body?.forceRefresh === true;
        const needsRefresh =
          forceRefresh || (await this.credentialVaultService.needsRefresh(id));

        if (needsRefresh) {
          this.logger.log(
            forceRefresh
              ? `Force refreshing token for connection ${id}...`
              : `Token needs refresh for connection ${id}, attempting refresh...`,
          );

          const oauthCredentials =
            await this.oauthCredentialsService.getCredentials(
              providerSlug,
              organizationId,
            );

          if (!oauthCredentials) {
            throw new HttpException(
              'OAuth credentials not configured',
              HttpStatus.BAD_REQUEST,
            );
          }

          const newToken = await this.credentialVaultService.refreshOAuthTokens(
            id,
            {
              tokenUrl: oauthConfig.tokenUrl,
              refreshUrl: oauthConfig.refreshUrl,
              clientId: oauthCredentials.clientId,
              clientSecret: oauthCredentials.clientSecret,
              clientAuthMethod: oauthConfig.clientAuthMethod,
              scope: oauthCredentials.scopes.join(' '),
              tokenParams: oauthConfig.tokenParams,
            },
          );

          if (!newToken) {
            const refreshedConnection =
              await this.connectionService.getConnectionForOrg(
                id,
                organizationId,
              );
            if (refreshedConnection.status === 'error') {
              throw new HttpException(
                refreshedConnection.errorMessage ??
                  'Token refresh failed. Please reconnect the integration.',
                HttpStatus.UNAUTHORIZED,
              );
            }

            throw new HttpException(
              'Token refresh temporarily failed. Please try again.',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          }

          this.logger.log(`Successfully refreshed token for connection ${id}`);
        }
      }
    }

    // Get current credentials
    const credentials =
      await this.credentialVaultService.getDecryptedCredentials(id);

    if (!credentials) {
      throw new HttpException(
        'No credentials found for connection',
        HttpStatus.BAD_REQUEST,
      );
    }

    // For OAuth, validate access_token exists
    const accessToken =
      typeof credentials.access_token === 'string'
        ? credentials.access_token
        : undefined;

    if (manifest.auth.type === 'oauth2' && !accessToken) {
      throw new HttpException(
        'No valid OAuth credentials found. Please reconnect.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // For API key auth, validate key exists
    if (manifest.auth.type === 'api_key') {
      const apiKeyField = manifest.auth.config.name;
      if (
        !hasCredentialValue(credentials[apiKeyField]) &&
        !hasCredentialValue(credentials.api_key)
      ) {
        throw new HttpException('API key not found', HttpStatus.BAD_REQUEST);
      }
    }

    // For basic auth, validate username and password exist
    if (manifest.auth.type === 'basic') {
      const usernameField = manifest.auth.config.usernameField || 'username';
      const passwordField = manifest.auth.config.passwordField || 'password';
      if (
        !hasCredentialValue(credentials[usernameField]) ||
        !hasCredentialValue(credentials[passwordField])
      ) {
        throw new HttpException(
          'Username and password required',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // For custom auth (like AWS), validate credentials exist
    if (
      manifest.auth.type === 'custom' &&
      Object.keys(credentials).length === 0
    ) {
      throw new HttpException(
        'No valid credentials found for custom integration',
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      success: true,
      accessToken,
      credentials,
    };
  }

  /**
   * Update enabled services for a connection
   */
  @Put(':id/services')
  @ApiOperation({ summary: 'Set services enabled on a connection' })
  @ApiBody({ type: UpdateConnectionServicesDto })
  @RequirePermission('integration', 'update')
  @ApiOkResponse({
    description: 'Services enabled on a connection updated successfully',
  })
  @ApiAuthErrors()
  async updateConnectionServices(
    @Param('id') id: string,
    @Body() body: UpdateConnectionServicesDto,
    @OrganizationId() organizationId: string,
  ) {
    if (!Array.isArray(body.services)) {
      throw new HttpException(
        'services must be an array of service IDs',
        HttpStatus.BAD_REQUEST,
      );
    }

    const connection = await this.connectionService.getConnectionForOrg(
      id,
      organizationId,
    );

    const raw = connection.variables;
    const existingVariables: Record<string, unknown> =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    // Get ALL possible services from the manifest
    const provider = await db.integrationProvider.findUnique({
      where: { id: connection.providerId },
      select: { slug: true },
    });
    const manifest = provider ? getManifest(provider.slug) : null;
    const allManifestServices = new Set<string>(
      manifest?.services?.map((s: { id: string }) => s.id) ?? [],
    );

    // disabledServices = all manifest services MINUS what user sent as enabled
    const enabledSet = new Set(body.services);
    const disabledServices = [...allManifestServices].filter(
      (s) => !enabledSet.has(s),
    );

    // Merge user-enabled services into detectedServices so the GET
    // logic treats them as "known" services (user intent > auto-detection)
    const currentDetected = new Set<string>(
      Array.isArray(existingVariables.detectedServices)
        ? (existingVariables.detectedServices as string[])
        : [],
    );
    for (const id of body.services) {
      currentDetected.add(id);
    }

    await this.connectionRepository.update(id, {
      variables: {
        ...existingVariables,
        disabledServices,
        detectedServices: [...currentDetected],
        // Clear legacy enabledServices to use new smart logic
        enabledServices: undefined,
      },
    });

    return { success: true, disabledServices };
  }

  /**
   * Bind (or clear) remediator-SA pairs on a GCP OAuth connection.
   * Stores only SA emails — no token material. A non-empty binding is
   * stored only after the impersonation trust probe passes. When the
   * backend impersonator is unconfigured the binding is still stored but
   * execute-time minting fails closed (fail visibly, never certify).
   * When the auditor token is missing the trust cannot be proven closed,
   * so the binding is refused instead of stored unverified.
   */
  private async updateGcpRemediationBinding(args: {
    id: string;
    organizationId: string;
    connection: { metadata?: unknown };
    gcpRemediation: string;
  }) {
    const parseError = getGcpRemediationMapParseError(args.gcpRemediation);
    if (parseError) {
      throw new HttpException(parseError, HttpStatus.BAD_REQUEST);
    }
    const pairs = parseGcpRemediationMap(args.gcpRemediation);

    const existingCredentials =
      await this.credentialVaultService.getDecryptedCredentials(args.id);
    if (Object.keys(pairs).length > 0) {
      const auditorToken =
        typeof existingCredentials?.access_token === 'string'
          ? existingCredentials.access_token
          : undefined;
      if (!auditorToken) {
        throw new HttpException(
          'Cannot verify the remediator trust without the auditor token. Reconnect the GCP integration, then set the binding again.',
          HttpStatus.BAD_REQUEST,
        );
      }
      let backendCallerToken: string | undefined;
      try {
        backendCallerToken = this.gcpImpersonationService.resolveCallerToken();
      } catch {
        this.logger.warn(
          `GCP impersonation unconfigured — storing binding on ${args.id} without trust probe; execute-time minting will fail closed.`,
        );
      }
      if (backendCallerToken) {
        const trustError = await validateGcpRemediationTrust({
          saEmails: [...Object.values(pairs)],
          auditorToken,
          impersonationService: this.gcpImpersonationService,
          backendCallerToken,
          logger: this.logger,
        });
        if (trustError) {
          throw new HttpException(trustError, HttpStatus.BAD_REQUEST);
        }
      }
    }

    const mergedCredentials = {
      ...(existingCredentials ?? {}),
      gcpRemediation: args.gcpRemediation,
    } as Record<string, string | string[]>;
    if (Object.keys(pairs).length === 0) {
      delete mergedCredentials.gcpRemediation;
    }
    await this.credentialVaultService.storeApiKeyCredentials(
      args.id,
      mergedCredentials,
    );

    const existingMeta = (args.connection.metadata ?? {}) as Record<
      string,
      unknown
    >;
    const nextMetadata = { ...existingMeta };
    if (Object.keys(pairs).length > 0) {
      nextMetadata.gcpRemediation = pairs;
    } else {
      delete nextMetadata.gcpRemediation;
    }
    try {
      await this.connectionRepository.update(args.id, {
        metadata: nextMetadata,
      });
    } catch (metadataError) {
      // The vault write above already flipped the active credential version
      // while metadata still shows the old binding. Flip the vault back to
      // the snapshot so display state (metadata) and effective state (vault)
      // cannot disagree, then surface the original failure.
      this.logger.error(
        `GCP binding metadata update failed on ${args.id} — restoring previous vault version`,
        metadataError instanceof Error
          ? metadataError.stack
          : String(metadataError),
      );
      if (existingCredentials) {
        try {
          await this.credentialVaultService.storeApiKeyCredentials(
            args.id,
            existingCredentials,
          );
        } catch (restoreError) {
          this.logger.error(
            `Failed to restore vault version on ${args.id} after metadata failure — vault and metadata disagree, retry the binding update`,
            restoreError instanceof Error
              ? restoreError.stack
              : String(restoreError),
          );
        }
      }
      throw metadataError;
    }
    this.logger.log(
      `Updated GCP remediator binding on connection ${args.id} (${Object.keys(pairs).length} pairs)`,
    );
    return { success: true };
  }

  /**
   * Update credentials for a custom auth connection
   */
  @Put(':id/credentials')
  @ApiOperation({ summary: 'Update integration credentials' })
  @ApiBody({ type: UpdateConnectionCredentialsDto })
  @RequirePermission('integration', 'update')
  async updateCredentials(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
    @Body() body: UpdateConnectionCredentialsDto,
  ) {
    const connection = await this.connectionService.getConnectionForOrg(
      id,
      organizationId,
    );

    const providerSlug = getProviderSummary(connection)?.slug;
    if (!providerSlug) {
      throw new HttpException(
        'Provider not found for connection',
        HttpStatus.NOT_FOUND,
      );
    }

    const manifest = getManifest(providerSlug);
    if (!manifest) {
      throw new HttpException(
        `Manifest not found for ${providerSlug}`,
        HttpStatus.NOT_FOUND,
      );
    }

    // OAuth connections cannot rotate tokens via this endpoint — except
    // GCP remediator-SA bindings, which carry only the `gcpRemediation`
    // pair map (no token material) and are validated + trust-probed below.
    const isGcpRemediationBindingUpdate =
      providerSlug === 'gcp' &&
      body.credentials != null &&
      Object.keys(body.credentials).length === 1 &&
      typeof body.credentials.gcpRemediation === 'string';
    if (isGcpRemediationBindingUpdate) {
      return this.updateGcpRemediationBinding({
        id,
        organizationId,
        connection,
        gcpRemediation: body.credentials.gcpRemediation as string,
      });
    }

    // Only allow updating credentials for non-OAuth integrations
    if (manifest.auth.type === 'oauth2') {
      throw new HttpException(
        'Credential updates are not supported for OAuth integrations. Please disconnect and reconnect to refresh the OAuth token.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Merge with existing credentials for fields not being updated
    const existingCredentials =
      await this.credentialVaultService.getDecryptedCredentials(id);
    const mergedCredentials = {
      ...(existingCredentials ?? {}),
      ...body.credentials,
    } as Record<string, string | string[]>;

    // Grandfather the External ID: the stored server-minted value (if any)
    // always wins. Accepting a client-supplied rotation here would break the
    // customer's trust policies. Legacy rows created before server minting
    // have no stored value: adopt an explicit client value when one is sent,
    // otherwise mint a fresh one — the new UI never sends one, and without
    // this the update could never validate.
    if (providerSlug === 'aws') {
      const storedExternalId = existingCredentials?.externalId;
      if (typeof storedExternalId === 'string' && storedExternalId.trim()) {
        if (
          typeof mergedCredentials.externalId === 'string' &&
          mergedCredentials.externalId.trim() &&
          mergedCredentials.externalId.trim() !== storedExternalId.trim()
        ) {
          this.logger.warn(
            `Ignoring client-supplied externalId rotation on connection ${id} — pinned to stored value.`,
          );
        }
        mergedCredentials.externalId = storedExternalId;
      } else if (
        typeof mergedCredentials.externalId !== 'string' ||
        !mergedCredentials.externalId.trim()
      ) {
        mergedCredentials.externalId = generateAwsExternalId(organizationId);
        this.logger.log(
          `Minted missing External ID on credential update for connection ${id} (legacy row)`,
        );
      }
    }

    // Drop the removed monolith credential: the field no longer exists in
    // the manifest or validation, and nothing reads it back. Deleting here
    // migrates the vault entry on the next credential update instead of
    // leaving a dead ARN beside the pair map.
    if (providerSlug === 'aws') {
      delete mergedCredentials.remediationRoleArn;
    }

    // For AWS, validate credentials BEFORE saving
    if (providerSlug === 'aws') {
      const validationResult =
        await this.validateAwsCredentials(mergedCredentials);
      if (!validationResult.success) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: validationResult.message,
            error: 'Validation Failed',
            details: validationResult.details,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      this.logger.log('AWS credentials validated successfully for update');
    }

    // Store the new credentials (only after validation passes)
    await this.credentialVaultService.storeApiKeyCredentials(
      id,
      mergedCredentials,
    );

    // Sync non-secret fields to metadata for display (pre-fill settings forms)
    const metaUpdates: Record<string, unknown> = {};
    if (typeof mergedCredentials.roleArn === 'string') {
      metaUpdates.roleArn = mergedCredentials.roleArn;
      const parsedRoleArn = parseAwsRoleArn(mergedCredentials.roleArn);
      if (parsedRoleArn) metaUpdates.accountId = parsedRoleArn.accountId;
    }
    if (
      typeof mergedCredentials.connectionName === 'string' &&
      mergedCredentials.connectionName.trim()
    ) {
      metaUpdates.connectionName = mergedCredentials.connectionName.trim();
    }
    if (
      typeof mergedCredentials.awsScanMode === 'string' &&
      (mergedCredentials.awsScanMode === 'comp_scanners' ||
        mergedCredentials.awsScanMode === 'security_hub')
    ) {
      metaUpdates.awsScanMode = mergedCredentials.awsScanMode;
    }
    // The External ID display value always follows the vault (which the
    // grandfather pin above keeps server-minted) — never client metadata.
    if (typeof mergedCredentials.externalId === 'string') {
      metaUpdates.externalId = mergedCredentials.externalId;
    }
    if (
      typeof mergedCredentials.remediationRoles === 'string' &&
      mergedCredentials.remediationRoles.trim()
    ) {
      const pairs = parseRemediationRolesMap(
        mergedCredentials.remediationRoles,
      );
      if (Object.keys(pairs).length > 0) metaUpdates.remediationRoles = pairs;
    }
    // Explicitly cleared pair map ("" / "{}"): drop the synced copy so the
    // settings UI stops showing removed pairs. Validation above already
    // rejected malformed JSON, so zero parsed pairs here means "no pairs",
    // never "invalid input".
    const clearRemediationRoles =
      typeof body.credentials?.remediationRoles === 'string' &&
      Object.keys(parseRemediationRolesMap(body.credentials.remediationRoles))
        .length === 0;
    if (typeof mergedCredentials.awsType === 'string') {
      metaUpdates.awsType = mergedCredentials.awsType;
    }
    if (Array.isArray(mergedCredentials.regions)) {
      metaUpdates.regions = mergedCredentials.regions;
    }
    // Mark cloud credential updates as reconnections so reconnect banners clear
    if (manifest.category === 'Cloud') {
      metaUpdates.reconnectedAt = new Date().toISOString();
    }
    if (Object.keys(metaUpdates).length > 0 || clearRemediationRoles) {
      const existingMeta =
        (connection.metadata as Record<string, unknown>) ?? {};
      const nextMetadata = { ...existingMeta, ...metaUpdates };
      if (clearRemediationRoles) delete nextMetadata.remediationRoles;
      // The monolith credential is removed: drop the synced copy so the
      // settings UI stops offering the legacy field. Vault cleanup happens
      // above; this clears the display key on the same update.
      delete nextMetadata.remediationRoleArn;
      await this.connectionRepository.update(id, {
        metadata: nextMetadata,
      });
    }

    // Activate a pending AWS connection once its credentials validate (this
    // is how pending AWS creates complete), and keep the existing behavior
    // of reviving error-state connections. Never touch paused connections —
    // and never auto-activate pending connections for providers whose
    // credentials were not just verified.
    const shouldActivate =
      connection.status === 'error' ||
      (connection.status === 'pending' && providerSlug === 'aws');
    if (shouldActivate) {
      await this.connectionService.activateConnection(id);
      this.logger.log(
        `Activated connection ${id} after credential update (was in ${connection.status} state)`,
      );
    }

    this.logger.log(`Updated credentials for connection ${id}`);

    // Auto-run checks if possible (fire and forget)
    this.autoCheckRunnerService
      .tryAutoRunChecks(id)
      .then((didRun) => {
        if (didRun) {
          this.logger.log(
            `Auto-ran checks for connection ${id} after credential update`,
          );
        }
      })
      .catch((err) => {
        this.logger.warn(
          `Failed to auto-run checks after credential update: ${err.message}`,
        );
      });

    return { success: true };
  }
}
