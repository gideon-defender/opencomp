import { Injectable, Logger } from '@nestjs/common';
import { db, Prisma } from '@db';
import {
  GCP_REMEDIATION_ASSET_CLASSES,
  getManifest,
  isApprovalGatedGcpAssetClass,
  parseGcpRemediationMap,
  type GcpRemediationAssetClass,
} from '@gideon-defender/integration-platform';
import { CredentialVaultService } from '../integration-platform/services/credential-vault.service';
import { OAuthCredentialsService } from '../integration-platform/services/oauth-credentials.service';
import { AiRemediationService } from './ai-remediation.service';
import { GcpImpersonationService } from './gcp-impersonation.service';
import { resolveGcpRemediationIdentity } from './gcp-remediation-role-resolver';
import { parseGcpPermissionError } from './remediation-error.utils';
import {
  executeGcpPlanSteps,
  validateGcpPlanSteps,
} from './gcp-command-executor';
import type { GcpFixPlan, GcpApiStep } from './gcp-ai-remediation.prompt';

/**
 * Extract the GCP project id for a finding: evidence `projectId` first,
 * then `projects/<id>` in the resource id, then display name as fallback.
 */
export function extractGcpFindingProjectId(args: {
  evidence: Record<string, unknown>;
  resourceId: string | null;
}): string {
  const fromEvidence =
    typeof args.evidence.projectId === 'string'
      ? args.evidence.projectId.trim()
      : '';
  if (fromEvidence) return fromEvidence;
  const match =
    typeof args.resourceId === 'string'
      ? args.resourceId.match(/projects\/([^/]+)/)
      : null;
  if (match?.[1]) return match[1];
  const display =
    typeof args.evidence.projectDisplayName === 'string'
      ? args.evidence.projectDisplayName.trim()
      : '';
  return display;
}

/** Short stable hash of plan steps for the audit trail. */
export function hashGcpPlanSteps(
  steps: Array<{ method: string; url: string; body?: unknown }>,
): string {
  const input = JSON.stringify(
    steps.map((s) => ({ method: s.method, url: s.url, body: s.body ?? null })),
  );
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return `gcp-${(hash >>> 0).toString(16)}`;
}

@Injectable()
export class GcpRemediationService {
  private readonly logger = new Logger(GcpRemediationService.name);
  private readonly planCache = new Map<
    string,
    { plan: GcpFixPlan; timestamp: number }
  >();
  private readonly PLAN_CACHE_MAX = 100;
  private readonly PLAN_CACHE_TTL = 5 * 60 * 1000;

  /**
   * A plan is only worth caching/reusing if it can actually be auto-applied.
   * Caching an empty or non-auto-fixable plan makes "Retry" a guaranteed
   * no-op: execute would reload the same dead plan and fail identically.
   */
  private isUsablePlan(plan: GcpFixPlan | undefined): boolean {
    return Boolean(
      plan?.canAutoFix && plan.fixSteps && plan.fixSteps.length > 0,
    );
  }

  private evictStalePlans() {
    if (this.planCache.size <= this.PLAN_CACHE_MAX) return;
    const now = Date.now();
    for (const [key, entry] of this.planCache) {
      if (now - entry.timestamp > this.PLAN_CACHE_TTL)
        this.planCache.delete(key);
    }
    while (this.planCache.size > this.PLAN_CACHE_MAX) {
      const firstKey: unknown = this.planCache.keys().next().value;
      if (typeof firstKey === 'string' && firstKey)
        this.planCache.delete(firstKey);
      else break;
    }
  }

  constructor(
    private readonly credentialVaultService: CredentialVaultService,
    private readonly oauthCredentialsService: OAuthCredentialsService,
    private readonly aiRemediationService: AiRemediationService,
    private readonly impersonationService: GcpImpersonationService,
  ) {}

