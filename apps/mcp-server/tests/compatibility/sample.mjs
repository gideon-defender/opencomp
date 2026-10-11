import { canonical } from './canonical.mjs';

/** Deterministic non-secret representative values, never sent to a real API. */
export function sample(schema) {
  const value = canonical(schema);
  if (Object.hasOwn(value, 'default')) return structuredClone(value.default);
  if (value.enum) return value.enum[0];
  if (Object.hasOwn(value, 'const')) return value.const;
  if (value.anyOf || value.oneOf) {
    const branch = (value.anyOf ?? value.oneOf).find((child) => child.type !== 'null');
    return sample({
      ...branch,
      ...Object.fromEntries(
        Object.entries(value).filter(([key]) => !['anyOf', 'oneOf'].includes(key)),
      ),
    });
  }
  if (value.allOf) {
    const parts = value.allOf.map(sample);
    if (parts.every((part) => part && typeof part === 'object')) return Object.assign({}, ...parts);
    return parts[0];
  }
  if (value.type === 'object') {
    if (!value.properties) return {};
    return Object.fromEntries(
      Object.entries(value.properties).map(([key, child]) => [key, sample(child)]),
    );
  }
  if (value.type === 'array')
    return Array.from({ length: Math.max(1, value.minItems ?? 0) }, () =>
      sample(value.items ?? {}),
    );
  if (value.type === 'number' || value.type === 'integer') return Math.max(1, value.minimum ?? 0);
  if (value.type === 'boolean') return true;
  if (value.type === 'null') return null;
  if (value.type === 'string') {
    if (value.format === 'date-time') return '2026-10-10T12:00:00Z';
    if (value.format === 'uri') return 'https://example.invalid/phase3';
    return 'sample'.padEnd(value.minLength ?? 0, 'x').slice(0, value.maxLength ?? 100);
  }
  return 'sample';
}
