import { rangesExposeFullIpSpace } from './gcp-remediation-validator-shared';
import {
  findPriorStateValue,
  type GcpReadStepRef,
  type GcpStepIdentity,
} from './gcp-remediation-prior-state';

/**
 * Firewall parameter guardrails for AI-generated GCP fix steps.
 *
 * The class allowlist decides which *endpoints* may be called, but the
 * firewall API is dual-use — one parameter value is the fix, another
 * silently undoes the control. These checks reject only the dangerous
 * parameter shapes. Every rejection routes the plan to guided-only, never
 * to execution.
 */

/**
 * Firewall rule and insert paths. A bare substring would match `firewallsEvil`. */
export function isFirewallPath(pathname: string): boolean {
  return pathname.includes('/firewalls/') || pathname.endsWith('/firewalls');
}

/**
 * GCP protocol name for an `allowed` entry's `IPProtocol`. The Compute API
 * accepts names and numbers side by side (`"6"` is TCP, `"17"` is UDP), so
 * matching on the raw value lets a numeric spelling skip the port gate
 * below. Numbers normalize to their name; anything else passes through
 * unchanged (non-TCP/UDP protocols carry no ports, and the API itself
 * refuses values it does not know).
 */
function normalizeGcpIpProtocol(value: unknown): string {
  const spelled =
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : typeof value === 'number' && Number.isInteger(value)
        ? String(value)
        : '';
  if (spelled === '6') return 'tcp';
  if (spelled === '17') return 'udp';
  return spelled;
}

/**
 * A POST/PUT to the collection path creates a rule. Absent range lists
 * default to open on create, so inserts carry stricter requirements than
 * PATCH (where an absent list changes nothing).
 */
export function isFirewallInsert(pathname: string, method: string): boolean {
  if (method !== 'POST' && method !== 'PUT') return false;
  return pathname.replace(/\/+$/, '').endsWith('/firewalls');
}

/**
 * True when a firewall `ports` list opens the full 0–65535 range — the
 * exact entry, split halves, or any covering union. Unparseable and
 * non-string entries fail closed (refuse): a port the guard cannot
 * understand is not a port it can approve.
 */
function portsExposeFullRange(values: unknown): boolean {
  if (!Array.isArray(values)) return false;
  const intervals: Array<[number, number]> = [];
  for (const entry of values) {
    if (typeof entry !== 'string') return true;
    const value = entry.trim();
    if (value.length === 0) return true;
    const parts = value.split('-');
    if (parts.length > 2) return true;
    const bounds: number[] = [];
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return true;
      const n = Number(part);
      if (n < 0 || n > 65535) return true;
      bounds.push(n);
    }
    if (bounds.length === 0) return true;
    const start = bounds[0] ?? 0;
    const end = bounds.length > 1 ? (bounds[1] ?? 0) : start;
    if (end < start) return true;
    intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [start, end] of intervals) {
    if (start > covered) return false;
    covered = Math.max(covered, end + 1);
    if (covered > 65535) return true;
  }
  return covered > 65535;
}

/**
 * `allowed`-list port gates shared by carried bodies and stored state:
 * per-entry checks (malformed, `all`, missing ports) plus the
 * cross-entry union — a full range split across sibling entries opens
 * every port while each entry alone looks narrow. Protocols stay
 * separate. Malformed entries fail closed.
 */
