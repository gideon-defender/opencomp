import { z } from 'zod';
import { JsonObject, objectSchema } from '../openapi/metadata.js';
import type { CompileSchema } from '../schema/compiler.js';
import { responseAccept } from './accept.js';

const parameterSchema = z
  .object({
    name: z.string().min(1),
    in: z.enum(['path', 'query', 'header']),
    required: z.boolean().optional(),
    description: z.string().optional(),
    schema: objectSchema,
    style: z.string().optional(),
    explode: z.boolean().optional(),
    allowReserved: z.boolean().optional(),
  })
  .passthrough();
export type Parameter = z.infer<typeof parameterSchema> & {
  inputName: string;
  style: string;
  explode: boolean;
};
export type RequestPlan = {
  accept: string;
  parameters: Parameter[];
  body: boolean;
  nestedBody: boolean;
  contentType?: string;
  input: z.ZodObject<{ request: z.ZodType }> | z.ZodObject<Record<string, never>>;
};

function inputName(name: string): string {
  return name
    .replace(/^[A-Z]/, (value) => value.toLowerCase())
    .replace(/[-_ ]+(\w)/g, (_, value: string) => value.toUpperCase());
}

export function compileRequest({
  operation,
  pathItem,
  path,
  location,
  compile,
}: {
  operation: JsonObject;
  pathItem: JsonObject;
  path: string;
  location: string;
  compile: CompileSchema;
}): RequestPlan {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#'))
    throw new Error(`${location}: invalid operation path`);
  const inherited = z.array(parameterSchema).parse(pathItem['parameters'] ?? []);
  const own = z.array(parameterSchema).parse(operation['parameters'] ?? []);
  const merged = new Map(
    inherited.map((param) => [
      `${param.in}:${param.in === 'header' ? param.name.toLowerCase() : param.name}`,
      param,
    ]),
  );
  const seen = new Set<string>();
  for (const param of own) {
    const key = `${param.in}:${param.in === 'header' ? param.name.toLowerCase() : param.name}`;
    if (seen.has(key)) throw new Error(`${location}: duplicate parameter ${key}`);
    seen.add(key);
    merged.set(key, param);
  }
  const shape: Record<string, z.ZodType> = Object.create(null);
  let required = false;
  const parameters = [...merged.values()].map((param) => {
    const name = inputName(param.name);
    if (shape[name] || name === 'body')
      throw new Error(`${location}: parameter input collision ${name}`);
    if (
      param.in === 'header' &&
      ['x-api-key', 'apikey', 'authorization', 'cookie', 'host', 'content-type'].includes(
        param.name.toLowerCase(),
      )
    ) {
      throw new Error(`${location}: credential/reserved header parameter ${param.name}`);
    }
    if (param['content'] !== undefined || param.allowReserved === true)
      throw new Error(`${location}: unsupported parameter encoding ${param.name}`);
    const style = param.style ?? (param.in === 'query' ? 'form' : 'simple');
    const supported =
      param.in === 'path'
        ? ['simple', 'label', 'matrix']
        : param.in === 'header'
          ? ['simple']
          : ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject'];
    if (!supported.includes(style))
      throw new Error(`${location}: unsupported ${param.in} style ${style}`);
    if (style === 'deepObject' && (param.schema['type'] !== 'object' || param.explode === false))
      throw new Error(`${location}: deepObject requires an exploded object`);
    if (
      ['spaceDelimited', 'pipeDelimited'].includes(style) &&
      (param.schema['type'] !== 'array' || param.explode === true)
    ) {
      throw new Error(`${location}: delimited queries require a non-exploded array`);
    }
    if (param.in === 'path' && param.required !== true)
      throw new Error(`${location}: path parameter must be required`);
    if (param.in === 'path' && !path.includes(`{${param.name}}`))
      throw new Error(`${location}: unused path parameter ${param.name}`);
    const validator = compile({
      source: param.schema,
      location: `${location}/parameters/${param.name}`,
    });
    const described = param.description ? validator.describe(param.description) : validator;
    shape[name] = param.required ? described.nonoptional() : described.optional();
    required ||= param.required === true;
    return {
      ...param,
      inputName: name,
      style,
      explode: param.explode ?? ['form', 'deepObject'].includes(style),
    };
  });
  for (const match of path.matchAll(/\{([^}]+)\}/g)) {
    if (!parameters.some((param) => param.in === 'path' && param.name === match[1]))
      throw new Error(`${location}: missing path parameter ${match[1]}`);
  }
  let request: z.ZodType = z.object(shape);
  let contentType: string | undefined;
  const body = operation['requestBody'] !== undefined;
  const nestedBody = body && parameters.length > 0;
  if (body) {
    const definition = objectSchema.parse(operation['requestBody']);
    if (definition['$ref'] !== undefined)
      throw new Error(`${location}: requestBody references are not supported`);
    const content = objectSchema.parse(definition['content']);
    const types = Object.keys(content);
    if (types.length !== 1 || types[0] !== 'application/json')
      throw new Error(`${location}: unsupported body MIME types ${types.join(',')}`);
    contentType = types[0];
    const media = objectSchema.parse(content[contentType]);
    let validator = compile({ source: media['schema'] ?? {}, location: `${location}/requestBody` });
    if (typeof definition['description'] === 'string')
      validator = validator.describe(definition['description']);
    const bodyRequired = definition['required'] === true;
    if (nestedBody) {
      shape['body'] = bodyRequired ? validator.nonoptional() : validator.optional();
      request = z.object(shape);
    } else request = validator;
    required ||= bodyRequired;
  }
  const input =
    body || parameters.length > 0
      ? z.object({ request: required ? request.nonoptional() : request.optional() })
      : z.object({});
  return {
    accept: responseAccept(operation),
    parameters,
    body,
    nestedBody,
    input,
    ...(contentType ? { contentType } : {}),
  };
}
