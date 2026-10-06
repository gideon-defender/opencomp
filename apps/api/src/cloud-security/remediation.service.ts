import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { db, Prisma } from '@db';
import {
  stableJsonStringify,
  type PlanHashBinding,
} from './remediation-stable-json';
import { CredentialVaultService } from '../integration-platform/services/credential-vault.service';
import { parseAwsPermissionError } from './remediation-error.utils';
import { AWSSecurityService } from './providers/aws-security.service';
import {
  AiRemediationService,
  type FindingContext,
} from './ai-remediation.service';
import { GcpRemediationService } from './gcp-remediation.service';
import { AzureRemediationService } from './azure-remediation.service';
import {
  executePlanSteps,
  resolveCanonicalCommandName,
  validatePlanSteps,
  validateRollbackSteps,
} from './aws-command-executor';
import {
  getAwsDefaultRegion,
  hasRemediationRole,
  normalizeAwsPartition,
} from './aws-partition.utils';
import {
  isApprovalGatedAssetClass,
  SAFE_AWS_REGION_PATTERN,
} from '@gideon-defender/integration-platform';
import {
  buildManualRemediationPreview,
  isManualRemediation,
} from './manual-remediation';
import { applyResolvedMetricFilterLogGroup } from './metric-filter-loggroup';
import type { FixPlan, AwsCommandStep } from './ai-remediation.prompt';
import {
  formatBlockedActionsForDisplay,
  splitBlockedRemediationActions,
} from './remediation-denylist';
import {
  BLOCKED_PERMISSIONS_MESSAGE,
  buildStaticPermissionScript,
} from './remediation-permission-script';
import { isPermissionCoveredBySet } from './remediation-permission-coverage';
import { readRemediatorRolePermissions } from './remediation-role-reader';
import { resolveFindingRemediationRole } from './remediation-role-resolver';

/**
 * A `rollback_in_progress` claim older than this belonged to a process that
 * died between claim and settle — reclaimable. Must comfortably exceed the
 * slowest rollback execution, but short enough that an operator retrying a
 * crashed rollback is not stuck. The claim write bumps updatedAt, so a live
 * holder always looks fresh.
 */
const ROLLBACK_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

/** True when a rollback claim timestamp is old enough to belong to a dead process. */
function isStaleRollbackClaim(updatedAt: unknown): boolean {
  if (!(updatedAt instanceof Date)) {
    return false;
  }
  return Date.now() - updatedAt.getTime() > ROLLBACK_CLAIM_TIMEOUT_MS;
}

/**
 * Stable hash of AWS plan steps for the acknowledgment binding: execute
 * refuses when the acknowledged hash no longer matches the steps about to
 * run. Covers fix steps plus rollback steps — rollback runs as real writes
 * on the failure path, so a regenerated rollback the user never previewed
 * must fail the check. Only executed fields hash — free-text `purpose`
 * rewording by refinement or repair must never read as a plan change. Key
 * order is canonicalized so regenerated plans with reordered params hash
 * alike. Mirrors `hashGcpPlanSteps` for GCP.
 *
 * The finding binding hashes with the steps: without it, a hash previewed
 * for one finding authorizes a run for another finding with identical
 * steps.
 */
export function hashAwsPlanSteps(
  fixSteps: AwsCommandStep[] | undefined,
  rollbackSteps: AwsCommandStep[] | undefined,
  binding: PlanHashBinding,
): string {
  const shape = (steps: AwsCommandStep[]) =>
    steps.map((s) => ({
      service: s.service,
      command: s.command,
      params: s.params ?? null,
    }));
  const input = stableJsonStringify({
    binding: {
      organizationId: binding.organizationId,
      connectionId: binding.connectionId,
      checkResultId: binding.checkResultId,
      remediationKey: binding.remediationKey,
    },
    fix: shape(fixSteps ?? []),
    rollback: shape(rollbackSteps ?? []),
  });
  return `aws-${createHash('sha256').update(input).digest('hex')}`;
}

const REMEDIATION_ROLE_MISSING_GUIDANCE =
  'Auto-remediation is not configured for this AWS connection. Add a per-pair remediation role in the connection settings and make sure an External ID is set (reconnect your AWS account if needed) to enable one-click fixes. Until then, follow the AWS console steps for this finding manually.';

interface ExecutePermissionError {
  missingActions: string[];
  fixScript?: string;
  blockedPermissions?: string[];
  blockedPermissionsMessage?: string;
}

@Injectable()
export class RemediationService {
  private readonly logger = new Logger(RemediationService.name);
  /** Cache fix plans between preview and execute to avoid double AI calls. */
  private readonly planCache = new Map<
    string,
    {
      plan: FixPlan;
      timestamp: number;
      permissionsList?: string[];
      blockedPermissionsList?: string[];
    }
  >();
  private readonly PLAN_CACHE_MAX = 100;
  private readonly PLAN_CACHE_TTL = 5 * 60 * 1000;

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

  /**
   * A plan is only worth caching/reusing if it can actually be auto-applied.
   * Caching an empty or non-auto-fixable plan makes "Retry" a guaranteed
   * no-op: execute would reload the same dead plan and fail identically,
   * never re-running the (non-deterministic) AI generation that might succeed.
   */
  private isUsablePlan(plan: FixPlan | undefined): boolean {
    return Boolean(
      plan?.canAutoFix && plan.fixSteps && plan.fixSteps.length > 0,
    );
  }

  private evictStalePlans() {
    // Always purge expired entries first — even below capacity, so a later
    // recheck never serves a stale plan through a lingering entry.
    const now = Date.now();
    for (const [key, entry] of this.planCache) {
      if (now - entry.timestamp > this.PLAN_CACHE_TTL)
        this.planCache.delete(key);
    }
    if (this.planCache.size <= this.PLAN_CACHE_MAX) return;
    // If still over limit, delete oldest
    while (this.planCache.size > this.PLAN_CACHE_MAX) {
      const firstKey: unknown = this.planCache.keys().next().value;
      if (typeof firstKey === 'string' && firstKey)
        this.planCache.delete(firstKey);
      else break;
    }
  }

  constructor(
    private readonly credentialVaultService: CredentialVaultService,
    private readonly awsSecurityService: AWSSecurityService,
    private readonly aiRemediationService: AiRemediationService,
    private readonly gcpRemediationService: GcpRemediationService,
    private readonly azureRemediationService: AzureRemediationService,
  ) {}

  async getCapabilities(params: {
    connectionId: string;
    organizationId: string;
  }) {
    const connection = await this.getConnection(params);

    if (connection.provider.slug === 'gcp') {
      return this.gcpRemediationService.getCapabilities(params);
    }

    if (connection.provider.slug === 'azure') {
      return this.azureRemediationService.getCapabilities(params);
    }

    if (connection.provider.slug !== 'aws') {
      return { enabled: false, remediations: [] };
    }

    const credentials =
      await this.credentialVaultService.getDecryptedCredentials(
        params.connectionId,
      );

    return {
      // Same trim-aware gate as the preview/execute/rollback paths — a
      // whitespace-only ARN must not report as enabled.
      enabled: Boolean(credentials && hasRemediationRole(credentials)),
      aiPowered: true,
      remediations: [],
    };
  }