  async getCapabilities(params: {
    connectionId: string;
    organizationId: string;
  }) {
    const credentials =
      await this.credentialVaultService.getDecryptedCredentials(
        params.connectionId,
      );

    const bindings = parseGcpRemediationMap(
      typeof credentials?.gcpRemediation === 'string'
        ? credentials.gcpRemediation
        : undefined,
    );
    return {
      enabled: Boolean(credentials?.access_token),
      aiPowered: true,
      remediations: [],
      remediationConfigured: Object.keys(bindings).length > 0,
    };
  }

  async previewRemediation(params: {
    connectionId: string;
    organizationId: string;
    checkResultId: string;
    remediationKey: string;
  }) {
    const { finding, accessToken } = await this.resolveContext(params);
    const evidence = (finding.evidence ?? {}) as Record<string, unknown>;
    const findingKey = evidence.findingKey as string;

    // Approval-gated classes never auto-execute: skip the AI plan and
    // return guided-only so the UI never offers one-click fix.
    const gate = await this.resolveGate(params, finding);
    if (gate.approvalGated) {
      return {
        currentState: {},
        proposedState: {},
        description: finding.description,
        risk: finding.severity,
        apiCalls: [],
        guidedOnly: true,
        guidedSteps: [
          finding.remediation ??
            `This ${gate.assetClass} finding requires human approval — apply the fix manually in the GCP console.`,
        ],
        rollbackSupported: false,
        requiresAcknowledgment: undefined,
      };
    }

    const plan = await this.aiRemediationService.generateGcpFixPlan({
      title: finding.title ?? 'Unknown',
      description: finding.description,
      severity: finding.severity,
      resourceType: finding.resourceType,
      resourceId: finding.resourceId,
      remediation: finding.remediation,
      findingKey,
      evidence,
    });

    if (!plan.canAutoFix) {
      return {
        currentState: plan.currentState,
        proposedState: {},
        description: plan.description,
        risk: plan.risk,
        apiCalls: [],
        guidedOnly: true,
        guidedSteps: plan.guidedSteps ?? [plan.reason ?? plan.description],
        rollbackSupported: false,
        requiresAcknowledgment: undefined,
      };
    }

    // Execute read steps to get real GCP state
    if (plan.readSteps.length > 0) {
      const readErrors = validateGcpPlanSteps(plan.readSteps);
      if (readErrors.length === 0) {
        try {
          const readResult = await executeGcpPlanSteps({
            steps: plan.readSteps,
            accessToken,
          });
          const realState = readResult.results.reduce(
            (acc, r) => ({ ...acc, [r.step.purpose]: r.output }),
            {} as Record<string, unknown>,
          );

          const refined = await this.aiRemediationService.refineGcpFixPlan({
            finding: {
              title: finding.title ?? 'Unknown',
              description: finding.description,
              severity: finding.severity,
              resourceType: finding.resourceType,
              resourceId: finding.resourceId,
              remediation: finding.remediation,
              findingKey,
              evidence,
            },
            originalPlan: plan,
            realGcpState: realState,
          });

          if (!refined.canAutoFix) {
            return {
              currentState: refined.currentState,
              proposedState: {},
              description: refined.description,
              risk: refined.risk,
              apiCalls: [],
              guidedOnly: true,
              guidedSteps: refined.guidedSteps ?? [
                refined.reason ?? refined.description,
              ],
              rollbackSupported: false,
              requiresAcknowledgment: undefined,
            };
          }

          // Never cache an unusable (empty / non-auto-fixable) plan — caching
          // one turns "Retry" into a no-op that reloads the same dead plan.
          if (this.isUsablePlan(refined)) {
            this.evictStalePlans();
            this.planCache.set(
              `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`,
              {
                plan: refined,
                timestamp: Date.now(),
              },
            );
          }

          return this.buildPreviewResponse(refined);
        } catch {
          // Fall through to show initial plan
        }
      }
    }

    // Fallback: show initial AI plan without real data. Only cache it when
    // usable — caching an empty/non-auto-fixable plan makes Retry a no-op.
    if (this.isUsablePlan(plan)) {
      this.evictStalePlans();
      this.planCache.set(
        `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`,
        {
          plan,
          timestamp: Date.now(),
        },
      );
    }
    return this.buildPreviewResponse(plan);
  }

