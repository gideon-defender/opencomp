import { asRecord } from './gcp-remediation-validator-shared';
import {
  findPriorSettingsForUrl,
  findPriorStateValue,
  type GcpReadStepRef,
  type GcpStepIdentity,
} from './gcp-remediation-prior-state';
import { rangesExposeFullIpSpace } from './gcp-remediation-ip-ranges';
import { validateGcpSqlDatabaseFlags } from './gcp-remediation-sql-flags-guardrails';

/**
 * Cloud SQL parameter guardrails for AI-generated GCP fix steps.
 *
 * Split from `gcp-remediation-param-guardrails` to respect the 300-line
 * repo limit. Every rejection routes the plan to guided-only, never to
 * execution.
 */

const SQL_INSTANCE_PATH = /^\/v1\/projects\/[^/]+\/instances\/[^/]+$/;
const SQL_USERS_PATH = /^\/v1\/projects\/[^/]+\/instances\/[^/]+\/users$/;

/**
 * Endpoint-shape gate for Cloud SQL Admin writes. The class allowlist
 * grants POST+PATCH over all of `sqladmin/v1/projects/` — but most shapes
 * are never an exposure fix: `export` moves data to an attacker bucket,
 * `users` insert provisions a login, `:clone`/`:restoreBackup`/`:failover`
 * are lifecycle operations. Only two shapes pass: PATCH on the instance
 * resource with a `settings`-only body, and the documented password
 * rotation (PUT `.../users?name=<user>` with a password-only body).
 * Everything else refuses before parameter checks run. Bodies without
 * `settings` (export, user insert, clone, failover) never reach
 * `validateGcpSqlPatch` through the dispatcher.
 */
export function validateGcpSqlEndpointShape(args: {
  method: string;
  pathname: string;
  nameQueryValues: string[];
  body: Record<string, unknown>;
  prefix: string;
}): string[] {
  const path = args.pathname.replace(/\/+$/, '');
  // Documented rotation only: PUT names one user via `?name=` and carries
  // nothing but the new password. POST would insert a new login, and
  // extra body keys ride an unreviewed shape.
  if (SQL_USERS_PATH.test(path)) {
    const names = args.nameQueryValues.some((name) => name.trim().length > 0);
    const keys = Object.keys(args.body);
    const password =
      typeof args.body.password === 'string' ? args.body.password : '';
    if (
      args.method === 'PUT' &&
      names &&
      keys.length === 1 &&
      keys[0] === 'password' &&
      password.length > 0
    ) {
      return [];
    }
    return [
      `${args.prefix}: only the documented password-rotation shape (PUT .../users?name=<user> with a password-only body) is a SQL user fix — refused for safety`,
    ];
  }
  // Instance PATCH must carry `settings` and nothing else: sibling fields
  // (`databaseVersion`, `name`) are provisioning changes, not fixes, and
  // an empty body is a no-op. Any other method or sub-path is a
  // data-movement or lifecycle shape, never an exposure fix.
  if (SQL_INSTANCE_PATH.test(path)) {
    if (args.method === 'PATCH') {
      const keys = Object.keys(args.body);
      if (
        keys.length === 0 ||
        (keys.length === 1 &&
          keys[0] === 'settings' &&
          args.body.settings !== null &&
          typeof args.body.settings === 'object' &&
          !Array.isArray(args.body.settings))
      ) {
        return [];
      }
    }
    return [
      `${args.prefix}: only PATCH with a settings-only body is a SQL instance fix — export, user, clone, and lifecycle shapes are never exposure fixes — refused for safety`,
    ];
  }
  return [
    `${args.prefix}: this SQL Admin endpoint is not a documented fix shape — export, clone, failover, and user-provisioning writes are never exposure fixes — refused for safety`,
  ];
}

/**
 * Cloud SQL PATCH is replace-shaped for flags and connectivity: refuse
 * `ipv4Enabled: false` without a private IP in the read state, and refuse
 * `databaseFlags` arrays that drop flags present in the read state. Without
 * read state, flag edits are refused outright.
 */
