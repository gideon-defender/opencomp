/**
 * Shell-quoting safety for generated CloudShell scripts.
 *
 * Generated one-click scripts embed JSON policy documents inside
 * single-quoted shell arguments (`--policy-document '<json>'`). Parts of
 * that JSON (notably the IAM `Resource`, which the model supplies as a
 * free-form string) can carry a single quote that ends the quoting early —
 * everything after it would run as shell in the admin's CloudShell.
 * Quote at the shell layer, after JSON serialization, so the JSON stays
 * valid and the shell stays quoted.
 */

/**
 * Wraps `value` in single quotes for Bourne-shell embedding. A `'` inside
 * becomes `'\''` (close, escaped literal, reopen) — the only correct
 * escaping inside single quotes. JSON output never holds raw control
 * characters (`JSON.stringify` escapes them), so no other shaping is
 * needed; spaces and printable Unicode pass through untouched.
 */
export function quoteForSingleQuotedShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