function checkAllowedList(allowed: unknown, prefix: string): string[] {
  if (!Array.isArray(allowed)) {
    return [
      `${prefix}: "allowed" must be a list of protocol rules — refused for safety`,
    ];
  }
  const tcpPorts: unknown[] = [];
  const udpPorts: unknown[] = [];
  for (const rule of allowed) {
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      return [
        `${prefix}: "allowed" carries a malformed protocol rule — refused for safety`,
      ];
    }
    const fields = rule as Record<string, unknown>;
    const protocol = normalizeGcpIpProtocol(fields.IPProtocol);
    if (protocol === 'all') {
      return [
        `${prefix}: IPProtocol "all" on a firewall fix is over-broad — refused for safety`,
      ];
    }
    // `tcp`/`udp` without `ports` opens every port — the same over-broad
    // shape under a narrower name. `icmp` carries no ports. Numeric
    // spellings (`"6"`, `"17"`) normalized to names above face this gate.
    if (protocol === 'tcp' || protocol === 'udp') {
      if (!Array.isArray(fields.ports) || fields.ports.length === 0) {
        return [
          `${prefix}: "${protocol}" without ports opens every port — refused for safety`,
        ];
      }
      (protocol === 'tcp' ? tcpPorts : udpPorts).push(
        ...(fields.ports as unknown[]),
      );
    }
  }
  // The union subsumes per-entry ranges: one entry's ports are part of
  // its protocol's combined list.
  if (portsExposeFullRange(tcpPorts) || portsExposeFullRange(udpPorts)) {
    return [
      `${prefix}: "allowed" opens every port (full 0-65535 range in one entry or split across sibling rules) — refused for safety`,
    ];
  }
  return [];
}

/**
 * Firewall writes must narrow access, never widen it: refuse any
 * `sourceRanges` list that exposes the full IP space — the exact open
 * range, split halves, or any covering union. Inserts must also *carry*
 * their range list: an omitted `sourceRanges` defaults to `0.0.0.0/0` on
 * ingress (and `destinationRanges` on egress), so a missing list on a
 * create is an open rule, not a no-op. `allowed` entries face the same
 * bar on ports: `tcp`/`udp` with a full `0-65535` range (exact, split, or
 * covering union — within one entry or across siblings) opens every port
 * like a missing list does. A merge update (PATCH) that omits `allowed`
 * keeps the stored list, so the stored list must pass the same port
 * gates from read state, or the update refuses. A full-replace update
 * (PUT) that omits a list resets it to open defaults instead, so a
 * missing list on a replace refuses like a missing list on a create.
 */