  async executeRemediation(params: {
    connectionId: string;
    organizationId: string;
    checkResultId: string;
    remediationKey: string;
    userId: string;
    acknowledgment?: string;
  }) {
    const { finding, accessToken } = await this.resolveContext(params);

    // Get plan from cache or regenerate. Only reuse a fresh AND usable plan —
    // reusing a stale empty / non-auto-fixable plan is what makes "Retry" a
    // no-op (execute reloads the same dead plan and fails identically).
    let plan: GcpFixPlan;
    const cacheKey = `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`;
    const cached = this.planCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.timestamp < this.PLAN_CACHE_TTL &&
      this.isUsablePlan(cached.plan)
    ) {
      plan = cached.plan;
    } else {
      this.planCache.delete(cacheKey);
      const evidence = (finding.evidence ?? {}) as Record<string, unknown>;
      plan = await this.aiRemediationService.generateGcpFixPlan({
        title: finding.title ?? 'Unknown',
        description: finding.description,
        severity: finding.severity,
        resourceType: finding.resourceType,
        resourceId: finding.resourceId,
        remediation: finding.remediation,
        findingKey: evidence.findingKey as string,
        evidence,
      });
    }

    if (!plan.canAutoFix) {
      throw new Error(
        'This finding requires manual remediation and cannot be auto-fixed.',
      );
    }
    if (!plan.fixSteps || plan.fixSteps.length === 0) {
      throw new Error('AI generated an empty fix plan. Cannot proceed.');
    }
    if (!params.acknowledgment || params.acknowledgment !== 'acknowledged') {
      throw new Error(
        'Acknowledgment is required before executing any remediation.',
      );
    }

    // Write identity: impersonated remediator token only. Refuses when no
    // SA is bound or the class is approval-gated. The auditor token below
    // is used for reads/verification only — never for writes.
    const execution = await this.resolveExecutionIdentity({
      connectionId: params.connectionId,
      organizationId: params.organizationId,
      finding,
    });
    const fixIdentity = {
      saEmail: execution.saEmail,
      assetClass: execution.assetClass,
      projectId: execution.projectId,
      tokenTtlSeconds: execution.tokenTtlSeconds,
      planHash: hashGcpPlanSteps(plan.fixSteps),
    };

    const action = await db.remediationAction.create({
      data: {
        checkResultId: params.checkResultId,
        connectionId: params.connectionId,
        organizationId: params.organizationId,
        initiatedById: params.userId,
        remediationKey: params.remediationKey,
        resourceId: finding.resourceId,
        resourceType: finding.resourceType,
        previousState: {},
        appliedState: {},
        status: 'executing',
        riskLevel: plan.risk,
        acknowledgmentText: params.acknowledgment ?? null,
        acknowledgedAt: params.acknowledgment ? new Date() : null,
      },
    });

    let previousState: Record<string, unknown> = {};
    let fixResult:
      | {
          results: Array<{ step: GcpApiStep; output: unknown }>;
          error?: { stepIndex: number; step: GcpApiStep; message: string };
        }
      | undefined;

