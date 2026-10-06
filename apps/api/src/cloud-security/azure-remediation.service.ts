import { Injectable, Logger } from '@nestjs/common';
import { CredentialVaultService } from '../integration-platform/services/credential-vault.service';
import { OAuthCredentialsService } from '../integration-platform/services/oauth-credentials.service';
import { AiRemediationService } from './ai-remediation.service';
import { AzureSecurityService } from './providers/azure-security.service';
import { previewAzureRemediation } from './azure-remediation-preview';
import {
  failAzureExecution,
  prepareAzureExecution,
  type AzureExecuteParams,
} from './azure-remediation-execute';
import { runAzureFixPhases } from './azure-remediation-fix-runner';
import { verifyAndFinalizeAzureExecution } from './azure-remediation-verify';
import { rollbackAzureRemediation } from './azure-remediation-rollback';
import { resolveAzureCredentials } from './azure-remediation-context';
import type { AzureRemediationFlowDeps } from './azure-remediation-context';
import { AzureRemediationPlanCache } from './azure-remediation-plan-cache';

/**
 * Azure AI remediation entry point. Thin orchestration only — preview,
 * execute phases, verification, and rollback live in focused modules
 * beside this file so each stays under the 300-line repo limit.
 */
@Injectable()
export class AzureRemediationService {
  private readonly logger = new Logger(AzureRemediationService.name);
  private readonly planCache = new AzureRemediationPlanCache();

  constructor(
    private readonly credentialVaultService: CredentialVaultService,
    private readonly oauthCredentialsService: OAuthCredentialsService,
    private readonly aiRemediationService: AiRemediationService,
    private readonly azureSecurityService: AzureSecurityService,
  ) {}

  private flowDeps(): AzureRemediationFlowDeps {
    return {
      credentialVaultService: this.credentialVaultService,
      oauthCredentialsService: this.oauthCredentialsService,
      azureSecurityService: this.azureSecurityService,
      aiRemediationService: this.aiRemediationService,
      logger: this.logger,
      planCache: this.planCache,
    };
  }

  async getCapabilities(params: {
    connectionId: string;
    organizationId: string;
  }) {
    const credentials = await resolveAzureCredentials(
      this.flowDeps(),
      params.connectionId,
      params.organizationId,
    );
    return {
      enabled: Boolean(credentials?.access_token || credentials?.clientId),
      aiPowered: true,
      remediations: [],
    };
  }

  async previewRemediation(params: {
    connectionId: string;
    organizationId: string;
    checkResultId: string;
    remediationKey: string;
  }) {
    return previewAzureRemediation({ deps: this.flowDeps(), ...params });
  }

  async executeRemediation(params: AzureExecuteParams) {
    const deps = this.flowDeps();
    const state = await prepareAzureExecution({ deps, params });
    try {
      const early = await runAzureFixPhases(state);
      if (early) return early.earlyResponse;
      return await verifyAndFinalizeAzureExecution(state);
    } catch (error) {
      // failAzureExecution records the failure and rethrows (Promise<never>),
      // so returning it keeps this function's return type free of undefined.
      return failAzureExecution(state, error);
    }
  }

  async rollbackRemediation(params: {
    actionId: string;
    organizationId: string;
  }) {
    return rollbackAzureRemediation({ deps: this.flowDeps(), ...params });
  }
}
