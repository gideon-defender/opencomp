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
import { executeGcpPlanSteps } from './gcp-command-executor';
import { validateGcpPlanSteps } from './gcp-plan-step-validation';
import { validateGcpRollbackSteps } from './gcp-remediation-rollback-validators';
import {
  extractGcpFindingBucket,
  isSetIamPolicyUrl,
} from './gcp-remediation-validator-shared';
import {
  buildEffectiveGcpStepUrl,
  stepQueryIdentity,
} from './gcp-remediation-step-url';
import { buildPriorStateMap } from './gcp-remediation-prior-state';
import {
  appliedFixStepsForOverlap,
  assertAcknowledgedPlanHash,
  asStringRecord,
  extractGcpFindingProjectId,
  hashGcpPlanSteps,
  redactGcpUrlForLog,
  sanitizeGcpPurposeForLog,
} from './gcp-remediation-plan.utils';
import {
  buildPreviewResponse,
  guidedOnlyForInvalidPlan,
  validateFixPlan,
  validatedRollbackSteps,
} from './gcp-remediation-plan-guards';
import type { GcpFixPlan, GcpApiStep } from './gcp-ai-remediation.prompt';
import type { PlanHashBinding } from './remediation-stable-json';

export {
  appliedFixStepsForOverlap,
  extractGcpFindingProjectId,
  hashGcpPlanSteps,
};

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

  /**
   * Cache key scoped to the organization: connection IDs are UUIDs, but
   * scoping the key keeps one org's previewed plan from ever executing in
   * another org's context, even if IDs collide across tenants.
   */
  private planCacheKey(params: {
    organizationId: string;
    connectionId: string;
    checkResultId: string;
    remediationKey: string;
  }): string {
    return `${params.organizationId}:${params.connectionId}:${params.checkResultId}:${params.remediationKey}`;
  }

  /**
   * Finding scope for the acknowledgment hash. Preview and execute hash
   * the same binding, so a hash previewed for one finding never
   * authorizes a run for another.
   */
  private planBinding(params: {
    organizationId: string;
    connectionId: string;
    checkResultId: string;
    remediationKey: string;
  }): PlanHashBinding {
    return {
      organizationId: params.organizationId,
      connectionId: params.connectionId,
      checkResultId: params.checkResultId,
      remediationKey: params.remediationKey,
    };
  }

  private evictStalePlans() {
    // Always sweep expired entries first — gating the sweep on size lets
    // stale plans sit until the cache fills. Then trim oldest-first when
    // still over capacity (Map iterates in insertion order).
    const now = Date.now();
    for (const [key, entry] of this.planCache) {
      if (now - entry.timestamp > this.PLAN_CACHE_TTL)
        this.planCache.delete(key);
    }
    while (this.planCache.size >= this.PLAN_CACHE_MAX) {
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

    const plan = await this.aiRemediationService.generateGcpFixPlan(
      {
        title: finding.title ?? 'Unknown',
        description: finding.description,
        severity: finding.severity,
        resourceType: finding.resourceType,
        resourceId: finding.resourceId,
        remediation: finding.remediation,
        findingKey,
        evidence,
      },
      { assetClass: gate.assetClass },
    );

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

    // Execute read steps to get real GCP state. Reads validate as reads:
    // read-only shapes against the read-host allowlist, so a write smuggled
    // into `readSteps` never executes outside the allowlist and gates.
    if (plan.readSteps.length > 0) {
      const readErrors = validateGcpPlanSteps(plan.readSteps, {
        isRead: true,
        ...(gate.projectId ? { expectedProjectId: gate.projectId } : {}),
        ...(gate.bucket ? { expectedBucket: gate.bucket } : {}),
      });
      if (readErrors.length === 0) {
        try {
          const readResult = await executeGcpPlanSteps({
            steps: plan.readSteps,
            accessToken,
            isRead: true,
            ...(gate.projectId ? { expectedProjectId: gate.projectId } : {}),
            ...(gate.bucket ? { expectedBucket: gate.bucket } : {}),
          });
          // A partial read grounds the plan on incomplete data — fail into
          // the ungrounded fallback below instead of refining against it.
          if (readResult.error) {
            throw new Error(
              `GCP preview reads failed: ${readResult.error.message}`,
            );
          }
          const realState = buildPriorStateMap(readResult.results);

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
            assetClass: gate.assetClass,
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

          // Fail fast: a plan the executor would refuse must never reach
          // the fix button — and must never be cached. Validate the fix
          // steps (allowlist + parameter shapes) against the live state.
          const refinedErrors = validateFixPlan(refined, {
            assetClass: gate.assetClass,
            realState,
            readSteps: plan.readSteps,
            expectedProjectId: gate.projectId,
            expectedBucket: gate.bucket,
          });
          if (refinedErrors.length > 0) {
            return guidedOnlyForInvalidPlan(refined, refinedErrors);
          }

          // Normalize the cached rollback to the validated set: the
          // preview hash covers validated rollback steps, so the cached
          // plan must carry exactly that set — otherwise execute would
          // refuse its own preview on the first hash check.
          refined.rollbackSteps = validatedRollbackSteps({
            plan: refined,
            previousState: realState,
            assetClass: gate.assetClass,
            ...(plan.readSteps ? { readSteps: plan.readSteps } : {}),
            ...(gate.projectId ? { expectedProjectId: gate.projectId } : {}),
            ...(gate.bucket ? { expectedBucket: gate.bucket } : {}),
            logger: this.logger,
          }).steps;

          // Never cache an unusable (empty / non-auto-fixable) plan — caching
          // one turns "Retry" into a no-op that reloads the same dead plan.
          if (this.isUsablePlan(refined)) {
            this.evictStalePlans();
            this.planCache.set(this.planCacheKey(params), {
              plan: refined,
              timestamp: Date.now(),
            });
          }

          return buildPreviewResponse({
            plan: refined,
            binding: this.planBinding(params),
            realState,
            ...(gate.assetClass ? { assetClass: gate.assetClass } : {}),
            ...(gate.projectId ? { expectedProjectId: gate.projectId } : {}),
            ...(gate.bucket ? { expectedBucket: gate.bucket } : {}),
            stateReadSteps: plan.readSteps,
            logger: this.logger,
          });
        } catch (error) {
          // Read or refine failed: fall through to the ungrounded initial
          // plan below, which the fail-closed validators push to
          // guided-only when it needs live state to prove safety.
          this.logger.warn(
            `GCP preview read/refine failed for ${finding.resourceId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    // Fallback: show initial AI plan without real data. Only cache it when
    // usable — caching an empty/non-auto-fixable plan makes Retry a no-op.
    // Without read state the parameter validators fail closed, so a plan
    // that needs live state to prove safety degrades to guided-only here
    // and can still succeed on Retry once reads complete.
    const fallbackErrors = validateFixPlan(plan, {
      assetClass: gate.assetClass,
      expectedProjectId: gate.projectId,
      expectedBucket: gate.bucket,
    });
    if (fallbackErrors.length > 0) {
      return guidedOnlyForInvalidPlan(plan, fallbackErrors);
    }
    // Normalize the cached rollback to the validated set — see the
    // refined path above: the preview hash covers validated rollback.
    plan.rollbackSteps = validatedRollbackSteps({
      plan,
      assetClass: gate.assetClass,
      ...(plan.readSteps ? { readSteps: plan.readSteps } : {}),
      ...(gate.projectId ? { expectedProjectId: gate.projectId } : {}),
      ...(gate.bucket ? { expectedBucket: gate.bucket } : {}),
      logger: this.logger,
    }).steps;
    if (this.isUsablePlan(plan)) {
      this.evictStalePlans();
      this.planCache.set(this.planCacheKey(params), {
        plan,
        timestamp: Date.now(),
      });
    }
    return buildPreviewResponse({
      plan,
      binding: this.planBinding(params),
      ...(gate.assetClass ? { assetClass: gate.assetClass } : {}),
      ...(gate.projectId ? { expectedProjectId: gate.projectId } : {}),
      ...(gate.bucket ? { expectedBucket: gate.bucket } : {}),
      stateReadSteps: plan.readSteps,
      logger: this.logger,
    });
  }

  async executeRemediation(params: {
    connectionId: string;
    organizationId: string;
    checkResultId: string;
    remediationKey: string;
    userId: string;
    acknowledgment?: string;
    /**
     * Hash of the previewed plan the user acknowledged (`planHash` from the
     * preview response). When provided, execute refuses when the plan about
     * to run differs — a cache miss or regeneration must never run
     * unacknowledged steps under an old acknowledgment.
     */
    expectedPlanHash?: string;
  }) {
    const { finding, accessToken } = await this.resolveContext(params);

    // Asset class for prompt threading only — identity refusal still
    // happens in resolveExecutionIdentity below (fail closed, unchanged).
    const gate = await this.resolveGate(
      {
        connectionId: params.connectionId,
        organizationId: params.organizationId,
      },
      finding,
    );

    // Get plan from cache or regenerate. Only reuse a fresh AND usable plan —
    // reusing a stale empty / non-auto-fixable plan is what makes "Retry" a
    // no-op (execute reloads the same dead plan and fails identically).
    // The cache is per-process: a miss on this instance regenerates instead
    // of reusing another instance's plan, and `expectedPlanHash` binds the
    // run to what the user actually previewed.
    let plan: GcpFixPlan;
    const cacheKey = this.planCacheKey(params);
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
      plan = await this.aiRemediationService.generateGcpFixPlan(
        {
          title: finding.title ?? 'Unknown',
          description: finding.description,
          severity: finding.severity,
          resourceType: finding.resourceType,
          resourceId: finding.resourceId,
          remediation: finding.remediation,
          findingKey: evidence.findingKey as string,
          evidence,
        },
        { assetClass: gate.assetClass },
      );
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
    // The acknowledgment binds to one exact preview: without its hash
    // there is nothing to compare the executed steps against, so a
    // regenerated plan would run under a stale acknowledgment. An empty
    // string reads as absent here — it must never silently disable the
    // binding the way a wrong hash refuses loudly.
    if (!params.expectedPlanHash) {
      throw new Error(
        'Execute requires the previewed plan hash (expectedPlanHash from the preview response). Preview again and acknowledge the new plan before executing.',
      );
    }
    // The acknowledgment binds after Phase 1 reads below: the preview
    // hash covers fix steps plus the state-validated rollback, so the
    // check must run against the same live state (see the check after
    // reads). No write executes before it verifies.

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
      planHash: hashGcpPlanSteps(
        plan.fixSteps,
        plan.rollbackSteps ?? [],
        this.planBinding(params),
      ),
    };

    // Created after the acknowledgment check below: a refused run must
    // reject without leaving an 'executing' row behind. The catch block
    // rethrows while `action` is still unset (see the guard there).
    let action: { id: string } | undefined;

    let previousState: Record<string, unknown> = {};
    // Typed off the executor's return: re-declaring the step shape here
    // drifts (e.g. queryParams widened to unknown in the shared type).
    let fixResult: Awaited<ReturnType<typeof executeGcpPlanSteps>> | undefined;

    try {
      // Phase 1: Execute read steps to get real state
      if (plan.readSteps.length > 0) {
        const readErrors = validateGcpPlanSteps(plan.readSteps, {
          isRead: true,
          ...(gate.projectId ? { expectedProjectId: gate.projectId } : {}),
          ...(gate.bucket ? { expectedBucket: gate.bucket } : {}),
        });
        if (readErrors.length > 0) {
          throw new Error(`Invalid read steps: ${readErrors.join('; ')}`);
        }
        const readResult = await executeGcpPlanSteps({
          steps: plan.readSteps,
          accessToken,
          isRead: true,
          ...(gate.projectId ? { expectedProjectId: gate.projectId } : {}),
          ...(gate.bucket ? { expectedBucket: gate.bucket } : {}),
        });
        // A partial read would ground refinement and rollback binding on
        // incomplete data — fail the run instead of fixing blind.
        if (readResult.error) {
          throw new Error(
            `GCP pre-fix reads failed: ${readResult.error.message}`,
          );
        }
        previousState = buildPriorStateMap(readResult.results);
      }

      // Bind the acknowledgment to the preview: the preview hash covers
      // fix steps plus the state-validated rollback, so validate against
      // this run's live state before hashing — the same inputs preview
      // used. Validating the raw rollback (or hashing fix steps alone)
      // would refuse plans whose net legitimately trims to nothing, or
      // every plan with a safety net. Reads above run with the auditor
      // token pre-acknowledgment (as in preview) — no write executes
      // before this binding verifies.
      const preRefineRollback = validatedRollbackSteps({
        plan,
        previousState,
        assetClass: execution.assetClass,
        readSteps: plan.readSteps,
        expectedProjectId: execution.projectId,
        expectedBucket: execution.bucket,
        logger: this.logger,
      });
      assertAcknowledgedPlanHash({
        expectedPlanHash: params.expectedPlanHash,
        binding: this.planBinding(params),
        fixSteps: plan.fixSteps,
        rollbackSteps: preRefineRollback.steps,
      });

      action = await db.remediationAction.create({
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
        assetClass: gate.assetClass,
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
      // Allowlist + parameter shapes, checked against the live read state.
      let fixErrors = validateFixPlan(refinedPlan, {
        assetClass: execution.assetClass,
        realState: previousState,
        readSteps: plan.readSteps,
        expectedProjectId: gate.projectId,
        expectedBucket: gate.bucket,
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
          assetClass: gate.assetClass,
        });
        refinedPlan = retryPlan;
        fixErrors = validateFixPlan(refinedPlan, {
          assetClass: execution.assetClass,
          realState: previousState,
          readSteps: plan.readSteps,
          expectedProjectId: gate.projectId,
          expectedBucket: gate.bucket,
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
        // Redact query strings: AI-controlled URLs can carry credentials.
        this.logger.log(
          `Fix step: ${step.method} ${redactGcpUrlForLog(step.url)} — ${sanitizeGcpPurposeForLog(step.purpose)}`,
        );
      }

      let currentPlan = refinedPlan;
      // A dropped rollback must stay visible: the executor reads an empty
      // array as "no safety net" and proceeds, so the downgrade rides in
      // the audit trail and the response instead of only the log.
      let rollbackDroppedReason: string | undefined;
      const rollbackValidation = validatedRollbackSteps({
        plan: currentPlan,
        previousState,
        assetClass: execution.assetClass,
        readSteps: plan.readSteps,
        expectedProjectId: execution.projectId,
        expectedBucket: execution.bucket,
        logger: this.logger,
      });
      currentPlan.rollbackSteps = rollbackValidation.steps;
      rollbackDroppedReason = rollbackValidation.droppedReason;
      // Keep the audit identity on the steps that actually run: refinement
      // above rewrote the fix, so the pre-refinement hash no longer
      // describes the execution. The success path and the failure path
      // below both record this same object.
      fixIdentity.planHash = hashGcpPlanSteps(
        currentPlan.fixSteps,
        currentPlan.rollbackSteps ?? [],
        this.planBinding(params),
      );
      // The acknowledged hash must cover the steps that actually run:
      // refinement above rewrote the fix, and validation just settled
      // the rollback set — both execute as writes under one
      // acknowledgment, so both verify here.
      assertAcknowledgedPlanHash({
        expectedPlanHash: params.expectedPlanHash,
        binding: this.planBinding(params),
        fixSteps: currentPlan.fixSteps,
        ...(currentPlan.rollbackSteps
          ? { rollbackSteps: currentPlan.rollbackSteps }
          : {}),
      });
      fixResult = await executeGcpPlanSteps({
        steps: currentPlan.fixSteps,
        accessToken: execution.fixToken,
        autoRollbackSteps: currentPlan.rollbackSteps,
        assetClass: execution.assetClass,
        enforceAllowlist: true,
        expectedProjectId: execution.projectId,
        expectedBucket: execution.bucket,
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
            assetClass: gate.assetClass,
          });

          if (retryPlan.canAutoFix && retryPlan.fixSteps.length > 0) {
            this.logger.log(
              `Retrying with regenerated plan (${retryPlan.fixSteps.length} steps)...`,
            );
            // A regenerated plan is new attacker-influenced input: it must
            // clear the same allowlist + parameter gates as the first plan.
            const retryErrors = validateFixPlan(retryPlan, {
              assetClass: execution.assetClass,
              realState: previousState,
              readSteps: plan.readSteps,
              expectedProjectId: gate.projectId,
              expectedBucket: gate.bucket,
            });
            if (retryErrors.length > 0) {
              throw new Error(
                `Invalid regenerated fix steps: ${retryErrors.join('; ')}`,
              );
            }
            // Pin the recovery to the acknowledged targets: regeneration
            // runs on attacker-influenced input (the failure output), so a
            // retry that names new methods, URLs, or step counts would
            // execute outside the acknowledged plan. Bodies and params may
            // change (that is the repair); the targets may not.
            // Compare effective URLs — the exact strings the executor
            // fetches — so a target hiding in `queryParams` cannot dodge
            // the pin.
            const verifiedTargets = currentPlan.fixSteps.map(
              (s) => `${s.method} ${buildEffectiveGcpStepUrl(s)}`,
            );
            const retryTargets = retryPlan.fixSteps.map(
              (s) => `${s.method} ${buildEffectiveGcpStepUrl(s)}`,
            );
            if (
              retryTargets.length !== verifiedTargets.length ||
              retryTargets.some((target, i) => target !== verifiedTargets[i])
            ) {
              throw new Error(
                'The regenerated recovery plan changes the acknowledged targets. Preview again and acknowledge the new plan before executing.',
              );
            }
            currentPlan = retryPlan;
            const retryRollback = validatedRollbackSteps({
              plan: currentPlan,
              previousState,
              assetClass: execution.assetClass,
              readSteps: plan.readSteps,
              expectedProjectId: execution.projectId,
              expectedBucket: execution.bucket,
              logger: this.logger,
            });
            currentPlan.rollbackSteps = retryRollback.steps;
            rollbackDroppedReason = retryRollback.droppedReason;
            // Regeneration rewrote the steps again — rebind the audit
            // identity so a later failure records the retried plan.
            fixIdentity.planHash = hashGcpPlanSteps(
              currentPlan.fixSteps,
              currentPlan.rollbackSteps ?? [],
              this.planBinding(params),
            );
            // A regenerated plan whose hash differs from the acknowledged
            // hash carries params the acknowledgment never covered.
            // Targets stay pinned and gates re-ran above, but params are
            // what the user reviewed — refuse instead of executing
            // unacknowledged params under an old acknowledgment.
            // `expectedPlanHash` is required by execute (see the check
            // above), so a mismatch here always throws.
            if (fixIdentity.planHash !== params.expectedPlanHash) {
              throw new Error(
                'The regenerated recovery plan differs from the acknowledged plan. Preview again and acknowledge the new plan before executing.',
              );
            }
            fixResult = await executeGcpPlanSteps({
              steps: currentPlan.fixSteps,
              accessToken: execution.fixToken,
              autoRollbackSteps: currentPlan.rollbackSteps,
              assetClass: execution.assetClass,
              enforceAllowlist: true,
              expectedProjectId: execution.projectId,
              expectedBucket: execution.bucket,
            });
          }
        }
      }

      if (fixResult.error) {
        throw new Error(fixResult.error.message);
      }

      // Log step results
      for (const r of fixResult.results) {
        this.logger.log(
          `Step result: ${r.step.method} ${redactGcpUrlForLog(r.step.url)} → OK`,
        );
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
        // setIamPolicy returns the updated policy — check if auditConfigs present.
        // Match on the decoded pathname (same string the guards see).
        if (
          isSetIamPolicyUrl(r.step.url) &&
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
          isRead: true,
          ...(gate.projectId ? { expectedProjectId: gate.projectId } : {}),
          ...(gate.bucket ? { expectedBucket: gate.bucket } : {}),
        });
        // A failed re-read proves nothing — an empty post-state would
        // differ from pre-state and report a false success. Stay unverified.
        if (verifyResult.error) {
          this.logger.warn(
            `Fix verification re-read failed for ${finding.resourceId}: ${verifyResult.error.message}`,
          );
        } else {
          // Duplicate purposes fail here instead of merging: the pre-fix
          // state keyed the same way, so a merge would compare mismatched
          // resources and report a false success.
          const postFixState = buildPriorStateMap(verifyResult.results);
          // Compare only purposes present in BOTH states: refinement can
          // rename purposes or swap read steps between the pre-fix read and
          // this re-read, and differing key sets always differ as JSON —
          // reporting a false success for a no-op fix. With no overlapping
          // purpose there is nothing comparable: stay unverified.
          const commonPurposes = Object.keys(previousState).filter((purpose) =>
            Object.prototype.hasOwnProperty.call(postFixState, purpose),
          );
          if (commonPurposes.length === 0) {
            this.logger.warn(
              `Fix verification has no overlapping read purposes for ${finding.resourceId} — staying unverified`,
            );
          } else {
            const stripVolatile = (obj: unknown): unknown => {
              if (!obj || typeof obj !== 'object') return obj;
              if (Array.isArray(obj)) return obj.map(stripVolatile);
              const cleaned: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(
                obj as Record<string, unknown>,
              )) {
                if (k === 'etag' || k === 'updateTime' || k === 'createTime')
                  continue;
                cleaned[k] = stripVolatile(v);
              }
              return cleaned;
            };
            const pick = (
              state: Record<string, unknown>,
            ): Record<string, unknown> =>
              Object.fromEntries(
                commonPurposes.map((purpose) => [purpose, state[purpose]]),
              );
            const preStr = JSON.stringify(stripVolatile(pick(previousState)));
            const postStr = JSON.stringify(stripVolatile(pick(postFixState)));
            verified = postStr !== preStr;
            if (!verified) {
              this.logger.warn(
                `Fix executed but verification shows no state change for ${finding.resourceId}`,
              );
            }
          }
        }
      }

      const appliedState = {
        steps: fixResult.results.map((r) => {
          // Redacted (no query/fragment): raw URLs can carry credentials
          // into the audit row. Query identity (`?name=` selects the
          // resource on several GCP APIs) persists separately — overlap
          // compares it, and names are identity, not credentials.
          const queryIdentity = stepQueryIdentity({
            url: r.step.url,
            ...(r.step.queryParams ? { queryParams: r.step.queryParams } : {}),
          });
          return {
            command: `${r.step.method} ${redactGcpUrlForLog(r.step.url)}`,
            purpose: r.step.purpose,
            output: r.output,
            ...(queryIdentity && queryIdentity.length > 0
              ? { queryIdentity }
              : {}),
          };
        }),
        rollbackSteps: currentPlan.rollbackSteps,
        // A dropped safety net must stay visible in the audit row: without
        // this, a later manual rollback reports bare "no steps" and the
        // caller never learns the compensation was found unreviewable.
        ...(rollbackDroppedReason ? { rollbackDroppedReason } : {}),
        // Persist the read steps that produced `previousState` so manual
        // rollback can bind prior policies to the same purposes instead of
        // falling back to ambiguous global matching.
        readSteps: currentPlan.readSteps,
        verified,
        // The audit hash describes the steps that actually ran: it was
        // rebound at every point the plan settled (refinement, recovery),
        // so success and failure rows carry the same executed identity.
        fixIdentity,
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
      this.planCache.delete(this.planCacheKey(params));

      return {
        actionId: action.id,
        status: status,
        resourceId: finding.resourceId,
        previousState,
        appliedState,
        ...(rollbackDroppedReason ? { rollbackDroppedReason } : {}),
      };
    } catch (error) {
      // Reads or the acknowledgment check can fail before the action row
      // exists — there is nothing to mark failed, so reject loudly instead
      // of masking the cause with a crash on an unset action.
      if (!action) throw error;
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
      // Name the downgrade when execute recorded one: bare "no steps"
      // hides that a compensation existed but was found unreviewable.
      const dropped =
        typeof appliedState.rollbackDroppedReason === 'string' &&
        appliedState.rollbackDroppedReason
          ? ` (auto-rollback was dropped at execute time: ${appliedState.rollbackDroppedReason})`
          : '';
      throw new Error(`No rollback steps available for this action${dropped}`);
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
      projectId?: unknown;
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
      projectId: string;
      bucket: string | undefined;
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
        // Prefer the project recorded at execute time: re-resolving can
        // lose it when it came only from finding evidence (rollback
        // synthesizes no evidence). Older actions predate the recorded
        // project — fall back to the action's resource id.
        projectId:
          typeof storedIdentity?.projectId === 'string' &&
          storedIdentity.projectId
            ? storedIdentity.projectId
            : extractGcpFindingProjectId({
                evidence: {},
                resourceId: action.resourceId,
              }),
        // The action's resource id is stable across versions: derive the
        // bucket from it rather than trusting a stored value recorded
        // before bucket binding existed.
        bucket: extractGcpFindingBucket({ resourceId: action.resourceId }),
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
        projectId: resolved.projectId,
        bucket: resolved.bucket,
        tokenTtlSeconds: resolved.tokenTtlSeconds,
      };
    }
    const fixIdentity = {
      saEmail: execution.saEmail,
      assetClass: execution.assetClass,
      tokenTtlSeconds: execution.tokenTtlSeconds,
      planHash: hashGcpPlanSteps(rollbackSteps, [], this.planBinding(action)),
    };

    try {
      this.logger.log(
        `Rolling back GCP action ${action.id}: ${rollbackSteps.length} steps`,
      );
      for (const step of rollbackSteps) {
        this.logger.log(
          `Rollback step: ${step.method} ${redactGcpUrlForLog(step.url)} — ${sanitizeGcpPurposeForLog(step.purpose)}`,
        );
      }

      const storedPreviousState = asStringRecord(action.previousState);
      const storedReadSteps = (() => {
        const state = action.appliedState as Record<string, unknown> | null;
        const steps = state?.readSteps;
        if (!Array.isArray(steps)) return undefined;
        const refs = steps.filter(
          (s): s is { purpose: string; url: string } =>
            s !== null &&
            typeof s === 'object' &&
            typeof (s as Record<string, unknown>).purpose === 'string' &&
            typeof (s as Record<string, unknown>).url === 'string',
        );
        return refs.length > 0 ? refs : undefined;
      })();
      const rollbackErrors = [
        ...validateGcpPlanSteps(rollbackSteps, {
          assetClass: execution.assetClass,
          enforceAllowlist: true,
          isRollback: true,
          ...(execution.projectId
            ? { expectedProjectId: execution.projectId }
            : {}),
          ...(execution.bucket ? { expectedBucket: execution.bucket } : {}),
        }),
        // Shape-check against the executed fix steps recorded in the
        // action's appliedState (`"METHOD url"` command strings): IAM
        // rollbacks must be verbatim, PATCH rollbacks need updateMask,
        // and every rollback target must overlap a fixed resource. Bodies
        // are compared against the stored pre-fix state when present, so
        // a well-formed but fabricated rollback cannot execute.
        ...validateGcpRollbackSteps(rollbackSteps, {
          fixSteps: appliedFixStepsForOverlap(
            (action.appliedState as Record<string, unknown> | null) ?? {},
          ),
          ...(storedPreviousState
            ? { previousState: storedPreviousState }
            : {}),
          ...(storedReadSteps ? { readSteps: storedReadSteps } : {}),
          ...(execution.projectId
            ? { expectedProjectId: execution.projectId }
            : {}),
          ...(execution.bucket ? { expectedBucket: execution.bucket } : {}),
        }),
      ];
      if (rollbackErrors.length > 0) {
        throw new Error(`Invalid rollback steps: ${rollbackErrors.join('; ')}`);
      }

      const result = await executeGcpPlanSteps({
        steps: rollbackSteps,
        accessToken: execution.fixToken,
        isRollback: true,
        assetClass: execution.assetClass,
        enforceAllowlist: true,
        ...(execution.projectId
          ? { expectedProjectId: execution.projectId }
          : {}),
        ...(execution.bucket ? { expectedBucket: execution.bucket } : {}),
      });

      // Log each rollback step result
      for (const r of result.results) {
        this.logger.log(
          `Rollback result: ${r.step.method} ${redactGcpUrlForLog(r.step.url)} → OK`,
        );
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
    return {
      ...identity,
      projectId,
      bucket: extractGcpFindingBucket({ resourceId: finding.resourceId }),
    };
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
    bucket: string | undefined;
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
      bucket: gate.bucket,
      tokenTtlSeconds: minted.expiresInSeconds,
    };
  }
}