    try {
      // Phase 1: Execute read steps to get real state
      if (plan.readSteps.length > 0) {
        const readErrors = validateGcpPlanSteps(plan.readSteps);
        if (readErrors.length > 0) {
          throw new Error(`Invalid read steps: ${readErrors.join('; ')}`);
        }
        const readResult = await executeGcpPlanSteps({
          steps: plan.readSteps,
          accessToken,
        });
        previousState = readResult.results.reduce(
          (acc, r) => ({ ...acc, [r.step.purpose]: r.output }),
          {} as Record<string, unknown>,
        );
      }

      // Phase 2: Refine plan with real data
      const evidence = (finding.evidence ?? {}) as Record<string, unknown>;
      let refinedPlan = await this.aiRemediationService.refineGcpFixPlan({
        finding: {
          title: finding.title ?? 'Unknown',
          description: finding.description,
          severity: finding.severity,
          resourceType: finding.resourceType,
          resourceId: finding.resourceId,
          remediation: finding.remediation,
          findingKey: evidence.findingKey as string,
          evidence,
        },
        originalPlan: plan,
        realGcpState: previousState,
      });

      if (!refinedPlan.canAutoFix) {
        await db.remediationAction.update({
          where: { id: action.id },
          data: {
            status: 'failed',
            errorMessage: refinedPlan.reason ?? 'Cannot be auto-fixed.',
          },
        });
        return {
          actionId: action.id,
          status: 'failed' as const,
          resourceId: finding.resourceId,
          error:
            refinedPlan.reason ??
            'This finding requires manual setup before auto-fix is possible.',
          guidedSteps: refinedPlan.guidedSteps,
        };
      }

      if (!refinedPlan.fixSteps || refinedPlan.fixSteps.length === 0) {
        throw new Error('AI refined plan has no fix steps. Cannot proceed.');
      }
      let fixErrors = validateGcpPlanSteps(refinedPlan.fixSteps, {
        assetClass: execution.assetClass,
        enforceAllowlist: true,
      });
      if (fixErrors.length > 0) {
        this.logger.warn(
          `Fix plan validation failed: ${fixErrors.join('; ')} — retrying with error context`,
        );
        const retryPlan = await this.aiRemediationService.refineGcpFixPlan({
          finding: {
            title: finding.title ?? 'Unknown',
            description: finding.description,
            severity: finding.severity,
            resourceType: finding.resourceType,
            resourceId: finding.resourceId,
            remediation: finding.remediation,
            findingKey: evidence.findingKey as string,
            evidence,
          },
          originalPlan: refinedPlan,
          realGcpState: {
            ...previousState,
            _validationErrors: fixErrors,
          },
        });
        refinedPlan = retryPlan;
        fixErrors = validateGcpPlanSteps(refinedPlan.fixSteps, {
          assetClass: execution.assetClass,
          enforceAllowlist: true,
        });
        if (fixErrors.length > 0) {
          throw new Error(
            `Invalid fix steps after retry: ${fixErrors.join('; ')}`,
          );
        }
      }

      // Phase 3: Execute fix steps with self-healing retry
      // (executor auto-handles: API enablement, throttling, retries, long-running ops)
      for (const step of refinedPlan.fixSteps) {
        this.logger.log(
          `Fix step: ${step.method} ${step.url} — ${step.purpose}`,
        );
      }

      let currentPlan = refinedPlan;
      fixResult = await executeGcpPlanSteps({
        steps: currentPlan.fixSteps,
        accessToken: execution.fixToken,
        autoRollbackSteps: currentPlan.rollbackSteps,
        assetClass: execution.assetClass,
        enforceAllowlist: true,
      });

      // Self-healing: if non-permission error, regenerate plan with error context and retry
      if (fixResult.error) {
        const isPermError =
          fixResult.error.message.includes('Permission denied') ||
          fixResult.error.message.includes('PERMISSION_DENIED');

        if (!isPermError) {
          this.logger.log(
            'Non-permission error — regenerating fix plan with error context...',
          );
          const retryPlan = await this.aiRemediationService.refineGcpFixPlan({
            finding: {
              title: finding.title ?? 'Unknown',
              description: finding.description,
              severity: finding.severity,
              resourceType: finding.resourceType,
              resourceId: finding.resourceId,
              remediation: finding.remediation,
              findingKey: evidence.findingKey as string,
              evidence,
            },
            originalPlan: currentPlan,
            realGcpState: {
              ...previousState,
              _lastError: fixResult.error.message,
              _failedStep: fixResult.error.step,
            },
          });

          if (retryPlan.canAutoFix && retryPlan.fixSteps.length > 0) {
            this.logger.log(
              `Retrying with regenerated plan (${retryPlan.fixSteps.length} steps)...`,
            );
            currentPlan = retryPlan;
            fixResult = await executeGcpPlanSteps({
              steps: currentPlan.fixSteps,
              accessToken: execution.fixToken,
              autoRollbackSteps: currentPlan.rollbackSteps,
              assetClass: execution.assetClass,
              enforceAllowlist: true,
            });
          }
        }
      }

      if (fixResult.error) {
        throw new Error(fixResult.error.message);
      }

      // Log step results
      for (const r of fixResult.results) {
        this.logger.log(`Step result: ${r.step.method} ${r.step.url} → OK`);
      }

      // Phase 4: Verify — check the fix step responses for success indicators
      let verified = false;

      // Primary verification: check if the API response from the fix step
      // contains the expected changes (e.g., setIamPolicy returns the updated policy).
      // Only concrete success indicators count — a generic non-empty body
      // proves nothing, since idempotent no-ops (409 already-exists, 204,
      // empty-JSON fallbacks) all return non-empty objects. Anything without
      // a concrete indicator falls through to the re-read comparison below,
      // which reports 'unverified' instead of a false 'success'.
      for (const r of fixResult.results) {
        const output = r.output as Record<string, unknown> | undefined;
        if (!output) continue;
        // setIamPolicy returns the updated policy — check if auditConfigs present
        if (
          r.step.url.includes(':setIamPolicy') &&
          Array.isArray(output.auditConfigs) &&
          (output.auditConfigs as unknown[]).length > 0
        ) {
          verified = true;
        }
      }

      // Fallback verification: re-read and compare (for non-IAM fixes)
      if (!verified && currentPlan.readSteps.length > 0) {
        await new Promise((r) => setTimeout(r, 2000));
        const verifyResult = await executeGcpPlanSteps({
          steps: currentPlan.readSteps,
          accessToken,
        });
        const postFixState: Record<string, unknown> = {};
        for (const r of verifyResult.results) {
          postFixState[r.step.purpose] = r.output;
        }
        const stripVolatile = (obj: unknown): unknown => {
          if (!obj || typeof obj !== 'object') return obj;
          if (Array.isArray(obj)) return obj.map(stripVolatile);
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            if (k === 'etag' || k === 'updateTime' || k === 'createTime')
              continue;
            cleaned[k] = stripVolatile(v);
          }
          return cleaned;
        };
        const preStr = JSON.stringify(stripVolatile(previousState));
        const postStr = JSON.stringify(stripVolatile(postFixState));
        verified = postStr !== preStr;
        if (!verified) {
          this.logger.warn(
            `Fix executed but verification shows no state change for ${finding.resourceId}`,
          );
        }
      }