export function validateGcpSqlPatch(
  body: Record<string, unknown>,
  realState: Record<string, unknown> | undefined,
  prefix: string,
  opts?: {
    readSteps?: GcpReadStepRef[];
    fixStep?: GcpStepIdentity;
  },
): string[] {
  const errors: string[] = [];
  const settings = asRecord(body.settings);
  if (!settings) return errors;
  const ipConfig = asRecord(settings.ipConfiguration);
  if (ipConfig?.ipv4Enabled === false) {
    // Cloud SQL `instances.get` carries `ipAddresses` as a sibling of
    // `settings` — read it off the outer record, not the settings object.
    const priorSettings =
      opts?.fixStep !== undefined
        ? findPriorSettingsForUrl(realState, opts.readSteps, opts.fixStep)
        : undefined;
    const priorAddresses = priorSettings?.ipAddresses;
    // Fail closed on a malformed list: without proof of a private IP,
    // disabling public IP may break connectivity — and a throw is a
    // crash, not a refusal.
    const privateIp =
      Array.isArray(priorAddresses) &&
      (priorAddresses as unknown[]).some(
        (addr) =>
          addr !== null &&
          typeof addr === 'object' &&
          (addr as Record<string, unknown>).type === 'PRIVATE',
      );
    if (!privateIp) {
      errors.push(
        `${prefix}: disabling public IP without a private IP in the current state breaks connectivity — refused for safety`,
      );
    }
  }
  const authorizedNetworks = ipConfig?.authorizedNetworks;
  if (Array.isArray(authorizedNetworks)) {
    const values = authorizedNetworks.map((entry) =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>).value
        : entry,
    );
    if (rangesExposeFullIpSpace(values)) {
      errors.push(
        `${prefix}: opening authorizedNetworks to the internet (0.0.0.0/0) removes the SQL allowlist — refused for safety`,
      );
    }
    // Instance PATCH is replace-shaped: any range beyond the pre-fix set
    // widens the allowlist, not just 0.0.0.0/0. Fail closed without prior
    // state — an unverifiable widening is not safe.
    const priorNets = priorFieldValue(
      'settings.ipConfiguration.authorizedNetworks',
    );
    if (!Array.isArray(priorNets)) {
      errors.push(
        `${prefix}: authorizedNetworks edits without pre-fix state cannot prove they narrow access — refused for safety`,
      );
    } else {
      const priorValues = new Set<string>();
      for (const entry of priorNets) {
        const value =
          entry !== null && typeof entry === 'object' && !Array.isArray(entry)
            ? (entry as Record<string, unknown>).value
            : entry;
        if (typeof value === 'string') priorValues.add(value.trim());
      }
      for (const value of values) {
        if (typeof value !== 'string' || !priorValues.has(value.trim())) {
          errors.push(
            `${prefix}: authorizedNetworks adds "${typeof value === 'string' ? value : '?'}" beyond the pre-fix allowlist — refused for safety`,
          );
          break;
        }
      }
    }
  }
  // Disabling TLS enforcement weakens transport security: refuse
  // `requireSsl: false` unless the pre-fix state already has it off, and
  // refuse `sslMode` downgrades to unencrypted-allowed for the same reason.
  // Fail closed without prior state — an unverifiable downgrade is not safe.
  // Prior values arrive per dotted field path (`settings.ipConfiguration…`)
  // so multi-record states resolve unambiguously — the same bar the
  // rollback validators hold.
  function priorFieldValue(path: string): unknown {
    return findPriorStateValue(realState, path, {
      ...(opts?.readSteps ? { readSteps: opts.readSteps } : {}),
      ...(opts?.fixStep ? { fixStep: opts.fixStep } : {}),
    })?.value;
  }
  function priorIpConfig(): Record<string, unknown> | undefined {
    return asRecord(priorFieldValue('settings.ipConfiguration')) ?? undefined;
  }
  // Enabling public IP widens the instance the same way opening the
  // allowlist does: refuse unless the pre-fix state already has it on.
  // Fail closed without prior state.
  if (ipConfig?.ipv4Enabled === true) {
    if (priorFieldValue('settings.ipConfiguration.ipv4Enabled') !== true) {
      errors.push(
        `${prefix}: enabling public IP without it in the current state exposes the instance — refused for safety`,
      );
    }
  }
  if (ipConfig?.requireSsl === false) {
    if (priorIpConfig()?.requireSsl !== false) {
      errors.push(
        `${prefix}: disabling requireSsl removes TLS enforcement on SQL connections — refused for safety`,
      );
    }
  }
  const sslMode =
    typeof ipConfig?.sslMode === 'string'
      ? ipConfig.sslMode.trim().toUpperCase()
      : '';
  // `ALLOW_UNENCRYPTED_AND_ENCRYPTED` is the only sslMode that permits
  // plaintext: refusing it unless the pre-fix state already allows it.
  // `ENCRYPTED_ONLY` and `TRUSTED_CLIENT_CERTIFICATE_REQUIRED` both
  // enforce TLS, so neither is a downgrade.
  if (sslMode === 'ALLOW_UNENCRYPTED_AND_ENCRYPTED') {
    const prior = priorIpConfig();
    const priorMode =
      typeof prior?.sslMode === 'string'
        ? prior.sslMode.trim().toUpperCase()
        : '';
    if (priorMode !== sslMode) {
      errors.push(
        `${prefix}: downgrading sslMode to "${ipConfig?.sslMode}" weakens SQL transport security — refused for safety`,
      );
    }
  }
  // Explicit null clears the whole flag list at once under PATCH merge
  // semantics — the wholesale version of every per-flag drop the flags
  // validator refuses below.
  if (settings.databaseFlags === null) {
    errors.push(
      `${prefix}: clearing "databaseFlags" drops every Cloud SQL flag at once — refused for safety`,
    );
  } else if (Array.isArray(settings.databaseFlags)) {
    // Replace-shaped flag edits live in `gcp-remediation-sql-flags-guardrails`
    // (split for the 300-line repo limit): drops, value changes, and new
    // flags all refuse without bound pre-fix state.
    errors.push(
      ...validateGcpSqlDatabaseFlags({
        databaseFlags: settings.databaseFlags,
        prefix,
        realState,
        ...(opts?.readSteps ? { readSteps: opts.readSteps } : {}),
        ...(opts?.fixStep ? { fixStep: opts.fixStep } : {}),
      }),
    );
  }
  // Disabling automated backups removes recoverability, not exposure:
  // refuse unless the pre-fix state already has backups off. Fail closed
  // without prior state — an unverifiable downgrade is not safe.
  const backupConfig = asRecord(settings.backupConfiguration);
  if (backupConfig?.enabled === false) {
    const priorBackup = asRecord(
      priorFieldValue('settings.backupConfiguration'),
    );
    if (priorBackup?.enabled !== false) {
      errors.push(
        `${prefix}: disabling automated backups removes recovery protection — refused for safety`,
      );
    }
  }
  return errors;
}
