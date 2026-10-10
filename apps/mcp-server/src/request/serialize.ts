import { objectSchema } from '../openapi/metadata.js';
import type { Parameter, RequestPlan } from './compile.js';

function scalar(value: unknown): string {
  if (value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  throw new Error('Nested parameter values are not supported');
}

function simple({
  value,
  explode,
  separator,
}: {
  value: unknown;
  explode: boolean;
  separator: string;
}): string {
  if (Array.isArray(value))
    return value.map((item) => encodeURIComponent(scalar(item))).join(separator);
  if (value !== null && typeof value === 'object') {
    return Object.entries(objectSchema.parse(value))
      .map(
        ([key, item]) =>
          `${encodeURIComponent(key)}${explode ? '=' : separator}${encodeURIComponent(scalar(item))}`,
      )
      .join(separator);
  }
  const text = scalar(value);
  if (text === '.' || text === '..') throw new Error('Dot path segments are not allowed');
  return encodeURIComponent(text);
}

function pathValue({ param, value }: { param: Parameter; value: unknown }): string {
  if (param.style === 'simple') return simple({ value, explode: param.explode, separator: ',' });
  if (param.style === 'label')
    return `.${simple({ value, explode: param.explode, separator: param.explode ? '.' : ',' })}`;
  const name = encodeURIComponent(param.name);
  if (Array.isArray(value) && param.explode)
    return value.map((item) => `;${name}=${encodeURIComponent(scalar(item))}`).join('');
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && param.explode) {
    return Object.entries(objectSchema.parse(value))
      .map(([key, item]) => `;${encodeURIComponent(key)}=${encodeURIComponent(scalar(item))}`)
      .join('');
  }
  return `;${name}=${simple({ value, explode: false, separator: ',' })}`;
}

function addQuery({
  query,
  param,
  value,
}: {
  query: URLSearchParams;
  param: Parameter;
  value: unknown;
}): void {
  if (Array.isArray(value)) {
    if (param.style === 'deepObject') throw new Error('deepObject requires an object');
    if (param.explode && param.style === 'form') {
      value.forEach((item) => query.append(param.name, scalar(item)));
      return;
    }
    const separator =
      param.style === 'spaceDelimited' ? ' ' : param.style === 'pipeDelimited' ? '|' : ',';
    query.append(param.name, value.map(scalar).join(separator));
    return;
  }
  if (value !== null && typeof value === 'object') {
    const pairs = Object.entries(objectSchema.parse(value));
    if (param.style === 'deepObject' || (param.explode && param.style === 'form')) {
      pairs.forEach(([key, item]) =>
        query.append(param.style === 'deepObject' ? `${param.name}[${key}]` : key, scalar(item)),
      );
      return;
    }
    if (param.style !== 'form') throw new Error('Delimited object queries are not supported');
    query.append(param.name, pairs.flatMap(([key, item]) => [key, scalar(item)]).join(','));
    return;
  }
  if (param.style !== 'form') throw new Error('This query style requires an array or object');
  query.append(param.name, scalar(value));
}

export function serializeRequest({
  plan,
  input,
  path,
}: {
  plan: RequestPlan;
  input: unknown;
  path: string;
}) {
  const parsed = objectSchema.parse(plan.input.parse(input));
  const request = parsed['request'];
  const fields = plan.parameters.length ? objectSchema.parse(request ?? {}) : {};
  const query = new URLSearchParams();
  const headers = new Headers({ Accept: plan.accept });
  let resolvedPath = path;
  for (const param of [...plan.parameters].sort((a, b) => a.name.localeCompare(b.name))) {
    const value = fields[param.inputName];
    if (value === undefined) continue;
    if (param.in === 'path')
      resolvedPath = resolvedPath.replaceAll(`{${param.name}}`, pathValue({ param, value }));
    else if (param.in === 'query') addQuery({ query, param, value });
    else {
      // Header simple serialization is not percent encoded.
      const encoded = simple({ value, explode: param.explode, separator: ',' });
      headers.set(param.name, decodeURIComponent(encoded));
    }
  }
  const payload = plan.body ? (plan.nestedBody ? fields['body'] : request) : undefined;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  if (body !== undefined && plan.contentType) headers.set('Content-Type', plan.contentType);
  return { path: resolvedPath, query, headers, ...(body !== undefined ? { body } : {}) };
}
