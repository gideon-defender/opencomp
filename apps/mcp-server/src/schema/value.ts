import { z } from 'zod';
import { JsonObject, objectSchema } from '../openapi/metadata.js';
import type { CompileSchema } from './compiler.js';

export function compileValue({
  schema,
  location,
  compile,
}: {
  schema: JsonObject;
  location: string;
  compile: CompileSchema;
}): z.ZodType {
  const type =
    schema['type'] ??
    (schema['properties'] || schema['required'] || schema['additionalProperties'] !== undefined
      ? 'object'
      : undefined);
  for (const [expected, keys] of [
    ['string', ['minLength', 'maxLength', 'pattern']],
    ['array', ['items', 'minItems', 'maxItems']],
    ['object', ['properties', 'required', 'additionalProperties']],
    ['number', ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']],
  ] as const) {
    if (keys.some((key) => schema[key] !== undefined) && type === undefined) {
      throw new Error(`${location}: ${expected} constraints require a compatible explicit type`);
    }
  }
  if (schema['format'] !== undefined && !['string', 'number', 'integer'].includes(String(type))) {
    throw new Error(`${location}: format requires a supported explicit type`);
  }
  let value: z.ZodType = z.unknown();
  if (type === 'object') {
    const properties =
      schema['properties'] === undefined ? {} : objectSchema.parse(schema['properties']);
    const required = new Set(z.array(z.string()).parse(schema['required'] ?? []));
    const shape: Record<string, z.ZodType> = Object.create(null);
    for (const name of new Set([...Object.keys(properties), ...required])) {
      const definition = objectSchema.parse(properties[name] ?? {});
      const field = compile({ source: definition, location: `${location}/properties/${name}` });
      // A default accepts omission without making its JSON-schema field required.
      // Unknown-valued required-only branches must still reject a missing key.
      shape[name] = required.has(name)
        ? definition['default'] === undefined
          ? field.nonoptional()
          : field
        : field.optional();
    }
    const additional = schema['additionalProperties'];
    // OpenAPI's absent policy is open, including required-only union alternatives.
    value =
      additional === false
        ? z.strictObject(shape)
        : z
            .object(shape)
            .catchall(
              additional === undefined || additional === true
                ? z.unknown()
                : compile({ source: additional, location: `${location}/additionalProperties` }),
            );
  } else if (type === 'array') {
    let array = z.array(compile({ source: schema['items'] ?? {}, location: `${location}/items` }));
    if (schema['minItems'] !== undefined)
      array = array.min(z.number().int().nonnegative().parse(schema['minItems']));
    if (schema['maxItems'] !== undefined)
      array = array.max(z.number().int().nonnegative().parse(schema['maxItems']));
    value = array;
  } else if (type === 'string') {
    let string = z.string();
    if (schema['minLength'] !== undefined)
      string = string.min(z.number().int().nonnegative().parse(schema['minLength']));
    if (schema['maxLength'] !== undefined)
      string = string.max(z.number().int().nonnegative().parse(schema['maxLength']));
    if (schema['pattern'] !== undefined)
      string = string.regex(new RegExp(z.string().parse(schema['pattern'])));
    const format = schema['format'];
    if (format === 'date-time') string = string.check(z.iso.datetime({ offset: true }));
    else if (format === 'date') string = string.check(z.iso.date());
    else if (format === 'email') string = string.check(z.email());
    else if (format === 'uuid') string = string.check(z.uuid());
    else if (format === 'uri') string = string.check(z.url());
    else if (format !== undefined && format !== 'password')
      throw new Error(`${location}: unsupported format ${String(format)}`);
    value = string;
  } else if (type === 'number' || type === 'integer') {
    let number = type === 'integer' ? z.number().int() : z.number();
    const minimum = schema['minimum'];
    const maximum = schema['maximum'];
    if (minimum !== undefined)
      number =
        schema['exclusiveMinimum'] === true
          ? number.gt(z.number().parse(minimum))
          : number.min(z.number().parse(minimum));
    if (maximum !== undefined)
      number =
        schema['exclusiveMaximum'] === true
          ? number.lt(z.number().parse(maximum))
          : number.max(z.number().parse(maximum));
    if (schema['multipleOf'] !== undefined)
      number = number.multipleOf(z.number().positive().parse(schema['multipleOf']));
    // Constraints for a different explicit type are inert under JSON Schema semantics.
    // The emitted UpdateFindingDto.revisionNote, for example, is object + maxLength.
    if (
      schema['format'] !== undefined &&
      !['int32', 'int64', 'float', 'double'].includes(z.string().parse(schema['format']))
    ) {
      throw new Error(`${location}: unsupported numeric format`);
    }
    value = number;
  } else if (type === 'boolean') value = z.boolean();
  else if (type !== undefined) throw new Error(`${location}: unsupported type ${String(type)}`);
  if (schema['enum'] !== undefined) {
    const options = z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .min(1)
      .parse(schema['enum']);
    value = z.intersection(value, z.union(options.map((option) => z.literal(option))));
  }
  return value;
}
