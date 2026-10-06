/**
 * Compute parameter guardrails for AI-generated GCP fix steps.
 *
 * The class allowlist grants method+prefix over all of
 * `compute/v1/projects/` — but most Compute actions are never a security
 * fix: stopping, starting, or resetting an instance is a lifecycle change,
 * `setMetadata` injects SSH keys and startup scripts, `setTags` retargets
 * firewall rules, and `setServiceAccount` swaps the instance identity.
 * Creating instances (POST to a collection) is never remediation either.
 * Every rejection routes the plan to guided-only, never to execution.
 */

const COMPUTE_ACTION_SUFFIXES: readonly string[] = [
  ':stop',
  ':start',
  ':reset',
  ':suspend',
  ':resume',
  ':setMetadata',
  // Project-wide metadata (`ssh-keys`, `startup-script`) hits every
  // instance at once — a broader form of the `:setMetadata` injection, so
  // it needs its own entry: it does not end with `:setMetadata`.
  ':setCommonInstanceMetadata',
  ':setTags',
  ':setLabels',
  ':setServiceAccount',
  ':setMachineType',
  ':setShieldedInstanceIntegrityPolicy',
  // Network-attachment actions: granting an external IP or attaching a
  // disk/NIC is a posture or provisioning change, never an exposure fix.
  ':addAccessConfig',
  ':updateNetworkInterface',
  ':attachDisk',
  ':attachNetworkInterface',
  ':detachNetworkInterface',
];

/**
 * Refuse Compute writes that change lifecycle, identity, or targeting —
 * none of these narrows a finding. Firewall paths dispatch to the firewall
 * validator instead, so this covers non-firewall Compute only. Enabling
 * deletion protection is the one allowed lifecycle write: it hardens the
 * instance, while disabling it weakens it.
 */
export function validateGcpComputePatch(args: {
  pathname: string;
  method: string;
  body: Record<string, unknown>;
  prefix: string;
}): string[] {
  const normalized = args.pathname.replace(/\/+$/, '');
  // `setDeletionProtection` is a path segment, not a `:action` — match
  // both forms. Enabling protection hardens the instance; anything else
  // here weakens it.
  if (
    normalized.endsWith('/setDeletionProtection') ||
    normalized.endsWith(':setDeletionProtection')
  ) {
    if (args.body.deletionProtection === true) return [];
    return [
      `${args.prefix}: Compute action "setDeletionProtection" without enabling protection weakens the instance — refused for safety`,
    ];
  }
  for (const suffix of COMPUTE_ACTION_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      return [
        `${args.prefix}: Compute action "${suffix.slice(1)}" changes lifecycle, identity, or firewall targeting — it is never a security fix — refused for safety`,
      ];
    }
  }
  // POST to a collection path creates a resource. Remediation never
  // provisions: any POST without a `:action` suffix is a collection
  // insert (instances, disks, networks, routes, ...), not a fix.
  if (args.method === 'POST' && !normalized.includes(':')) {
    return [
      `${args.prefix}: creating Compute resources is provisioning, not remediation — refused for safety`,
    ];
  }
  // Direct-field PATCH: `instances.patch` honors body fields without any
  // `:action` suffix, so the denials above are circumventable through the
  // equivalent field write. A field denylist cannot hold this shape — every
  // new Compute field (`machineType`, `shieldedInstanceConfig`,
  // `scheduling`, ...) reopens the exact change its `:action` denial was
  // added to block. Only enabling deletion protection hardens the
  // instance; every other field write refuses. The allowance applies only
  // to action-free PATCH paths: the `:setDeletionProtection` forms return
  // above, so any `:` reaching here is an unlisted action — a protection
  // body on an unknown action is not a proven hardening.
  const fields = Object.keys(args.body);
  const onlyEnablesProtection =
    fields.length === 1 &&
    fields[0] === 'deletionProtection' &&
    args.body.deletionProtection === true &&
    !normalized.includes(':');
  if (!onlyEnablesProtection) {
    return [
      `${args.prefix}: Compute PATCH field "${fields[0] ?? '(empty body)'}" is not an exposure fix — only enabling deletionProtection hardens the instance — refused for safety`,
    ];
  }
  return [];
}