      const appliedState = {
        steps: fixResult.results.map((r) => ({
          command: `${r.step.method} ${r.step.url}`,
          purpose: r.step.purpose,
          output: r.output,
        })),
        rollbackSteps: currentPlan.rollbackSteps,
        verified,
        // The audit hash must describe the steps that actually ran
        // (post-refinement), not the cached plan they were refined from.
        fixIdentity: {
          ...fixIdentity,
          planHash: hashGcpPlanSteps(currentPlan.fixSteps),
        },
      };

      const status = verified ? 'success' : 'unverified';
      await db.remediationAction.update({
        where: { id: action.id },
        data: {
          status,
          previousState: previousState as Prisma.InputJsonValue,
          appliedState: appliedState as unknown as Prisma.InputJsonValue,
          executedAt: new Date(),
        },
      });

      this.logger.log(
        `GCP remediation executed on ${finding.resourceId} (verified: ${verified})`,
      );
      this.planCache.delete(
        `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`,
      );

      return {
        actionId: action.id,
        status: status,
        resourceId: finding.resourceId,
        previousState,
        appliedState,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Parse GCP permission errors and provide actionable fix
      const evidence = (finding.evidence ?? {}) as Record<string, unknown>;
      const projectId =
        extractGcpFindingProjectId({
          evidence,
          resourceId: finding.resourceId,
        }) || undefined;
      const permInfo = parseGcpPermissionError(errorMessage, projectId);

      let permissionError:
        { missingActions: string[]; fixScript?: string } | undefined;
      if (permInfo.isPermissionError) {
        permissionError = {
          missingActions: permInfo.missingPermissions,
          ...(permInfo.fixScript && { fixScript: permInfo.fixScript }),
        };
      }

      const hasAutoRollback = Boolean(
        fixResult?.error && fixResult.results.length > 0,
      );

      await db.remediationAction.update({
        where: { id: action.id },
        data: {
          status: 'failed',
          errorMessage,
          previousState: previousState as Prisma.InputJsonValue,
          appliedState: {
            autoRollbackAttempted: hasAutoRollback,
            failedAtStep: fixResult?.error?.stepIndex,
            completedSteps: fixResult?.results.length ?? 0,
            fixIdentity,
            ...(permissionError && {
              missingPermissions: permissionError.missingActions,
              suggestedFix: permissionError.fixScript,
            }),
          },
        },
      });

      this.logger.error(
        `GCP remediation failed: ${errorMessage}${hasAutoRollback ? ' (auto-rollback attempted)' : ''}${permInfo.isPermissionError ? ` | Missing: ${permInfo.missingPermissions.join(', ')}` : ''}`,
      );

      return {
        actionId: action.id,
        status: 'failed' as const,
        resourceId: finding.resourceId,
        error: errorMessage,
        ...(permissionError && { permissionError }),
      };
    }
  }

  async rollbackRemediation(params: {
    actionId: string;
    organizationId: string;
  }) {
    const action = await db.remediationAction.findFirst({
      where: { id: params.actionId, organizationId: params.organizationId },
    });

    if (!action) throw new Error('Remediation action not found');
    if (action.status !== 'success' && action.status !== 'unverified') {
      throw new Error(`Cannot rollback action with status "${action.status}"`);
    }

    const appliedState = action.appliedState as Record<string, unknown>;
    const rollbackSteps = (appliedState.rollbackSteps ?? []) as GcpApiStep[];

    if (rollbackSteps.length === 0) {
      throw new Error('No rollback steps available for this action');
    }

    // Rollback writes use the remediator identity too — the auditor token
    // must never execute writes, including rollbacks. Prefer the identity
    // recorded at execute time: re-resolving from the finding can lose the
    // SA when the project id came only from finding evidence (rollback
    // synthesizes no evidence), which would make a successful action
    // un-rollbackable. Actions recorded before the identity was persisted
    // fall back to re-resolution.
    const storedIdentity = appliedState.fixIdentity as {
      saEmail?: unknown;
      assetClass?: unknown;
    };
    const storedAssetClass =
      typeof storedIdentity?.assetClass === 'string' &&
      (GCP_REMEDIATION_ASSET_CLASSES as readonly string[]).includes(
        storedIdentity.assetClass,
      )
        ? (storedIdentity.assetClass as GcpRemediationAssetClass)
        : undefined;
    let execution: {
      fixToken: string;
      saEmail: string;
      assetClass: GcpRemediationAssetClass;
      tokenTtlSeconds: number;
    };
    if (
      typeof storedIdentity?.saEmail === 'string' &&
      storedIdentity.saEmail &&
      storedAssetClass
    ) {
      if (isApprovalGatedGcpAssetClass(storedAssetClass)) {
        throw new Error(
          `Class ${storedAssetClass} requires human approval — apply this fix manually in the GCP console.`,
        );
      }
      const callerToken = this.impersonationService.resolveCallerToken();
      const minted = await this.impersonationService.mintRemediatorToken({
        saEmail: storedIdentity.saEmail,
        callerToken,
      });
      execution = {
        fixToken: minted.accessToken,
        saEmail: storedIdentity.saEmail,
        assetClass: storedAssetClass,
        tokenTtlSeconds: minted.expiresInSeconds,
      };
    } else {
      const resolved = await this.resolveExecutionIdentity({
        connectionId: action.connectionId,
        organizationId: action.organizationId,
        finding: {
          resourceType: action.resourceType,
          resourceId: action.resourceId,
          evidence: {},
        },
      });
      execution = {
        fixToken: resolved.fixToken,
        saEmail: resolved.saEmail,
        assetClass: resolved.assetClass,
        tokenTtlSeconds: resolved.tokenTtlSeconds,
      };
    }
    const fixIdentity = {
      saEmail: execution.saEmail,
      assetClass: execution.assetClass,
      tokenTtlSeconds: execution.tokenTtlSeconds,
      planHash: hashGcpPlanSteps(rollbackSteps),
    };

    try {
      this.logger.log(
        `Rolling back GCP action ${action.id}: ${rollbackSteps.length} steps`,
      );
      for (const step of rollbackSteps) {
        this.logger.log(
          `Rollback step: ${step.method} ${step.url} — ${step.purpose}`,
        );
      }

      const rollbackErrors = validateGcpPlanSteps(rollbackSteps, {
        assetClass: execution.assetClass,
        enforceAllowlist: true,
        isRollback: true,
      });
      if (rollbackErrors.length > 0) {
        throw new Error(`Invalid rollback steps: ${rollbackErrors.join('; ')}`);
      }

      const result = await executeGcpPlanSteps({
        steps: rollbackSteps,
        accessToken: execution.fixToken,
        isRollback: true,
        assetClass: execution.assetClass,
        enforceAllowlist: true,
      });

      // Log each rollback step result
      for (const r of result.results) {
        this.logger.log(`Rollback result: ${r.step.method} ${r.step.url} → OK`);
      }

      if (result.error) throw new Error(result.error.message);

      await db.remediationAction.update({
        where: { id: action.id },
        data: {
          status: 'rolled_back',
          rolledBackAt: new Date(),
          appliedState: {
            ...((action.appliedState ?? {}) as Record<string, unknown>),
            fixIdentity,
          },
        },
      });

      this.logger.log(
        `GCP rollback: ${action.remediationKey} on ${action.resourceId}`,
      );

      return {
        status: 'rolled_back' as const,
        connectionId: action.connectionId,
        remediationKey: action.remediationKey,
        resourceId: action.resourceId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await db.remediationAction.update({
        where: { id: action.id },
        data: {
          status: 'rollback_failed',
          errorMessage: `Rollback failed: ${errorMessage}`,
        },
      });

      // If permission error, include actionable info
      const permInfo = parseGcpPermissionError(errorMessage);
      if (permInfo.isPermissionError) {
        throw new Error(
          JSON.stringify({
            message: 'Rollback failed: missing permissions',
            missingActions: permInfo.missingPermissions,
            script: permInfo.fixScript,
          }),
        );
      }

      throw new Error(`Rollback failed: ${errorMessage}`);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private async resolveContext(params: {
    connectionId: string;
    organizationId: string;
    checkResultId: string;
    remediationKey: string;
  }) {
    const connection = await db.integrationConnection.findFirst({
      where: {
        id: params.connectionId,
        organizationId: params.organizationId,
        status: 'active',
      },
      include: { provider: true },
    });
    if (!connection) throw new Error('Connection not found or inactive');
    if (connection.provider.slug !== 'gcp') {
      throw new Error('This service only handles GCP connections');
    }

    const finding = await db.integrationCheckResult.findFirst({
      where: {
        id: params.checkResultId,
        checkRun: { connectionId: params.connectionId },
      },
    });
    if (!finding) throw new Error('Finding not found');

    const accessToken = await this.getValidGcpToken(
      params.connectionId,
      params.organizationId,
    );

    return { finding, accessToken };
  }

  /**
   * Get a valid GCP access token, refreshing if expired.
   */
  private async getValidGcpToken(
    connectionId: string,
    organizationId: string,
  ): Promise<string> {
    const manifest = getManifest('gcp');
    const oauthConfig =
      manifest?.auth?.type === 'oauth2' ? manifest.auth.config : null;

    if (oauthConfig) {
      const oauthCreds = await this.oauthCredentialsService.getCredentials(
        'gcp',
        organizationId,
      );
      if (oauthCreds) {
        const token = await this.credentialVaultService.getValidAccessToken(
          connectionId,
          {
            tokenUrl: oauthConfig.tokenUrl,
            refreshUrl: oauthConfig.refreshUrl,
            clientId: oauthCreds.clientId,
            clientSecret: oauthCreds.clientSecret,
            clientAuthMethod: oauthConfig.clientAuthMethod,
            scope: oauthCreds.scopes.join(' '),
            tokenParams: oauthConfig.tokenParams,
          },
        );
        if (token) return token;
      }
    }

    // Fallback to raw credentials if refresh fails
    const credentials =
      await this.credentialVaultService.getDecryptedCredentials(connectionId);
    const token = credentials?.access_token as string;
    if (!token) {
      throw new Error(
        'GCP access token not found. Please reconnect the integration.',
      );
    }
    return token;
  }

  /**
   * Resolve the SoD gate for a finding without minting any token:
   * which asset class it routes to, whether a remediator SA is bound,
   * and whether the class is approval-gated. Never throws for bad
   * input — unresolvable findings degrade to guided-only downstream.
   */
  private async resolveGate(
    params: { connectionId: string; organizationId: string },
    finding: {
      resourceType: string | null;
      resourceId: string | null;
      evidence: unknown;
    },
  ) {
    const credentials =
      await this.credentialVaultService.getDecryptedCredentials(
        params.connectionId,
      );
    const evidence = (finding.evidence ?? {}) as Record<string, unknown>;
    const projectId = extractGcpFindingProjectId({
      evidence,
      resourceId: finding.resourceId,
    });
    const identity = resolveGcpRemediationIdentity({
      credentials: credentials ?? {},
      resourceType: finding.resourceType,
      projectId,
    });
    return { ...identity, projectId };
  }

  /**
   * Resolve the write identity for execute/rollback: requires a bound
   * remediator SA and a non-gated class, then mints a short-lived
   * impersonated token. The auditor token is never returned here, so
   * callers cannot accidentally write with the scan identity.
   */
  private async resolveExecutionIdentity(params: {
    connectionId: string;
    organizationId: string;
    finding: {
      resourceType: string | null;
      resourceId: string | null;
      evidence: unknown;
    };
  }): Promise<{
    fixToken: string;
    saEmail: string;
    assetClass: GcpRemediationAssetClass;
    projectId: string;
    tokenTtlSeconds: number;
  }> {
    const gate = await this.resolveGate(
      {
        connectionId: params.connectionId,
        organizationId: params.organizationId,
      },
      params.finding,
    );
    if (!gate.saEmail) {
      throw new Error(
        `No remediator SA bound for ${gate.expectedKey} — configure one in integration settings, then retry. This finding is guided-only until then.`,
      );
    }
    if (gate.approvalGated) {
      throw new Error(
        `Class ${gate.assetClass} requires human approval — apply this fix manually in the GCP console.`,
      );
    }
    const callerToken = this.impersonationService.resolveCallerToken();
    const minted = await this.impersonationService.mintRemediatorToken({
      saEmail: gate.saEmail,
      callerToken,
    });
    return {
      fixToken: minted.accessToken,
      saEmail: gate.saEmail,
      assetClass: gate.assetClass,
      projectId: gate.projectId,
      tokenTtlSeconds: minted.expiresInSeconds,
    };
  }

  private buildPreviewResponse(plan: GcpFixPlan) {
    const apiCalls = plan.fixSteps.map((s) => {
      try {
        return `${s.method} ${new URL(s.url).pathname}`;
      } catch {
        return `${s.method} ${s.url}`;
      }
    });

    return {
      currentState: plan.currentState,
      proposedState: plan.proposedState,
      description: plan.description,
      risk: plan.risk,
      apiCalls,
      guidedOnly: false,
      rollbackSupported: plan.rollbackSupported,
      requiresAcknowledgment: 'checkbox' as const,
      acknowledgmentMessage:
        'This fix will modify your GCP infrastructure. Please review the changes above before proceeding.',
    };
  }
}
