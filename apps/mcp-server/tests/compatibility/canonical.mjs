import { isDeepStrictEqual } from 'node:util';

/** Normalize only provable JSON-schema representation equivalences, not constraints. */
export function canonical(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    if (key === 'properties') {
      if (Object.keys(value).length)
        result[key] = Object.fromEntries(
          Object.entries(value).map(([name, child]) => [name, canonical(child)]),
        );
    } else if (['allOf', 'oneOf', 'anyOf'].includes(key)) result[key] = value.map(canonical);
    else if (['items', 'additionalProperties'].includes(key)) {
      const child = canonical(value);
      if (key === 'additionalProperties' && (child === true || isDeepStrictEqual(child, {})))
        continue;
      result[key] = child;
    } else if (key === 'propertyNames' && isDeepStrictEqual(value, { type: 'string' })) continue;
    else if (key === 'required' || key === 'enum') result[key] = [...value].sort();
    else result[key] = value;
  }
  if (
    Array.isArray(result.type) &&
    Object.keys(result).every((key) => ['type', 'description', 'default'].includes(key))
  ) {
    result.anyOf = result.type.map((type) => ({ type }));
    delete result.type;
  }
  for (const keyword of ['anyOf', 'oneOf']) {
    if (result[keyword])
      result[keyword] = result[keyword].map((child) => {
        if (child.description !== result.description) return child;
        const { description, ...rest } = child;
        return rest;
      });
  }
  if (
    result.anyOf?.every(
      (child) =>
        Object.hasOwn(child, 'const') &&
        Object.keys(child).every((key) => ['type', 'const'].includes(key)),
    )
  ) {
    const types = new Set(result.anyOf.map((child) => child.type));
    if (types.size === 1) {
      result.type = result.anyOf[0].type;
      result.enum = result.anyOf.map((child) => child.const).sort();
      delete result.anyOf;
    }
  }
  if (result.allOf) {
    const remaining = result.allOf.filter((child) => Object.keys(child).length);
    delete result.allOf;
    for (const child of remaining) {
      const collisions = Object.keys(child).filter(
        (key) => Object.hasOwn(result, key) && !isDeepStrictEqual(result[key], child[key]),
      );
      if (collisions.length) {
        (result.allOf ??= []).push(child);
        continue;
      }
      Object.assign(result, child);
    }
  }
  return result;
}

export function differences({ before, after, path = '' }) {
  if (isDeepStrictEqual(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((value, index) =>
      differences({ before: value, after: after[index], path: `${path}/${index}` }),
    );
  }
  if (
    !before ||
    !after ||
    typeof before !== 'object' ||
    typeof after !== 'object' ||
    Array.isArray(before) ||
    Array.isArray(after)
  ) {
    return [{ path, before, after }];
  }
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) =>
    differences({ before: before[key], after: after[key], path: `${path}/${key}` }),
  );
}