export function validateGcpFirewallPatch(
  body: Record<string, unknown>,
  prefix: string,
  isInsert: boolean,
  opts?: {
    realState?: Record<string, unknown>;
    readSteps?: GcpReadStepRef[];
    fixStep?: GcpStepIdentity;
    /** True for merge-shaped updates (PATCH): absent fields keep stored values. */
    isMerge?: boolean;
    /**
     * True for full-replace updates (PUT to a named path): absent fields
     * reset to API defaults, so a missing list is an open rule, not a no-op.
     */
    isReplace?: boolean;
  },
): string[] {
  // `disabled` flips enforcement off: disabling a DENY rule grants the
  // traffic it used to block. Enabling (`false`) is no safer — it
  // activates whatever ranges the stored rule holds, which this body does
  // not show. Both directions route to guided-only.
  if ('disabled' in body) {
    return [
      `${prefix}: changing "disabled" on a firewall rule alters enforcement without showing the resulting access — refused for safety`,
    ];
  }
  // PATCH replaces the fields it carries: a `denied` list in the body
  // replaces the whole deny list, so dropped entries silently stop
  // denying. Without the prior list to diff against, any `denied`
  // presence on a patch is a widening-shaped change.
  if (!isInsert && 'denied' in body) {
    return [
      `${prefix}: replacing the deny list can drop existing denials and widen access — refused for safety`,
    ];
  }
  // Scope keys decide *which* instances a rule hits (`targetTags`,
  // `targetServiceAccounts` — absent means all instances) and *which*
  // sources reach it (`sourceTags`, `sourceServiceAccounts`, unioned with
  // `sourceRanges`). PATCH replaces carried fields, so a scope edit
  // rewrites enforcement without showing the resulting access — the same
  // shape as `disabled`. Source tags/accounts widen even a narrow-range
  // insert, so they refuse on creates too.
  const scopeKeys = [
    'targetTags',
    'targetServiceAccounts',
    'sourceTags',
    'sourceServiceAccounts',
  ].filter((key) => key in body);
  const sourceScope = scopeKeys.filter((key) => key.startsWith('source'));
  if ((!isInsert && scopeKeys.length > 0) || sourceScope.length > 0) {
    return [
      `${prefix}: changing firewall scope ("${scopeKeys[0] ?? 'scope'}") rewrites which instances or sources the rule hits without showing the resulting access — refused for safety`,
    ];
  }
  // `priority` decides which rule wins: lowering an overly-broad ALLOW
  // rule's number above an existing DENY silently widens access — the same
  // enforcement rewrite without showing the resulting access as `disabled`
  // or `direction`. Refuse on updates; inserts declare the full rule
  // alongside their required range lists.
  if (!isInsert && 'priority' in body) {
    return [
      `${prefix}: changing "priority" on a firewall rule rewrites which rule wins without showing the resulting access — refused for safety`,
    ];
  }
  const direction =
    typeof body.direction === 'string'
      ? body.direction.trim().toUpperCase()
      : '';
  // `direction` flips the rule's meaning (ingress↔egress) without showing
  // the resulting access: an egress rule reads `destinationRanges`
  // (default open) instead of `sourceRanges`, so a lone direction flip
  // converts a narrow rule into an open one while both range checks see
  // absent lists and pass. Same shape as `disabled` — refuse on updates;
  // inserts declare direction alongside their required range lists.
  if (!isInsert && 'direction' in body) {
    return [
      `${prefix}: changing "direction" on a firewall rule rewrites which traffic the rule hits without showing the resulting access — refused for safety`,
    ];
  }
  const egress = direction === 'EGRESS';
  if (!egress) {
    const ranges = body.sourceRanges;
    if (Array.isArray(ranges)) {
      if (rangesExposeFullIpSpace(ranges)) {
        return [
          `${prefix}: re-adding an open source range (0.0.0.0/0) widens the firewall — refused for safety`,
        ];
      }
    } else if (isInsert || opts?.isReplace) {
      return [
        `${prefix}: firewall create/replace without sourceRanges opens the rule to the internet (0.0.0.0/0) — refused for safety`,
      ];
    }
  }
  // Egress rules filter on `destinationRanges` — an open destination range
  // opens exfiltration the same way. Skipped on ingress: GCP ignores the
  // field there, so checking it would refuse harmless plans.
  if (direction !== 'INGRESS') {
    const dest = body.destinationRanges;
    if (Array.isArray(dest)) {
      if (rangesExposeFullIpSpace(dest)) {
        return [
          `${prefix}: opening the egress destination range to the internet (0.0.0.0/0) widens the firewall — refused for safety`,
        ];
      }
    } else if ((isInsert || opts?.isReplace) && egress) {
      return [
        `${prefix}: egress create/replace without destinationRanges opens exfiltration to the internet — refused for safety`,
      ];
    }
  }
  const allowed = body.allowed;
  if (allowed !== undefined) {
    const allowedErrors = checkAllowedList(allowed, prefix);
    if (allowedErrors.length > 0) return allowedErrors;
  }
  if (!isInsert && opts?.isReplace && !Array.isArray(allowed)) {
    // Full-replace without `allowed` resets the protocol list to API
    // defaults instead of keeping stored values — unprovable, so refused.
    return [
      `${prefix}: firewall full-replace without "allowed" resets the rule's protocol list — refused for safety`,
    ];
  }
  if (!isInsert && opts?.isMerge && !Array.isArray(allowed)) {
    // PATCH without `allowed` keeps the stored list: it must pass the
    // same port gates — fail closed without read state.
    const priorAllowed = findPriorStateValue(opts?.realState, 'allowed', {
      ...(opts?.readSteps ? { readSteps: opts.readSteps } : {}),
      ...(opts?.fixStep ? { fixStep: opts.fixStep } : {}),
    })?.value;
    if (
      !Array.isArray(priorAllowed) ||
      checkAllowedList(priorAllowed, prefix).length > 0
    ) {
      return [
        `${prefix}: firewall merge without "allowed" leaves the stored list unproven — refused for safety`,
      ];
    }
  }
  return [];
}
