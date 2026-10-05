import { asRecord } from './gcp-remediation-validator-shared';
import {
  findPriorStateValue,
  type GcpReadStepRef,
  type GcpStepIdentity,
} from './gcp-remediation-prior-state';

/**
 * Pub/Sub parameter guardrails for AI-generated GCP fix steps.
 *
 * The class allowlist grants POST+PATCH over all of
 * `pubsub/v1/projects/` — but the dangerous shapes are data-plane, not
 * grant-shaped, so the generic public-grant backstop never fires on them:
 * `:modifyPushConfig` with a new `pushEndpoint` turns the topic into a
 * forwarder of customer message data to an attacker URL, and `:publish`
 * with `messages` injects data into the topic. Consuming shapes are just
 * as dangerous: `:pull` reads message payloads into step output,
 * `:acknowledge` permanently deletes messages, and `:seek` /
 * `:modifyAckDeadline` rewind or hold messages the fix does not own.
 * Creating topics or subscriptions provisions instead of fixing.
 * None is ever an exposure fix. Every rejection routes the plan to
 * guided-only, never to execution.
 */

/** True when the new endpoint is the same host over HTTPS as the prior. */
function isSameHostHttpsUpgrade(args: {
  prior: unknown;
  next: string;
}): boolean {
  if (typeof args.prior !== 'string' || args.prior.trim().length === 0) {
    return false;
  }
  try {
    const before = new URL(args.prior);
    const after = new URL(args.next);
    return (
      before.hostname.toLowerCase() === after.hostname.toLowerCase() &&
      // Ports are part of the destination: without this, an upgrade from
      // `http://host/hook` to `https://host:8443/hook` would pass as a
      // same-host upgrade while redirecting topic data to a different
      // listener on the shared host.
      before.port === after.port &&
      before.protocol === 'http:' &&
      after.protocol === 'https:'
    );
  } catch {
    return false;
  }
}

export function validateGcpPubSubWrite(args: {
  method: string;
  pathname: string;
  body: Record<string, unknown>;
  realState?: Record<string, unknown>;
  readSteps?: GcpReadStepRef[];
  fixStep?: GcpStepIdentity;
  prefix: string;
  /**
   * Restore path: a POST replay is constrained by prior-state comparison
   * (`validatePostRollback`), not by the fix-flow provisioning refusal.
   */
  isRollback?: boolean;
}): string[] {
  const path = args.pathname.replace(/\/+$/, '');
  // Publishing injects messages into a topic — never an exposure fix.
  if (path.endsWith(':publish') || 'messages' in args.body) {
    return [
      `${args.prefix}: publishing messages to Pub/Sub injects data, it never fixes an exposure — refused for safety`,
    ];
  }
  // Consuming or deleting messages is data-plane too: `:pull` and
  // `:streamingPull` return message payloads into step output
  // (exfiltration through the fix path), `:acknowledge` permanently
  // deletes messages, and `:seek` / `:modifyAckDeadline` rewind or hold
  // messages the fix does not own.
  if (
    path.endsWith(':pull') ||
    path.endsWith(':streamingPull') ||
    path.endsWith(':acknowledge') ||
    path.endsWith(':seek') ||
    path.endsWith(':modifyAckDeadline')
  ) {
    return [
      `${args.prefix}: reading or deleting Pub/Sub messages is data-plane, it never fixes an exposure — refused for safety`,
    ];
  }
  // Provisioning is never a fix: POST without an `:action` suffix creates
  // a topic or subscription instead of repairing one. Rollbacks replaying
  // a reviewed creation skip this refusal — prior-state comparison owns
  // that path.
  if (!args.isRollback && args.method === 'POST' && !path.includes(':')) {
    return [
      `${args.prefix}: creating Pub/Sub resources is provisioning, not remediation — refused for safety`,
    ];
  }
  // Redirecting push delivery sends topic data to a new destination: only
  // a same-host HTTP→HTTPS upgrade proven by bound prior state passes.
  // Clearing the endpoint (pull delivery) removes the external call, so
  // it stays allowed. Without prior state the upgrade is unprovable.
  const pushConfig = asRecord(args.body.pushConfig);
  if (pushConfig && 'pushEndpoint' in pushConfig) {
    const endpoint =
      typeof pushConfig.pushEndpoint === 'string'
        ? pushConfig.pushEndpoint.trim()
        : '';
    if (endpoint.length === 0) return [];
    const prior =
      args.fixStep !== undefined
        ? findPriorStateValue(args.realState, 'pushConfig.pushEndpoint', {
            ...(args.readSteps ? { readSteps: args.readSteps } : {}),
            fixStep: args.fixStep,
          })?.value
        : undefined;
    if (!isSameHostHttpsUpgrade({ prior, next: endpoint })) {
      return [
        `${args.prefix}: changing the push endpoint redirects topic data to a new destination — refused for safety`,
      ];
    }
  }
  return [];
}
