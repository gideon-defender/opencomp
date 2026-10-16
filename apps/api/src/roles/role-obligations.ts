import {
  BUILT_IN_ROLE_OBLIGATIONS,
  statement,
  type RoleObligations,
} from '@gideon-defender/auth';
import { BUILT_IN_ROLE_NAMES } from './role-holders';

function sanitizeObligations(value: unknown): RoleObligations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, 'compliance')) return {};
  const flag = record.compliance;
  if (typeof flag !== 'boolean') return {};
  return { compliance: flag };
}

export function parseObligationsField(value: unknown): RoleObligations {
  if (typeof value === 'string') {
    try {
      return sanitizeObligations(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return sanitizeObligations(value);
}

/**
 * Mirror the frontend PermissionMatrix contract: enabling the `compliance`
 * obligation implies portal self-service access (sign policies, watch
 * training). One-directional add, never removes — a role can hold portal
 * access independently of this obligation, so opting out keeps any stored
 * portal rights (strip them with an explicit permissions replacement).
 *
 * Applied before the grant check so a direct API caller cannot smuggle
 * portal access via obligations without holding it.
 */
export function withCompliancePortal(
  permissions: Record<string, string[]>,
  obligations: RoleObligations,
): Record<string, string[]> {
  if (!obligations.compliance) return permissions;
  const portalActions = [...statement.portal];
  const current = permissions.portal ?? [];
  const merged = Array.from(new Set([...current, ...portalActions]));
  return { ...permissions, portal: merged };
}

/**
 * Resolve the effective obligations for a single role, given an optional DB
 * override row. Centralized so every read path applies the same fallback
 * rule: a DB row only wins when it explicitly sets `compliance`, otherwise
 * we fall back to the hardcoded built-in default. Prevents the UI and the
 * enforcement layer from diverging when a row exists with `{}` obligations.
 */
export function resolveEffectiveObligations(
  roleName: string,
  override: RoleObligations | null,
): RoleObligations {
  // Own-property + boolean check on a sanitized object: DB rows arrive as
  // parsed JSON and a prototype-chain `in` check would honor polluted
  // prototypes. Non-boolean flags fall through to the default.
  if (
    override &&
    typeof override === 'object' &&
    Object.hasOwn(override, 'compliance')
  ) {
    const flag = (override as Record<string, unknown>).compliance;
    if (typeof flag === 'boolean') return { compliance: flag };
  }
  if (BUILT_IN_ROLE_NAMES.includes(roleName)) {
    return BUILT_IN_ROLE_OBLIGATIONS[roleName] ?? {};
  }
  return override ?? {};
}