  async previewRemediation(params: {
    connectionId: string;
    organizationId: string;
    checkResultId: string;
    remediationKey: string;
    cachedPermissions?: string[];
  }) {
    // Delegate GCP/Azure to dedicated services
    const connection = await this.getConnection(params);
    if (connection.provider.slug === 'gcp') {
      return this.gcpRemediationService.previewRemediation(params);
    }
    if (connection.provider.slug === 'azure') {
      return this.azureRemediationService.previewRemediation(params);
    }
    if (connection.provider.slug !== 'aws') {
      throw new Error('Remediation is only supported for AWS');
    }

    const finding = await this.getFinding(params);
    if (isManualRemediation(finding.remediation)) {
      return buildManualRemediationPreview({
        remediation: finding.remediation ?? '',
        description: finding.description,
        severity: finding.severity,
      });
    }

    const { credentials, region } = await this.resolveAwsExecutionContext({
      connectionId: params.connectionId,
      finding,
    });

    // Fail closed: no remediation role + External ID means no write path.
    // The auditor credentials are read-only and must never be used for
    // writes.
    if (!hasRemediationRole(credentials)) {
      return buildManualRemediationPreview({
        remediation: `[MANUAL] ${REMEDIATION_ROLE_MISSING_GUIDANCE}`,
        description: finding.description,
        severity: finding.severity,
      });
    }

    const evidence = (finding.evidence ?? {}) as Record<string, unknown>;
    const findingKey = evidence.findingKey as string;

    // RECHECK MODE: if frontend sends cachedPermissions, skip AI entirely
    // Just re-read the role and compare against the SAME list
    if (params.cachedPermissions && params.cachedPermissions.length > 0) {
      this.logger.log(
        `Recheck mode: checking ${params.cachedPermissions.length} cached permissions: ${params.cachedPermissions.slice(0, 5).join(', ')}...`,
      );
      // Prefer the backend-computed list when the cached plan is still fresh
      // and usable — the frontend list is a fallback for restarted servers,
      // and either way denylisted actions are split out below so they never
      // surface as ordinary missing permissions.
      // Return cached plan data with updated permission status
      const cached = this.planCache.get(
        `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`,
      );
      const freshCached =
        cached &&
        Date.now() - cached.timestamp < this.PLAN_CACHE_TTL &&
        this.isUsablePlan(cached.plan)
          ? cached
          : undefined;
      // Display list may fall back to the client copy, but a grant script
      // is only minted from the backend-computed list. On a cache miss
      // (restart/expired) the client list is untrusted display-only input —
      // minting a put-role-policy script from it lets any caller turn an
      // arbitrary valid token into a runnable grant.
      const { allowed: checkablePermissions, blocked: splitBlocked } =
        splitBlockedRemediationActions(
          freshCached?.permissionsList ?? params.cachedPermissions,
        );
      const scriptSource = freshCached?.permissionsList;
      // The cached list is already grantable-only, so re-splitting it finds
      // nothing — union the blocked list stored at preview time so the
      // manual-review warning survives a fresh-cache recheck.
      const cachedBlocked = [
        ...new Set([
          ...(freshCached?.blockedPermissionsList ?? []),
          ...splitBlocked,
        ]),
      ];
      const {
        assetClass: recheckAssetClass,
        roleArn: pairRoleArn,
        roleName: pairRoleName,
        expectedRoleName: pairExpectedRoleName,
      } = resolveFindingRemediationRole({
        credentials,
        resourceType: finding.resourceType,
        region,
      });
      if (isApprovalGatedAssetClass(recheckAssetClass)) {
        // Network / Security-Global never auto-fix: adding the pair role
        // would not enable one-click fixes, so the missing-role guidance
        // below would send users down a dead end. Gate first.
        return buildManualRemediationPreview({
          remediation: `[MANUAL] Findings in the ${recheckAssetClass} asset class require human approval and cannot be auto-fixed, even with the ${pairExpectedRoleName} role configured. Follow the AWS console steps for this finding manually.`,
          description: finding.description,
          severity: finding.severity,
        });
      }
      if (!pairRoleArn || !pairRoleName) {
        // Same situation as the full-preview path below: no pair role for
        // this finding means guided-only manual steps, not a 500. A fresh
        // preview degrades gracefully, so recheck must too.
        return buildManualRemediationPreview({
          remediation: `[MANUAL] No remediation role is configured for this finding's asset class and region. Add the ${pairExpectedRoleName} role to the connection settings to enable one-click fixes. Until then, follow the AWS console steps for this finding manually.`,
          description: finding.description,
          severity: finding.severity,
        });
      }
      const remediationCreds =
        await this.awsSecurityService.assumeRemediationRole(
          credentials,
          region,
          { findingId: params.checkResultId },
          pairRoleArn,
        );
      let missingPermissions: string[] | undefined;
      let permissionFixScript: string | undefined;
      try {
        const { allowed: existingActions, denied: deniedActions } =
          await readRemediatorRolePermissions({
            credentials: remediationCreds,
            region,
            roleName: pairRoleName,
            onWarn: (message) => this.logger.warn(message),
            onInfo: (message) => this.logger.log(message),
          });
        this.logger.log(`Role has ${existingActions.size} actions`);
        const missing = checkablePermissions.filter(
          (p) => !isPermissionCoveredBySet(p, existingActions, deniedActions),
        );
        if (missing.length > 0) {
          missingPermissions = missing;
          // Always include ALL cached permissions in script — not just missing ones
          // This prevents overwrite issues with IAM eventual consistency.
          // No script without a fresh backend plan: the caller must run a
          // full preview first so the grant derives from server state.
          // Target the routed pair role — the default would mint a grant
          // for the monolith while execution assumes the pair role.
          permissionFixScript = scriptSource
            ? buildStaticPermissionScript(scriptSource, pairRoleName)
            : undefined;
        }
      } catch (err) {
        this.logger.warn(
          `Cannot read role policies on recheck: ${err instanceof Error ? err.message : String(err)}`,
        );
        missingPermissions = checkablePermissions;
        permissionFixScript = scriptSource
          ? buildStaticPermissionScript(scriptSource, pairRoleName)
          : undefined;
      }

      const cachedPlan = freshCached?.plan;
      // Recheck shows the cached plan with fresh permission status — bind
      // execute to the same steps, or Apply after a recheck always refuses
      // on the missing hash. Omitted on a cache miss: with no cached plan
      // there is nothing to bind to and execute must fail closed.
      const recheckPlanHash = cachedPlan
        ? hashAwsPlanSteps(
            cachedPlan.fixSteps,
            cachedPlan.rollbackSteps,
            this.planBinding(params),
          )
        : undefined;

      return {
        currentState: cachedPlan?.currentState ?? {},
        proposedState: cachedPlan?.proposedState ?? {},
        description: cachedPlan?.description ?? 'Recheck permissions',
        risk: cachedPlan?.risk ?? 'medium',
        apiCalls: cachedPlan?.requiredPermissions ?? params.cachedPermissions,
        guidedOnly: false,
        rollbackSupported: cachedPlan?.rollbackSupported ?? true,
        requiresAcknowledgment: 'checkbox' as const,
        acknowledgmentMessage:
          'This fix will modify your AWS infrastructure. Please review the changes above before proceeding.',
        allRequiredPermissions: checkablePermissions,
        ...(recheckPlanHash ? { planHash: recheckPlanHash } : {}),
        ...(cachedBlocked.length > 0 && {
          blockedPermissions: cachedBlocked,
          blockedPermissionsMessage: BLOCKED_PERMISSIONS_MESSAGE,
        }),
        ...(missingPermissions &&
          missingPermissions.length > 0 && {
            missingPermissions,
            permissionFixScript,
            // No fresh backend plan behind this recheck — the client list
            // is display-only, so there is no safe script to offer yet.
            ...(!permissionFixScript && {
              needsFreshPreview:
                'Run a fresh preview to generate a one-click fix from current server state.',
            }),
          }),
      };
    }

    const plan = await this.aiRemediationService.generateFixPlan({
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

    // Resolve the per-pair role once — the read-step assume, the policy
    // read, and any permission-fix script below must all target the same
    // role the finding routes to (map first, legacy fallback).
    const {
      assetClass: previewAssetClass,
      roleArn: pairRoleArn,
      roleName: pairRoleName,
      expectedRoleName: pairExpectedRoleName,
    } = resolveFindingRemediationRole({
      credentials,
      resourceType: finding.resourceType,
      region,
    });
    if (isApprovalGatedAssetClass(previewAssetClass)) {
      // Gate before the missing-role check for the same reason as recheck:
      // the pair role must exist for reads, but its presence never enables
      // auto-fix for these classes. Returning here also skips the read-step
      // assume below, so previewing a Security-Global finding does not page
      // the human on call.
      return buildManualRemediationPreview({
        remediation: `[MANUAL] Findings in the ${previewAssetClass} asset class require human approval and cannot be auto-fixed, even with the ${pairExpectedRoleName} role configured. Follow the AWS console steps for this finding manually.`,
        description: finding.description,
        severity: finding.severity,
      });
    }
    if (!pairRoleArn || !pairRoleName) {
      return buildManualRemediationPreview({
        remediation: `[MANUAL] No remediation role is configured for this finding's asset class and region. Add the ${pairExpectedRoleName} role to the connection settings to enable one-click fixes. Until then, follow the AWS console steps for this finding manually.`,
        description: finding.description,
        severity: finding.severity,
      });
    }

    // If plan has read steps, execute them now to get REAL state and refine the plan
    if (plan.readSteps.length > 0) {
      const readErrors = validatePlanSteps(plan.readSteps);
      if (readErrors.length === 0) {
        try {
          const remediationCreds =
            await this.awsSecurityService.assumeRemediationRole(
              credentials,
              region,
              { findingId: params.checkResultId },
              pairRoleArn,
            );
          const readResult = await executePlanSteps({
            steps: plan.readSteps,
            credentials: remediationCreds,
            region,
          });
          const realState = readResult.results.reduce(
            (acc, r) => ({ ...acc, [r.step.purpose]: r.output }),
            {} as Record<string, unknown>,
          );

          // Refine plan with real data
          const refined = await this.aiRemediationService.refineFixPlan({
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
            realAwsState: realState,
          });

          // If AI now says it can't auto-fix, show guided steps
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

          // Pin the real CloudTrail log group on metric-filter steps so the
          // preview matches what execution will actually apply (deterministic,
          // not AI-dependent).
          applyResolvedMetricFilterLogGroup(refined.fixSteps, evidence);

          // Build the COMPLETE permission list from ALL sources
          const aiPermissions =
            await this.aiRemediationService.analyzeRequiredPermissions(refined);

          // Merge: AI analysis + refined plan's requiredPermissions + derived from commands
          const allPerms = new Set([
            ...aiPermissions,
            ...refined.requiredPermissions,
          ]);

          // Also derive from actual step commands
          const svcMap: Record<string, string> = {
            s3: 's3',
            logs: 'logs',
            'cloudwatch-logs': 'logs',
            cloudtrail: 'cloudtrail',
            cloudwatch: 'cloudwatch',
            iam: 'iam',
            sns: 'sns',
            ec2: 'ec2',
            rds: 'rds',
            kms: 'kms',
            'config-service': 'config',
            guardduty: 'guardduty',
            lambda: 'lambda',
            dynamodb: 'dynamodb',
            cloudfront: 'cloudfront',
          };
          for (const step of [...refined.readSteps, ...refined.fixSteps]) {
            const iamSvc = svcMap[step.service] ?? step.service;
            // Resolve the REAL command name from the SDK (handles AI fuzzy names)
            const realAction = this.resolveRealActionName(
              step.service,
              step.command,
            );
            allPerms.add(`${iamSvc}:${realAction}`);
          }
          // Do NOT auto-add iam:PassRole. Passing a role lets a fix
          // escalate to whatever the passed role can do — it is granted only
          // via manual review (see the denylist).
          // Filter out blocked + unnecessary actions. Blocked actions
          // (privilege escalation, monitoring kill-switches, exfiltration,
          // destructive) are surfaced for manual review, never merged onto
          // the role by a one-click script.
          const { allowed: grantablePerms, blocked: blockedPerms } =
            splitBlockedRemediationActions([...allPerms]);
          if (blockedPerms.length > 0) {
            this.logger.warn(
              `Blocked ${blockedPerms.length} remediation permission(s) from auto-grant (manual review required): ${formatBlockedActionsForDisplay(blockedPerms)}`,
            );
          }
          // The denylist already routes blocked actions (including
          // s3:PutBucketAcl) to the manual-review bucket — no second filter.
          const permissionsList = grantablePerms.filter(
            (p) => p !== 'sts:GetCallerIdentity' && p !== 'sts:AssumeRole',
          );
          // Check permissions by reading the ACTUAL policies on the routed
          // remediator role (per-pair name, legacy fallback)
          let missingPermissions: string[] | undefined;
          let permissionFixScript: string | undefined;
          try {
            const { allowed: existingActions, denied: deniedActions } =
              await readRemediatorRolePermissions({
                credentials: remediationCreds,
                region,
                roleName: pairRoleName,
                onWarn: (message) => this.logger.warn(message),
                onInfo: (message) => this.logger.log(message),
              });
            this.logger.log(
              `${pairRoleName} has ${existingActions.size} actions. Needed: ${permissionsList.length}`,
            );
            const missing = permissionsList.filter(
              (p) =>
                !isPermissionCoveredBySet(p, existingActions, deniedActions),
            );
            if (missing.length > 0) {
              this.logger.log(
                `Missing ${missing.length} permissions: ${missing.join(', ')}`,
              );
              missingPermissions = missing;
              // Target the routed pair role (read above from pairRoleName),
              // never the monolith default — execution assumes this role.
              permissionFixScript = buildStaticPermissionScript(
                permissionsList,
                pairRoleName,
              );
            }
          } catch (err) {
            this.logger.warn(
              `Cannot read role policies: ${err instanceof Error ? err.message : String(err)}`,
            );
            missingPermissions = permissionsList;
            permissionFixScript = buildStaticPermissionScript(
              permissionsList,
              pairRoleName,
            );
          }

          // Cache the refined plan + permissions for execute and Recheck.
          // Never cache an unusable (empty / non-auto-fixable) plan — caching
          // one turns "Retry" into a no-op that reloads the same dead plan.
          if (this.isUsablePlan(refined)) {
            this.evictStalePlans();
            this.planCache.set(
              `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`,
              {
                plan: refined,
                timestamp: Date.now(),
                permissionsList,
                blockedPermissionsList: blockedPerms,
              },
            );
          }

          return {
            currentState: refined.currentState,
            proposedState: refined.proposedState,
            description: refined.description,
            risk: refined.risk,
            apiCalls: refined.requiredPermissions,
            guidedOnly: false,
            rollbackSupported: refined.rollbackSupported,
            requiresAcknowledgment: 'checkbox' as const,
            acknowledgmentMessage:
              'This fix will modify your AWS infrastructure. Please review the changes above before proceeding.',
            allRequiredPermissions: permissionsList,
            // Binds execute to this exact plan: pass back as `expectedPlanHash`.
            planHash: hashAwsPlanSteps(
              refined.fixSteps,
              refined.rollbackSteps,
              this.planBinding(params),
            ),
            ...(blockedPerms.length > 0 && {
              blockedPermissions: blockedPerms,
              blockedPermissionsMessage: BLOCKED_PERMISSIONS_MESSAGE,
            }),
            ...(missingPermissions &&
              missingPermissions.length > 0 && {
                missingPermissions,
                permissionFixScript,
              }),
          };
        } catch (err) {
          // Read/refine path failed — log the cause, then fall through to
          // show the AI's initial plan so the user still gets guidance.
          this.logger.warn(
            `Preview refine failed for ${params.checkResultId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Fallback: show initial AI plan without real data. Only cache it when
    // usable — caching an empty/non-auto-fixable plan makes Retry a no-op.
    // Cache the filtered grantable list (same shape as the refined path) so
    // execute merges never reintroduce denylisted actions via a raw list.
    // Blocked actions are surfaced for manual review on this path too —
    // without it a plan with no read steps would display denylisted actions
    // as plain requirements with no warning.
    const { allowed: fallbackGrantable, blocked: fallbackBlocked } =
      splitBlockedRemediationActions(plan.requiredPermissions);
    const fallbackPermissionsList = fallbackGrantable.filter(
      (p) => p !== 'sts:GetCallerIdentity' && p !== 'sts:AssumeRole',
    );
    if (this.isUsablePlan(plan)) {
      this.evictStalePlans();
      this.planCache.set(
        `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`,
        {
          plan,
          timestamp: Date.now(),
          permissionsList: fallbackPermissionsList,
          blockedPermissionsList: fallbackBlocked,
        },
      );
    }

    return {
      currentState: plan.currentState,
      proposedState: plan.proposedState,
      description: plan.description,
      risk: plan.risk,
      apiCalls: plan.requiredPermissions,
      guidedOnly: false,
      rollbackSupported: plan.rollbackSupported,
      requiresAcknowledgment: 'checkbox' as const,
      acknowledgmentMessage:
        'This fix will modify your AWS infrastructure. Please review the changes above before proceeding.',
      allRequiredPermissions: fallbackPermissionsList,
      // Binds execute to this exact plan: pass back as `expectedPlanHash`.
      planHash: hashAwsPlanSteps(
        plan.fixSteps,
        plan.rollbackSteps,
        this.planBinding(params),
      ),
      ...(fallbackBlocked.length > 0 && {
        blockedPermissions: fallbackBlocked,
        blockedPermissionsMessage: BLOCKED_PERMISSIONS_MESSAGE,
      }),
    };
  }

  async executeRemediation(params: {
    connectionId: string;
    organizationId: string;
    checkResultId: string;
    remediationKey: string;
    userId: string;
    acknowledgment?: string;
    expectedPlanHash?: string;
  }) {
    // Delegate GCP/Azure to dedicated services
    const connection = await this.getConnection(params);
    if (connection.provider.slug === 'gcp') {
      return this.gcpRemediationService.executeRemediation(params);
    }
    if (connection.provider.slug === 'azure') {
      return this.azureRemediationService.executeRemediation(params);
    }
    if (connection.provider.slug !== 'aws') {
      throw new Error('Remediation is only supported for AWS');
    }

    const finding = await this.getFinding(params);
    if (isManualRemediation(finding.remediation)) {
      throw new Error(
        'This finding requires manual remediation and cannot be auto-fixed.',
      );
    }

    const { credentials, region } = await this.resolveAwsExecutionContext({
      connectionId: params.connectionId,
      finding,
    });

    // Fail closed before creating the action record: without a remediation
    // role + External ID there is no write path, and the auditor creds stay
    // read-only.
    if (!hasRemediationRole(credentials)) {
      throw new Error(
        'No remediation role configured for this AWS connection. Add the pair role for this finding\u2019s asset class and region in the connection settings to enable auto-remediation.',
      );
    }

    // Route to the finding's pair role (map first, legacy fallback) — every
    // assume and grant-script below targets this role, never the auditor.
    const {
      assetClass: executeAssetClass,
      roleArn: pairRoleArn,
      roleName: pairRoleName,
      expectedRoleName: pairExpectedRoleName,
    } = resolveFindingRemediationRole({
      credentials,
      resourceType: finding.resourceType,
      region,
    });
    if (isApprovalGatedAssetClass(executeAssetClass)) {
      // Execute cannot degrade to guided-only — it throws so a cached or
      // regenerated plan for these classes never runs. Checked before the
      // missing-role throw: the role may well be configured, and it still
      // must not execute.
      throw new Error(
        `Cannot auto-execute: findings in the ${executeAssetClass} asset class require human approval. Apply the fix manually in the AWS console.`,
      );
    }
    if (!pairRoleArn || !pairRoleName) {
      throw new Error(
        `No remediation role configured for this finding's asset class and region. Add the ${pairExpectedRoleName} role to the connection settings.`,
      );
    }

    // Get plan from cache or regenerate
    let plan: FixPlan;
    const cacheKey = `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`;
    const cached = this.planCache.get(cacheKey);
    // Only reuse a cached plan if it is still fresh AND usable. Reusing a
    // stale empty / non-auto-fixable plan is exactly what made "Retry" a
    // no-op — execute reloaded the same dead plan and failed identically.
    // Falling through (and dropping the dead entry) regenerates a fresh plan,
    // which is what gives Retry a chance to succeed.
    if (
      cached &&
      Date.now() - cached.timestamp < this.PLAN_CACHE_TTL &&
      this.isUsablePlan(cached.plan)
    ) {
      plan = cached.plan;
    } else {
      this.planCache.delete(cacheKey);
      const evidence = (finding.evidence ?? {}) as Record<string, unknown>;
      plan = await this.aiRemediationService.generateFixPlan({
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

    // Universal plan validation — reject plans that would leave infra in a bad state
    if (!plan.fixSteps || plan.fixSteps.length === 0) {
      throw new Error('AI generated an empty fix plan. Cannot proceed.');
    }
    // Fast-fail on a stale acknowledgment before doing any work: the plan
    // above is cached or freshly regenerated. The authoritative check runs
    // again after refinement and repair below, against the steps that
    // actually execute. A hash for another plan (or none when one is
    // required by the client) refuses instead of executing a changed plan.
    if (
      params.expectedPlanHash &&
      params.expectedPlanHash !==
        hashAwsPlanSteps(
          plan.fixSteps,
          plan.rollbackSteps,
          this.planBinding(params),
        )
    ) {
      throw new Error(
        'The previewed plan changed since you acknowledged it. Preview again and acknowledge the new plan before executing.',
      );
    }
    if (!plan.rollbackSteps || plan.rollbackSteps.length === 0) {
      this.logger.warn(
        `No rollback steps for ${params.remediationKey} — fix is irreversible`,
      );
    }

    // Always require acknowledgment — we're modifying cloud infrastructure
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

    // Create the action record
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

    // Build the finding context once — reused by refineFixPlan, the
    // step-repair callback, and the manual-steps fallback path.
    const evidence = (finding.evidence ?? {}) as Record<string, unknown>;
    const findingCtx: FindingContext = {
      title: finding.title ?? 'Unknown',
      description: finding.description,
      severity: finding.severity,
      resourceType: finding.resourceType,
      resourceId: finding.resourceId,
      remediation: finding.remediation,
      findingKey: evidence.findingKey as string,
      evidence,
    };

    // The step that actually failed execution. Assigned inside try,
    // read in catch so the permission-fix AI sees the failing command,
    // not plan.fixSteps[0] (wrong for any failure past the first step).
    let failedFixStep: AwsCommandStep | undefined;
    // The actually-executed plan (refined + repaired). Assigned inside try
    // once validation passes, read in catch so the permission script covers
    // the executed actions — not the pre-refine original plan.
    let executedPlan: FixPlan | undefined;
    // The first auto-rollback failure, if any. Same hoisting — the catch
    // block needs it to warn about partial state.
    let failedRollbackError: string | undefined;

    try {
      // Validate read steps first
      const readErrors = validatePlanSteps(plan.readSteps);
      if (readErrors.length > 0) {
        // Read step validation rarely fails (Get*/Describe* commands are
        // simple), so don't attempt repair here — fall straight to
        // manual steps using the original plan for context.
        return await this.respondWithManualSteps({
          actionId: action.id,
          finding: findingCtx,
          failedPlan: plan,
          failureReason: `Read steps invalid: ${readErrors.join('; ')}`,
          resourceId: finding.resourceId,
        });
      }

      const remediationCreds =
        await this.awsSecurityService.assumeRemediationRole(
          credentials,
          region,
          { findingId: params.checkResultId },
          pairRoleArn,
        );

      // Phase 1: Execute read steps to get REAL AWS state
      const readResult = await executePlanSteps({
        steps: plan.readSteps,
        credentials: remediationCreds,
        region,
      });
      const previousState = readResult.results.reduce(
        (acc, r) => ({ ...acc, [r.step.purpose]: r.output }),
        {} as Record<string, unknown>,
      );

      // Phase 2: Send real AWS state back to AI to generate EXACT fix steps
      const refinedPlan = await this.aiRemediationService.refineFixPlan({
        finding: findingCtx,
        originalPlan: plan,
        realAwsState: previousState,
      });

      if (!refinedPlan.canAutoFix) {
        // AI found the fix can't be automated after seeing real state — return as failed with guidance
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

      // Validate refined fix steps
      if (!refinedPlan.fixSteps || refinedPlan.fixSteps.length === 0) {
        return await this.respondWithManualSteps({
          actionId: action.id,
          finding: findingCtx,
          failedPlan: refinedPlan,
          failureReason: 'AI refined plan produced no executable fix steps.',
          resourceId: finding.resourceId,
        });
      }

      // First validation pass over the refined plan. If anything fails,
      // attempt a single AI repair pass on the offending steps and
      // re-validate — many "missing required param" cases the AI's
      // first refinement misses are recoverable when given the exact
      // error back as context. If repair still doesn't satisfy the
      // validator, fall back to real manual steps so the customer
      // never sees a raw "Invalid fix steps" error.
      let plannedFix = refinedPlan;
      let fixErrors = validatePlanSteps(plannedFix.fixSteps);
      if (fixErrors.length > 0) {
        this.logger.warn(
          `Refined plan failed validation (${fixErrors.length} error(s)); attempting AI repair before falling back to manual.`,
        );
        plannedFix = await this.repairInvalidSteps({
          plan: plannedFix,
          validationErrors: fixErrors,
          finding: findingCtx,
          syntheticErrorPrefix: 'Pre-execution validator rejected this step:',
        });
        fixErrors = validatePlanSteps(plannedFix.fixSteps);
      }
      if (fixErrors.length > 0) {
        return await this.respondWithManualSteps({
          actionId: action.id,
          finding: findingCtx,
          failedPlan: plannedFix,
          failureReason: `Even after AI repair the plan still has invalid steps: ${fixErrors.join('; ')}`,
          resourceId: finding.resourceId,
        });
      }

      // Rollback steps run with isRollback: true (delete-block skipped;
      // IAM writes stay refused), so they need their own validation pass —
      // otherwise an AI-planted destructive rollback executes on the
      // failure path unchecked.
      const rollbackErrors = validateRollbackSteps(
        plannedFix.rollbackSteps ?? [],
      );
      if (rollbackErrors.length > 0) {
        return await this.respondWithManualSteps({
          actionId: action.id,
          finding: findingCtx,
          failedPlan: plannedFix,
          failureReason: `Rollback steps invalid: ${rollbackErrors.join('; ')}`,
          resourceId: finding.resourceId,
        });
      }
      // Auto-rollback pairs by index (rollbackSteps[i] undoes fixSteps[i]) —
      // that pairing is the only thing binding an undo step to the resource
      // its fix step touched. On a length mismatch the executor skips
      // auto-rollback rather than guess, so fail safe here too: route to
      // manual steps instead of running a fix whose undo cannot be paired.
      if (
        plannedFix.rollbackSteps &&
        plannedFix.rollbackSteps.length !== plannedFix.fixSteps.length
      ) {
        return await this.respondWithManualSteps({
          actionId: action.id,
          finding: findingCtx,
          failedPlan: plannedFix,
          failureReason: `Rollback steps cannot be paired with fix steps (${plannedFix.rollbackSteps.length} rollback step(s) for ${plannedFix.fixSteps.length} fix step(s)) — automatic undo would be unsafe.`,
          resourceId: finding.resourceId,
        });
      }

      // Deterministically pin the CloudTrail log group on any PutMetricFilter
      // step from the finding evidence — the AI must never be the source of
      // truth for it (this is what failed for the customer before).
      applyResolvedMetricFilterLogGroup(
        plannedFix.fixSteps,
        findingCtx.evidence,
      );

      // The acknowledged hash must cover the steps that actually run:
      // refinement and AI repair above rewrote them after the pre-check, so
      // re-verify against the final plan here. The in-execution repairStep
      // callback below stays hash-unverified by necessity — the repair
      // exists to change params — but it is pinned to the acknowledged
      // target (same service+command) and re-runs the full safety gate,
      // so recovery cannot smuggle in an unreviewed action.
      if (
        params.expectedPlanHash &&
        params.expectedPlanHash !==
          hashAwsPlanSteps(
            plannedFix.fixSteps,
            plannedFix.rollbackSteps,
            this.planBinding(params),
          )
      ) {
        throw new Error(
          'The previewed plan changed since you acknowledged it. Preview again and acknowledge the new plan before executing.',
        );
      }

      // The catch block below runs outside this scope — capture the
      // validated plan now so a permission failure builds its script from
      // the executed actions, not the stale original plan.
      executedPlan = plannedFix;

      // Phase 3: Execute the refined fix steps (now with REAL values).
      // Pass rollback steps for automatic undo on partial failure.
      // Pass a repairStep callback so that when AWS rejects any step with
      // a validation error the AI can self-repair the step once before
      // we give up — universal fix for "AI omitted a required param"
      // bugs that no per-command map can fully cover.
      const fixResult = await executePlanSteps({
        steps: plannedFix.fixSteps,
        credentials: remediationCreds,
        region,
        autoRollbackSteps: plannedFix.rollbackSteps,
        repairStep: async ({ step, awsError }) => {
          const repaired = await this.aiRemediationService.refineStepFromError({
            step,
            awsError,
            finding: findingCtx,
            planContext: {
              fixSteps: plannedFix.fixSteps,
              readSteps: plannedFix.readSteps,
            },
          });
          // Pin the repair to the acknowledged target: the prompt asks
          // for same service+command, but the model is untrusted input —
          // a repaired step naming a new target would execute outside the
          // acknowledged plan. Params may change (that is the repair);
          // the target may not. On a target change, retry the original
          // step so the run degrades to the normal failure path (with
          // auto-rollback) instead of running an unreviewed action.
          if (
            repaired &&
            (repaired.service !== step.service ||
              repaired.command !== step.command)
          ) {
            this.logger.warn(
              `AI repair changed the step target from ${step.service}:${step.command} to ${repaired.service}:${repaired.command} — refusing the repair and retrying the original step`,
            );
            return step;
          }
          return repaired;
        },
      });

      if (fixResult.error) {
        this.logger.error(
          `Fix step ${fixResult.error.stepIndex + 1} failed: ${fixResult.error.step.service}:${fixResult.error.step.command} — ${fixResult.error.message}`,
        );
        this.logger.error(
          `Step params: ${JSON.stringify(fixResult.error.step.params).slice(0, 500)}`,
        );
        // Auto-rollback runs best-effort inside the executor — when it
        // fails (or is skipped on an unpaired plan) the resource is left
        // partially modified. Carry that fact out of the try block (like
        // failedFixStep above) so both the manual-steps path below and the
        // permission-error catch path can say so instead of implying a
        // clean non-application.
        failedRollbackError =
          fixResult.rollbackError ?? fixResult.rollbackSkipped;
        if (failedRollbackError) {
          this.logger.warn(
            `Auto-rollback failed for ${finding.resourceId}: ${failedRollbackError}`,
          );
        }
        // Permission errors still flow through the catch block below
        // (parseAwsPermissionError produces the polished `fixScript`
        // payload). For all OTHER unrecoverable execution errors fall
        // back to manual steps so the customer sees real instructions
        // rather than the raw AWS message.
        if (
          parseAwsPermissionError(fixResult.error.message).isPermissionError
        ) {
          failedFixStep = fixResult.error.step;
          throw new Error(fixResult.error.message);
        }
        const rollbackNote = failedRollbackError
          ? fixResult.rollbackSkipped
            ? ` Automatic rollback was skipped (${fixResult.rollbackSkipped.slice(0, 300)}); the resource may be partially modified — review the applied steps before retrying.`
            : ` Automatic rollback of the completed steps also failed (${failedRollbackError.slice(0, 300)}); the resource may be partially modified — review the applied steps before retrying.`
          : '';
        return await this.respondWithManualSteps({
          actionId: action.id,
          finding: findingCtx,
          failedPlan: plannedFix,
          failureReason: `Step ${fixResult.error.stepIndex + 1} (${fixResult.error.step.service}:${fixResult.error.step.command}) was rejected by AWS: ${fixResult.error.message}.${rollbackNote}`,
          resourceId: finding.resourceId,
        });
      }

      // A skipped step never ran — recording `success` hides false
      // progress. Fail loudly so the customer reviews the gap instead of
      // trusting a fix that did not fully apply.
      const skippedSteps = fixResult.results.filter(
        (r) => (r.output as { _skipped?: unknown })._skipped === true,
      );
      if (skippedSteps.length > 0) {
        const skippedNames = skippedSteps.map(
          (r) => `${r.step.service}:${r.step.command}`,
        );
        const error = `Skipped ${skippedSteps.length} step(s) with unmet dependencies (${skippedNames.join(', ')}). The fix did not fully apply — review the steps and retry.`;
        await db.remediationAction.update({
          where: { id: action.id },
          data: {
            status: 'failed',
            previousState: previousState as Prisma.InputJsonValue,
            appliedState: {
              steps: fixResult.results.map((r) => ({
                command: `${r.step.service}:${r.step.command}`,
                output: r.output,
              })),
              rollbackSteps: plannedFix.rollbackSteps,
              error,
            } as Prisma.InputJsonValue,
            executedAt: new Date(),
          },
        });
        return await this.respondWithManualSteps({
          actionId: action.id,
          finding: findingCtx,
          failedPlan: plannedFix,
          failureReason: error,
          resourceId: finding.resourceId,
        });
      }

      const appliedState = {
        steps: fixResult.results.map((r) => ({
          command: `${r.step.service}:${r.step.command}`,
          output: r.output,
        })),
        rollbackSteps: plannedFix.rollbackSteps,
      };

      await db.remediationAction.update({
        where: { id: action.id },
        data: {
          status: 'success',
          previousState: previousState as Prisma.InputJsonValue,
          appliedState: appliedState as Prisma.InputJsonValue,
          executedAt: new Date(),
        },
      });

      this.logger.log(`Remediation executed on ${finding.resourceId}`);
      this.planCache.delete(
        `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`,
      );

      return {
        actionId: action.id,
        status: 'success' as const,
        resourceId: finding.resourceId,
        previousState,
        appliedState,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const permissionInfo = parseAwsPermissionError(errorMessage);

      // If permission error, build script with ALL needed permissions (not just the one that failed)
      // This prevents overwriting OpenComp-AutoFix with a partial list
      const permissionPlan = executedPlan ?? plan;
      let permissionError: ExecutePermissionError | undefined;
      if (
        permissionInfo.isPermissionError &&
        permissionPlan.fixSteps.length > 0
      ) {
        const cached = this.planCache.get(
          `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`,
        );
        // Prefer the step that actually failed (set above when execution
        // reached AWS). Fall back to the first step only when the failure
        // happened before execution (plan load, credential, read errors).
        const effectiveFailedStep = failedFixStep ?? permissionPlan.fixSteps[0];
        if (effectiveFailedStep) {
          permissionError = await this.buildExecutePermissionFix({
            errorMessage,
            failedStep: effectiveFailedStep,
            fallbackPermissions: [
              ...(cached?.permissionsList ??
                permissionPlan.requiredPermissions),
            ],
            // Grant scripts target the routed pair role, not the monolith.
            roleName: pairRoleName,
          });
        }
      }

      await db.remediationAction.update({
        where: { id: action.id },
        data: { status: 'failed', errorMessage },
      });

      // Drop the dead plan so Retry regenerates instead of reloading it.
      this.planCache.delete(
        `${params.connectionId}:${params.checkResultId}:${params.remediationKey}`,
      );

      this.logger.error(`Remediation failed: ${errorMessage}`);

      // The frontend parses the returned error text for IAM actions, so the
      // rollback note stays generic here — the raw rollback error is in the
      // server log (warned above), never inside a re-parsed string.
      const rollbackNote = failedRollbackError
        ? ' Automatic rollback of the completed steps also failed; the resource may be partially modified — review the applied steps before retrying.'
        : '';

      return {
        actionId: action.id,
        status: 'failed' as const,
        resourceId: finding.resourceId,
        error: `${errorMessage}${rollbackNote}`,
        ...(permissionError && { permissionError }),
      };
    }
  }

  async rollbackRemediation(params: {
    actionId: string;
    organizationId: string;
  }) {
    // Check provider to delegate GCP rollback
    const actionWithProvider = await db.remediationAction.findFirst({
      where: { id: params.actionId, organizationId: params.organizationId },
      include: { connection: { include: { provider: true } } },
    });

    if (!actionWithProvider) throw new Error('Remediation action not found');

    if (actionWithProvider.connection?.provider?.slug === 'gcp') {
      return this.gcpRemediationService.rollbackRemediation(params);
    }
    if (actionWithProvider.connection?.provider?.slug === 'azure') {
      return this.azureRemediationService.rollbackRemediation(params);
    }

    const action = actionWithProvider;
    // Retryable states: a `rollback_failed` action may be retried (the
    // operator may have granted the missing permission since), and a
    // `rollback_in_progress` claim older than the timeout belongs to a
    // crashed process — the claim below bumps updatedAt, so a live holder
    // always looks fresh and a stale one can be reclaimed.
    const rollbackFailed = action.status === 'rollback_failed';
    const staleClaim =
      action.status === 'rollback_in_progress' &&
      isStaleRollbackClaim(action.updatedAt);
    if (
      action.status !== 'success' &&
      action.status !== 'unverified' &&
      !rollbackFailed &&
      !staleClaim
    ) {
      throw new Error(`Cannot rollback action with status "${action.status}"`);
    }

    // Load and validate inputs BEFORE claiming: the claim flips the status
    // to `rollback_in_progress`, so a validation throw after it would leave
    // the action looking busy until the stale-claim timeout expires. The
    // timeout is the backstop for a crashed process; ordering validation
    // first keeps the common path from ever needing it.
    const appliedState = action.appliedState as Record<string, unknown>;
    const rollbackSteps = (appliedState.rollbackSteps ??
      []) as AwsCommandStep[];

    if (rollbackSteps.length === 0) {
      throw new Error('No rollback steps available for this action');
    }

    // Re-validate stored rollback steps before execution. They were checked
    // at plan time, but the stored undo runs on a later failure path —
    // never execute persisted steps without passing the current gate.
    const storedRollbackErrors = validateRollbackSteps(rollbackSteps);
    if (storedRollbackErrors.length > 0) {
      throw new Error(
        `Stored rollback steps failed re-validation: ${storedRollbackErrors.join('; ')}`,
      );
    }

    const credentials =
      await this.credentialVaultService.getDecryptedCredentials(
        action.connectionId,
      );
    if (!credentials) throw new Error('No credentials found');

    // Fail closed before claiming: a rollback without the remediation role
    // + External ID cannot run, and must not silently fall back to auditor
    // credentials.
    if (!hasRemediationRole(credentials)) {
      throw new Error(
        'Cannot rollback: no remediation role configured for this AWS connection. Add the pair role for this finding\u2019s asset class and region in the connection settings.',
      );
    }

    // Route rollback to the SAME pair role the finding executed under:
    // the region selects the role now, so the connection-default region
    // would assume (or demand) the wrong pair on multi-region connections.
    const region = await this.getRollbackRegion(action, credentials);
    const {
      assetClass: rollbackAssetClass,
      roleArn: pairRoleArn,
      roleName: pairRoleName,
      expectedRoleName: pairExpectedRoleName,
    } = resolveFindingRemediationRole({
      credentials,
      resourceType: action.resourceType,
      region,
    });
    if (isApprovalGatedAssetClass(rollbackAssetClass)) {
      // Undoing one of these writes is itself a high-blast-radius write —
      // refuse even when the pair role is configured.
      throw new Error(
        `Cannot rollback: findings in the ${rollbackAssetClass} asset class require human approval. Undo the change manually in the AWS console.`,
      );
    }
    if (!pairRoleArn || !pairRoleName) {
      throw new Error(
        `Cannot rollback: no remediation role configured for this finding's asset class and region. Add the ${pairExpectedRoleName} role to the connection settings.`,
      );
    }
    const remediationCreds =
      await this.awsSecurityService.assumeRemediationRole(
        credentials,
        region,
        {
          findingId: action.checkResultId,
        },
        pairRoleArn,
      );

    // Claim the rollback atomically so two concurrent callers cannot both
    // execute non-idempotent rollback steps. Only one updateMany wins.
    // The filter re-checks eligibility at write time (closing the
    // read-then-write race) and admits stale claims, so a crashed holder
    // does not strand the action forever.
    const staleClaimCutoff = new Date(Date.now() - ROLLBACK_CLAIM_TIMEOUT_MS);
    const claim = await db.remediationAction.updateMany({
      where: {
        id: action.id,
        OR: [
          { status: { in: ['success', 'unverified', 'rollback_failed'] } },
          {
            status: 'rollback_in_progress',
            updatedAt: { lt: staleClaimCutoff },
          },
        ],
      },
      data: { status: 'rollback_in_progress' },
    });
    if (claim.count === 0) {
      throw new Error(
        'Rollback already in progress or action is no longer eligible',
      );
    }

    try {
      const result = await executePlanSteps({
        steps: rollbackSteps,
        credentials: remediationCreds,
        region,
        isRollback: true,
      });

      if (result.error) throw new Error(result.error.message);

      // A skipped rollback step never ran — recording `rolled_back` hides
      // a partial undo. Fail loudly like the fix flow does so the customer
      // reviews the gap instead of trusting an undo that did not apply.
      const skippedRollbackSteps = result.results.filter(
        (r) => (r.output as { _skipped?: unknown })._skipped === true,
      );
      if (skippedRollbackSteps.length > 0) {
        const skippedNames = skippedRollbackSteps.map(
          (r) => `${r.step.service}:${r.step.command}`,
        );
        throw new Error(
          `Rollback skipped ${skippedRollbackSteps.length} step(s) with unmet dependencies (${skippedNames.join(', ')}). The rollback did not fully apply — review the steps and retry.`,
        );
      }

      await db.remediationAction.update({
        where: { id: action.id },
        data: { status: 'rolled_back', rolledBackAt: new Date() },
      });

      this.logger.log(
        `Rolled back ${action.remediationKey} on ${action.resourceId}`,
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
      const permissionInfo = parseAwsPermissionError(errorMessage);

      await db.remediationAction.update({
        where: { id: action.id },
        data: {
          status: 'rollback_failed',
          errorMessage: `Rollback failed: ${errorMessage}`,
        },
      });

      // If permission error, include actionable info
      if (permissionInfo.isPermissionError) {
        const rawMissing =
          permissionInfo.missingActions.length > 0
            ? permissionInfo.missingActions
            : ['(could not determine specific action)'];
        // The error-derived action can itself be denylisted
        // (e.g. iam:PassRole) — split it out like every other
        // permission-error path so the structured payload never offers
        // a one-click grant for an action auto-fix must refuse.
        const { allowed: missingActions, blocked: blockedPermissions } =
          splitBlockedRemediationActions(rawMissing);
        // Target the routed pair role — rollback assumes it above, so the
        // grant must too instead of falling back to the monolith default.
        const script = buildStaticPermissionScript(rawMissing, pairRoleName);
        throw new Error(
          JSON.stringify({
            message: `Rollback failed: missing permissions`,
            missingActions,
            script,
            ...(blockedPermissions.length > 0 && {
              blockedPermissions,
              blockedPermissionsMessage: BLOCKED_PERMISSIONS_MESSAGE,
            }),
          }),
        );
      }

      throw new Error(`Rollback failed: ${errorMessage}`);
    }
  }

  async getActions(params: { connectionId: string; organizationId: string }) {
    const actions = await db.remediationAction.findMany({
      where: {
        connectionId: params.connectionId,
        organizationId: params.organizationId,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const userIds = [...new Set(actions.map((a) => a.initiatedById))].filter(
      (id) => id !== 'system',
    );
    const users = userIds.length
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.name]));
    userMap.set('system', 'System');

    return actions.map((a) => ({
      ...a,
      initiatedByName: userMap.get(a.initiatedById) ?? null,
    }));
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private async getConnection(params: {
    connectionId: string;
    organizationId: string;
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
    return connection;
  }

  private async getFinding(params: {
    connectionId: string;
    checkResultId: string;
  }) {
    const finding = await db.integrationCheckResult.findFirst({
      where: {
        id: params.checkResultId,
        checkRun: { connectionId: params.connectionId },
      },
    });
    if (!finding) throw new Error('Finding not found');

    return finding;
  }

  private async resolveAwsExecutionContext(params: {
    connectionId: string;
    finding: { resourceId: string | null; evidence: unknown };
  }) {
    const credentials =
      await this.credentialVaultService.getDecryptedCredentials(
        params.connectionId,
      );
    if (!credentials) throw new Error('No credentials found');

    // Extract region from finding evidence or resourceId (not just first configured region)
    const region = this.getRegionForFinding(params.finding, credentials);
    return { credentials, region };
  }

  /**
   * Determine the correct AWS region for a finding.
   * Priority: evidence.region > ARN region > first configured region > us-east-1
   */
  private getRegionForFinding(
    finding: { resourceId: string | null; evidence: unknown },
    credentials: Record<string, unknown>,
  ): string {
    // 1. Check evidence for explicit region. Evidence comes from scan
    // output, so sanitize: an unexpected value (uppercase, whitespace,
    // shell metacharacters) must not reach role-name minting and throw a
    // 500 — fall through to the ARN and configured-region fallbacks.
    const evidence = (finding.evidence ?? {}) as Record<string, unknown>;
    if (typeof evidence.region === 'string' && evidence.region) {
      const candidate = evidence.region.trim();
      if (candidate && SAFE_AWS_REGION_PATTERN.test(candidate)) {
        return candidate;
      }
    }

    // 2. Extract region from ARN (arn:aws:service:REGION:account:resource)
    const resourceId = finding.resourceId ?? '';
    const arnMatch = resourceId.match(/^arn:aws[^:]*:[^:]+:([a-z0-9-]+):/);
    if (arnMatch?.[1] && arnMatch[1] !== '*') {
      return arnMatch[1];
    }

    // 3. Fall back to first configured region
    return this.getRegion(credentials);
  }

  /**
   * Rollback region: same derivation execute used, so rollback assumes the
   * pair role the finding ran under. When the finding row is gone (cleanup),
   * evidence is unavailable — reuse the ARN-region step from the action's
   * own resourceId before falling back to the connection default.
   */
  private async getRollbackRegion(
    action: { connectionId: string; checkResultId: string; resourceId: string },
    credentials: Record<string, unknown>,
  ): Promise<string> {
    try {
      const finding = await this.getFinding({
        connectionId: action.connectionId,
        checkResultId: action.checkResultId,
      });
      return this.getRegionForFinding(finding, credentials);
    } catch (error) {
      // A missing finding (post-cleanup) is the expected case for this
      // fallback — but a transient lookup failure lands here too and would
      // silently route rollback to a different pair role. Log it so the
      // two cases stay distinguishable in production logs.
      this.logger.warn(
        `Rollback region fallback for checkResult ${action.checkResultId}: finding lookup failed (${error instanceof Error ? error.message : String(error)}). Deriving region from resourceId/connection default.`,
      );
      const arnMatch = (action.resourceId ?? '').match(
        /^arn:aws[^:]*:[^:]+:([a-z0-9-]+):/,
      );
      if (arnMatch?.[1] && arnMatch[1] !== '*') return arnMatch[1];
      return this.getRegion(credentials);
    }
  }

  /**
   * Resolve AI-generated command name to the REAL SDK command name,
   * then derive the correct IAM action.
   * e.g., "CreateLogGroupsCommand" → finds "CreateLogGroupCommand" → returns "CreateLogGroup"
   *
   * Delegates to the executor's shared resolver so validation, execution,
   * and permission derivation always agree on what will run.
   */
  private resolveRealActionName(service: string, command: string): string {
    const canonical = resolveCanonicalCommandName(service, command);
    return (canonical ?? command).replace('Command', '');
  }

  /**
   * Build the permission-fix payload for a failed execute. Merges cached
   * preview permissions with newly discovered ones so the script never
   * overwrites OpenComp-AutoFix with a partial list. Blocked actions are
   * surfaced for manual review, never granted — including when the AI call
   * itself fails and only the error-derived actions are available.
   */
  private async buildExecutePermissionFix(args: {
    errorMessage: string;
    failedStep: AwsCommandStep;
    fallbackPermissions: string[];
    /** Routed pair role name for grant scripts. */
    roleName: string;
  }): Promise<ExecutePermissionError> {
    try {
      const suggestion = await this.aiRemediationService.suggestPermissionFix({
        errorMessage: args.errorMessage,
        failedStep: args.failedStep,
        roleName: args.roleName,
      });
      // Merge: cached permissions from preview + newly discovered missing ones
      const allPerms = new Set([
        ...args.fallbackPermissions,
        ...suggestion.missingActions,
      ]);
      const mergedScript = buildStaticPermissionScript(
        [...allPerms],
        args.roleName,
      );
      // The suggestion strips blocked actions from `missingActions`, so
      // re-surface them here — otherwise the very permission that caused
      // the failure (e.g. iam:PassRole) vanishes without explanation.
      // Union with blocked actions hiding in the fallback list: on the
      // execute-without-preview path the fallback is the raw plan list,
      // which can itself hold denylisted actions that the script text warns
      // about but the structured field would otherwise omit.
      const blockedFromSuggestion = suggestion.blockedActions ?? [];
      const blockedFromFallback = splitBlockedRemediationActions(
        args.fallbackPermissions,
      ).blocked;
      const allBlocked = [
        ...new Set([...blockedFromSuggestion, ...blockedFromFallback]),
      ].sort();
      return {
        missingActions: suggestion.missingActions,
        fixScript: [
          ...(allBlocked.length > 0
            ? [
                `# WARNING: ${allBlocked.length} required permission(s) need manual review and were NOT granted: ${formatBlockedActionsForDisplay(allBlocked)}`,
              ]
            : []),
          mergedScript,
        ].join('\n'),
        ...(allBlocked.length > 0 && {
          blockedPermissions: allBlocked,
          blockedPermissionsMessage: BLOCKED_PERMISSIONS_MESSAGE,
        }),
      };
    } catch {
      const fallbackActions = parseAwsPermissionError(
        args.errorMessage,
      ).missingActions;
      const { allowed, blocked } =
        splitBlockedRemediationActions(fallbackActions);
      return {
        missingActions: allowed,
        fixScript: buildStaticPermissionScript(fallbackActions, args.roleName),
        ...(blocked.length > 0 && {
          blockedPermissions: blocked,
          blockedPermissionsMessage: BLOCKED_PERMISSIONS_MESSAGE,
        }),
      };
    }
  }

  private getRegion(credentials: Record<string, unknown>): string {
    if (Array.isArray(credentials.regions) && credentials.regions.length > 0) {
      return credentials.regions[0] as string;
    }
    return getAwsDefaultRegion(normalizeAwsPartition(credentials.awsType));
  }

  /**
   * Read the ACTUAL IAM policies attached to OpenComp-Remediator and return
   * the allowed actions plus the explicit denies. This is deterministic —
   * no simulation. Covers inline policies AND attached managed policies,
   * single-object and array `Statement` shapes. Callers pass both sets to
   * `isPermissionCovered` so a specific deny defeats a wildcard allow.
   */
  /**
   * Best-effort AI repair pass over fix steps that failed validation.
   * Parses step indices from the error strings (format
   * "Step N (Command): ..."), then asks `refineStepFromError` to
   * regenerate just those steps. If repair returns a new step, replace
   * it; otherwise leave it alone for the caller to re-validate.
   *
   * Why this exists: `validatePlanSteps` runs BEFORE the executor, so
   * the executor's own AI repair never gets a chance to fix
   * empty-required-param plans. Without this pass, customers would see
   * raw "Invalid fix steps" errors. With it, every plan gets one shot
   * at AI repair before we fall back to manual guidance.
   */
  private async repairInvalidSteps(args: {
    plan: FixPlan;
    validationErrors: string[];
    finding: FindingContext;
    syntheticErrorPrefix: string;
  }): Promise<FixPlan> {
    const failingIndices = new Set<number>();
    for (const err of args.validationErrors) {
      const m = err.match(/^Step (\d+)\s*\(/);
      if (m) failingIndices.add(Number(m[1]) - 1);
    }
    if (failingIndices.size === 0) return args.plan;

    const newSteps = [...args.plan.fixSteps];
    let anyRepaired = false;
    for (const idx of failingIndices) {
      const step = newSteps[idx];
      if (!step) continue;
      // Group the validator's complaints for THIS step into a synthetic
      // "AWS error" the repair prompt can reason about.
      const stepErrors = args.validationErrors
        .filter((e) => e.startsWith(`Step ${idx + 1} `))
        .join('; ');
      const awsError = `${args.syntheticErrorPrefix} ${stepErrors}`;
      const repaired = await this.aiRemediationService.refineStepFromError({
        step,
        awsError,
        finding: args.finding,
        planContext: {
          fixSteps: args.plan.fixSteps,
          readSteps: args.plan.readSteps,
        },
      });
      if (repaired) {
        newSteps[idx] = repaired;
        anyRepaired = true;
      }
    }
    return anyRepaired ? { ...args.plan, fixSteps: newSteps } : args.plan;
  }

  /**
   * Universal "graceful fallback to manual steps" path. Called when an
   * auto-fix attempt cannot succeed (validation rejects after repair,
   * executor returns an unrecoverable error, plan has no usable steps).
   *
   * Persists the action as failed, generates real customer-facing
   * manual instructions via the AI, and returns the same shape the
   * frontend already renders for `canAutoFix: false` plans — so the
   * customer sees clear steps instead of a raw error.
   */
  private async respondWithManualSteps(args: {
    actionId: string;
    finding: FindingContext;
    failedPlan?: FixPlan;
    failureReason: string;
    resourceId: string;
  }) {
    const { guidedSteps, reason } =
      await this.aiRemediationService.generateManualSteps({
        finding: args.finding,
        failedPlan: args.failedPlan,
        failureReason: args.failureReason,
      });

    await db.remediationAction.update({
      where: { id: args.actionId },
      data: {
        status: 'failed',
        errorMessage: reason,
      },
    });

    this.logger.warn(
      `Manual-steps fallback for action ${args.actionId}: ${args.failureReason}`,
    );

    return {
      actionId: args.actionId,
      status: 'failed' as const,
      resourceId: args.resourceId,
      error: reason,
      guidedSteps,
      guidedOnly: true,
    };
  }
}
