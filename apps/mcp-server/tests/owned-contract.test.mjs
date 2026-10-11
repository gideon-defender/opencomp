import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { loadOpenApi } from '../src/openapi-loader.ts';

const source = JSON.parse(
  readFileSync(new URL('../../../packages/docs/openapi.json', import.meta.url), 'utf8'),
);
const baseline = JSON.parse(
  readFileSync(new URL('./fixtures/parity-fixture.json', import.meta.url), 'utf8'),
);
const overlay = parse(readFileSync(new URL('../mcp-overlay.yaml', import.meta.url), 'utf8'));
const legacy = parse(
  readFileSync(new URL('../.speakeasy/mcp-uploads-overlay.yaml', import.meta.url), 'utf8'),
);
const emptyOverlay = { version: 1, schemas: [], operations: [] };
const operation = (id) => ({ operationId: id, summary: 'Summary', description: 'Description' });
const tinyDocument = (paths) => ({ openapi: '3.0.0', paths, components: { schemas: {} } });

test('owned registry matches all 412 captured tool names, descriptions and wire locations', () => {
  const before = structuredClone(source);
  const result = loadOpenApi({ source, overlay });
  assert.equal(result.tools.length, baseline.tools.length);
  for (const tool of baseline.tools) {
    const actual = result.tools.find((item) => item.name === tool.name);
    assert(actual, tool.name);
    assert.equal(actual.description, tool.description, tool.name);
    assert.equal(actual.path, tool.envelope.path, tool.name);
    assert.equal(actual.method, tool.envelope.method, tool.name);
    assert.equal(actual.operationId, tool.envelope.operationId, tool.name);
  }
  assert.deepEqual(source, before, 'Public docs must remain untouched');
});

test('all legacy disable/removal policies have equivalent owned targets', () => {
  const expectedDisabled = legacy.actions
    .filter((action) => action.update?.['x-speakeasy-mcp']?.disabled)
    .map((action) => action.target)
    .sort();
  const actualDisabled = overlay.operations
    .filter((item) => item.metadata.disabled)
    .map((item) => `$.paths['${item.path}'].${item.method}`)
    .sort();
  assert.deepEqual(actualDisabled, expectedDisabled);
  const expectedRemoved = legacy.actions
    .filter((action) => action.remove)
    .map((action) => action.target)
    .sort();
  const actualRemoved = overlay.schemas
    .flatMap((schema) =>
      schema.removeProperties.map(
        (property) => `$.components.schemas.${schema.name}.properties.${property}`,
      ),
    )
    .sort();
  assert.deepEqual(actualRemoved, expectedRemoved);
});

test('all captured tools remain available with owned metadata only', () => {
  const owned = structuredClone(source);
  for (const item of Object.values(owned.paths)) {
    for (const operation of Object.values(item)) {
      if (operation && typeof operation === 'object') delete operation['x-speakeasy-mcp'];
    }
  }
  const { tools } = loadOpenApi({ source: owned, overlay });
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    baseline.tools.map((tool) => tool.name).sort(),
  );
  for (const tool of tools) {
    assert.equal(
      tool.description,
      baseline.tools.find((item) => item.name === tool.name).description,
    );
  }
});

test('disabled tools and all four inline-upload fields stay absent; source fields remain', () => {
  const { document, tools } = loadOpenApi({ source, overlay });
  for (const item of overlay.operations) {
    assert(!tools.some((tool) => tool.path === item.path && tool.method === item.method));
  }
  assert(!tools.some((tool) => tool.path === '/v1/policies/{id}/pdf' && tool.method === 'post'));
  for (const schema of overlay.schemas) {
    assert.equal(document.components.schemas[schema.name].properties.fileData, undefined);
    assert(source.components.schemas[schema.name].properties.fileData);
  }
  const legacyDescription = legacy.actions.find((action) =>
    action.target.endsWith('.properties.s3Key'),
  );
  assert.equal(
    document.components.schemas.UploadAndParseDto.properties.s3Key.description,
    legacyDescription.update.description,
  );
});

test('owned-only operations derive compatible names and reserve disabled names', () => {
  const paths = {
    '/disabled': {
      post: {
        ...operation('FilesController_upload_v1'),
        'x-comp-mcp': { name: 'upload', disabled: true },
      },
    },
    '/a': { post: operation('FilesController_upload_v2') },
    '/b': { post: operation('FilesController_upload_v3') },
  };
  const { tools } = loadOpenApi({ source: tinyDocument(paths), overlay: emptyOverlay });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['files-upload', 'files-upload-2'],
  );
});

test('name collisions and conflicting owned/legacy declarations fail compilation', () => {
  const same = { ...operation('AController_get_v1'), 'x-comp-mcp': { name: 'same' } };
  assert.throws(
    () =>
      loadOpenApi({
        source: tinyDocument({ '/a': { get: same }, '/b': { get: same } }),
        overlay: emptyOverlay,
      }),
    /Duplicate MCP name/,
  );
  assert.throws(
    () =>
      loadOpenApi({
        source: tinyDocument({
          '/a': {
            get: {
              ...same,
              'x-speakeasy-mcp': { name: 'different' },
            },
          },
        }),
        overlay: emptyOverlay,
      }),
    /Conflicting MCP name/,
  );
});

test('overlay required-field removal leaves no dangling required key', () => {
  const doc = {
    ...tinyDocument({}),
    components: {
      schemas: {
        Upload: {
          type: 'object',
          properties: { fileData: { type: 'string' }, s3Key: { type: 'string' } },
          required: ['fileData', 's3Key'],
        },
      },
    },
  };
  const policy = { ...emptyOverlay, schemas: [{ name: 'Upload', removeProperties: ['fileData'] }] };
  const { document } = loadOpenApi({ source: doc, overlay: policy });
  assert.deepEqual(document.components.schemas.Upload.required, ['s3Key']);
  assert.deepEqual(doc.components.schemas.Upload.required, ['fileData', 's3Key']);
});

test('stale or unsupported overlay targets fail rather than silently exposing tools', () => {
  assert.throws(() => loadOpenApi({ source, overlay: { ...overlay, version: 2 } }));
  assert.throws(
    () =>
      loadOpenApi({
        source,
        overlay: {
          ...emptyOverlay,
          operations: [{ path: '/missing', method: 'get', metadata: { disabled: true } }],
        },
      }),
    /Missing overlay operation/,
  );
  assert.throws(
    () =>
      loadOpenApi({
        source,
        overlay: {
          ...emptyOverlay,
          schemas: [{ name: 'UploadAndParseDto', removeProperties: ['missing'] }],
        },
      }),
    /Missing overlay property/,
  );
});

test('overlay name changes are collision-checked and descriptions are tool-only', () => {
  const doc = tinyDocument({
    '/a': { get: { ...operation('AController_read_v1'), 'x-comp-mcp': { name: 'one' } } },
    '/b': { get: { ...operation('BController_read_v1'), 'x-comp-mcp': { name: 'two' } } },
  });
  assert.throws(
    () =>
      loadOpenApi({
        source: doc,
        overlay: {
          ...emptyOverlay,
          operations: [{ path: '/b', method: 'get', metadata: { name: 'one' } }],
        },
      }),
    /Duplicate MCP name/,
  );
  const result = loadOpenApi({
    source: doc,
    overlay: {
      ...emptyOverlay,
      operations: [{ path: '/a', method: 'get', metadata: { description: 'Agent guidance' } }],
    },
  });
  assert.equal(result.tools[0].description, 'Agent guidance');
  assert.equal(doc.paths['/a'].get.description, 'Description');
});
