import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { compileTools } from '../../src/tools.ts';
import { assertReviewedRegistry, reviewedToolAdditions } from '../compatibility/additions.mjs';

export const source = JSON.parse(
  readFileSync(new URL('../../../../packages/docs/openapi.json', import.meta.url), 'utf8'),
);
export const overlay = parse(
  readFileSync(new URL('../../mcp-overlay.yaml', import.meta.url), 'utf8'),
);
export const baseline = JSON.parse(
  readFileSync(new URL('../fixtures/parity-fixture.json', import.meta.url), 'utf8'),
);
export const registry = compileTools({ source, overlay });
export const expectedToolCount = baseline.tools.length + reviewedToolAdditions.length;
export const expectedToolNames = [
  ...baseline.tools.map((tool) => tool.name),
  ...reviewedToolAdditions.map((tool) => tool.name),
].sort();
assertReviewedRegistry({ tools: registry.tools, baseline });
export const tool = (name) => {
  const found = registry.tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing fixture tool ${name}`);
  return found;
};
export const emptyOverlay = { version: 1, schemas: [], operations: [] };
export function tiny({ parameters = [], body, path = '/v1/items/{id}', method = 'post' } = {}) {
  return {
    openapi: '3.0.0',
    servers: [{ url: 'http://127.0.0.1:1' }],
    components: { schemas: {} },
    paths: {
      [path]: {
        [method]: {
          operationId: 'ExampleController_example_v1',
          summary: 'Example',
          description: 'Example operation',
          parameters,
          ...(body
            ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } }
            : {}),
        },
      },
    },
  };
}
