import type { AzureRemediationAssetClass } from '@gideon-defender/integration-platform';
import type { AzureApiStep, AzureFixPlan } from './azure-ai-remediation.prompt';
import { buildEffectiveAzureStepUrl } from './azure-remediation-step-url';

/** One acknowledged step as the user saw it: the effective URL the wire
 * sees (raw URL plus merged `queryParams`), the body, and any rollback
 * writes running under the same acknowledgment. */
function previewApiCall(step: AzureApiStep) {
  return {
    method: step.method,
    endpoint: buildEffectiveAzureStepUrl({
      url: step.url,
      queryParams: step.queryParams,
    }),
    purpose: step.purpose,
    body: step.body ?? null,
    queryParams: step.queryParams ?? null,
  };
}

/** Preview shape the frontend renders for an auto-fixable plan. */
export function buildAzurePreviewResponse(plan: AzureFixPlan) {
  return {
    currentState: plan.currentState,
    proposedState: plan.proposedState,
    description: plan.description,
    risk: plan.risk,
    apiCalls: plan.fixSteps.map(previewApiCall),
    rollbackCalls: plan.rollbackSteps.map(previewApiCall),
    guidedOnly: false,
    rollbackSupported: plan.rollbackSupported,
    requiresAcknowledgment: plan.requiresAcknowledgment
      ? ('checkbox' as const)
      : undefined,
    acknowledgmentMessage: plan.acknowledgmentMessage,
  };
}

/** Preview shape for plans that ship manual steps instead of an auto-fix. */
export function buildAzureGuidedResponse(plan: AzureFixPlan) {
  return {
    currentState: plan.currentState,
    proposedState: plan.proposedState,
    description: plan.description,
    risk: plan.risk,
    apiCalls: [],
    guidedOnly: true,
    guidedSteps: plan.guidedSteps ?? [
      plan.reason || 'This finding requires manual remediation.',
    ],
    rollbackSupported: false,
    requiresAcknowledgment: undefined,
  };
}

/** Guided-only plan for approval-gated classes: reads allowed, never writes. */
export function approvalGatedAzurePlan(args: {
  assetClass: AzureRemediationAssetClass;
  title: string;
}): AzureFixPlan {
  return {
    canAutoFix: false,
    risk: 'high',
    description: args.title,
    currentState: {},
    proposedState: {},
    readSteps: [],
    fixSteps: [],
    rollbackSteps: [],
    rollbackSupported: false,
    requiresAcknowledgment: false,
    reason: `${args.assetClass} findings require human approval — a configured binding enables reads, never writes.`,
    guidedSteps: [
      `${args.assetClass} findings require human approval. Review the finding in the Azure Portal and apply the fix manually.`,
    ],
  };
}

/** Guided-only plan when the finding carries no subscription scope. */
export function unscopedAzurePlan(title: string): AzureFixPlan {
  return {
    canAutoFix: false,
    risk: 'high',
    description: title,
    currentState: {},
    proposedState: {},
    readSteps: [],
    fixSteps: [],
    rollbackSteps: [],
    rollbackSupported: false,
    requiresAcknowledgment: false,
    reason:
      'This finding carries no Azure subscription scope, so no allowlisted fix can bind to it. Review the finding in the Azure Portal and apply the fix manually.',
    guidedSteps: [
      'This finding carries no Azure subscription scope. Review the finding in the Azure Portal and apply the fix manually.',
    ],
  };
}
