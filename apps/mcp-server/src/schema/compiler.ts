import { z } from 'zod';
import { JsonObject, objectSchema } from '../openapi/metadata.js';
import { compileValue } from './value.js';

const keywords = new Set([
  '$ref',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'allOf',
  'oneOf',
  'anyOf',
  'nullable',
  'default',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'description',
  'title',
  'example',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

export type CompileSchema = (input: { source: unknown; location: string }) => z.ZodType;

/** Local references stay lazy; validate the graph first so lazy schemas cannot hide failures. */
export function createSchemaCompiler(document: JsonObject): CompileSchema {
  const cache = new Map<string, z.ZodType>();
  const checked = new Set<string>();

  function resolve({ ref, location }: { ref: string; location: string }): JsonObject {
    if (!ref.startsWith('#/')) throw new Error(`${location}: external reference ${ref}`);
    let value: unknown = document;
    for (const part of ref.slice(2).split('/')) {
      const key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
      value = objectSchema.parse(value)[key];
    }
    const parsed = objectSchema.safeParse(value);
    if (!parsed.success) throw new Error(`${location}: dangling reference ${ref}`);
    return parsed.data;
  }

  function validate({ source, location }: { source: unknown; location: string }): void {
    const schema = objectSchema.parse(source);
    for (const key of [
      'nullable',
      'readOnly',
      'writeOnly',
      'deprecated',
      'exclusiveMinimum',
      'exclusiveMaximum',
    ]) {
      if (schema[key] !== undefined) z.boolean().parse(schema[key]);
    }
    for (const key of Object.keys(schema)) {
      if (!keywords.has(key) && !key.startsWith('x-')) {
        throw new Error(`${location}: unsupported schema keyword ${key}`);
      }
    }
    if (schema['$ref'] !== undefined) {
      const ref = z.string().parse(schema['$ref']);
      const target = resolve({ ref, location });
      const aliases = new Set([ref]);
      let alias = target;
      while (typeof alias['$ref'] === 'string') {
        const next = alias['$ref'];
        if (aliases.has(next)) throw new Error(`${location}: unproductive reference cycle ${next}`);
        aliases.add(next);
        alias = resolve({ ref: next, location });
      }
      if (
        Object.keys(schema).some(
          (key) =>
            ![
              '$ref',
              'description',
              'nullable',
              'default',
              'title',
              'example',
              'examples',
              'readOnly',
              'writeOnly',
              'deprecated',
            ].includes(key) && !key.startsWith('x-'),
        )
      ) {
        throw new Error(`${location}: unsupported constraint beside $ref`);
      }
      if (!checked.has(ref)) {
        checked.add(ref);
        validate({ source: target, location: `${location} -> ${ref}` });
      }
    }
    for (const key of ['properties'] as const) {
      if (schema[key] === undefined) continue;
      for (const [name, value] of Object.entries(objectSchema.parse(schema[key]))) {
        validate({ source: value, location: `${location}/${key}/${name}` });
      }
    }
    for (const key of ['items', 'additionalProperties'] as const) {
      if (schema[key] === undefined || typeof schema[key] === 'boolean') continue;
      validate({ source: schema[key], location: `${location}/${key}` });
    }
    for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
      if (schema[key] === undefined) continue;
      const members = z.array(objectSchema).min(1).parse(schema[key]);
      members.forEach((value, index) =>
        validate({ source: value, location: `${location}/${key}/${index}` }),
      );
    }
    // Eagerly compile non-reference constraints, even inside an optional or recursive field.
    compileValue({
      schema,
      location,
      compile: ({ source: child, location: childLocation }) => {
        validate({ source: child, location: childLocation });
        return z.unknown();
      },
    });
  }

  function compile({ source, location }: { source: unknown; location: string }): z.ZodType {
    const schema = objectSchema.parse(source);
    let result: z.ZodType;
    if (schema['$ref'] !== undefined) {
      const ref = z.string().parse(schema['$ref']);
      let target = cache.get(ref);
      if (!target) {
        target = z.lazy(() => compile({ source: resolve({ ref, location }), location: ref }));
        cache.set(ref, target);
      }
      result = target;
    } else {
      result = compileValue({ schema, location, compile });
    }
    for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
      if (schema[key] === undefined) continue;
      const members = z
        .array(objectSchema)
        .parse(schema[key])
        .map((child, index) => compile({ source: child, location: `${location}/${key}/${index}` }));
      const first = members[0];
      if (!first) throw new Error(`${location}/${key}: empty composition`);
      const composed =
        key === 'allOf'
          ? members.slice(1).reduce((left, right) => z.intersection(left, right), first)
          : key === 'oneOf'
            ? z.xor(members)
            : z.union(members);
      result = z.intersection(result, composed);
    }
    if (schema['nullable'] === true) result = result.nullable();
    if (schema['default'] !== undefined) {
      if (!result.safeParse(schema['default']).success)
        throw new Error(`${location}: invalid schema default`);
      result = result.default(schema['default']);
    }
    if (typeof schema['description'] === 'string') result = result.describe(schema['description']);
    return result;
  }

  return ({ source, location }) => {
    try {
      validate({ source, location });
      return compile({ source, location });
    } catch (error) {
      throw new Error(`${location}: ${error instanceof Error ? error.message : 'invalid schema'}`);
    }
  };
}
