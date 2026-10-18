/**
 * Helpers for embedding values into generated TypeScript source.
 *
 * Everything these generators emit is compiled and executed by Storybook, so a
 * value that escapes its literal is arbitrary code execution at build time. The
 * inputs are type names, string-literal types and file paths read out of the
 * repository and its dependencies — not attacker input today, but a crafted
 * `.d.ts` in a transitive dependency would otherwise reach the sink.
 *
 * Use these at every point where a runtime value becomes source text.
 */

/**
 * Characters that must not appear raw inside a string literal, mapped to their
 * escape. Anything else in the control range — plus U+2028/U+2029, which JSON
 * permits but JavaScript treats as line terminators — falls back to `\uXXXX`.
 *
 * This is deliberately not `JSON.stringify`: that is a JSON serializer, not a
 * code sanitizer, and it emits U+2028/U+2029 verbatim.
 */
const ESCAPES = new Map<string, string>([
  ['\\', '\\\\'],
  ["'", "\\'"],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
]);

// Matching control characters is the whole point: they are what must not reach
// the generated source unescaped.
// eslint-disable-next-line no-control-regex
const NEEDS_ESCAPE = /[\\'\n\r\t]|[\u0000-\u001f\u007f\u2028\u2029]/g;

/** A single-quoted string literal safe to paste into generated code. */
export function jsString(value: string): string {
  const body = value.replace(
    NEEDS_ESCAPE,
    (character) =>
      ESCAPES.get(character) ??
      `\\u${(character.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`,
  );
  return `'${body}'`;
}

const SAFE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * An object key safe to paste into generated code: bare when it is a plain
 * identifier, quoted otherwise, so a name like `data-id` or one carrying a
 * quote cannot close the object literal.
 */
export function jsPropertyKey(name: string): string {
  return SAFE_IDENTIFIER.test(name) ? name : jsString(name);
}

/**
 * A binding name — a component to import, a constant to declare. These cannot
 * be quoted, so a name that is not already an identifier has no safe encoding
 * and the caller must not emit it.
 */
export function isSafeIdentifier(name: string): boolean {
  return SAFE_IDENTIFIER.test(name);
}
