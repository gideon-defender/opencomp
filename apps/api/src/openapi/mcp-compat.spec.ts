import { applyMcpCompatibility } from './mcp-compat';
import type { OpenApiOperation } from './types';

describe('MCP metadata compatibility', () => {
  it('dual-emits owned metadata without changing HTTP operation fields', () => {
    const operation: OpenApiOperation = {
      operationId: 'PeopleController_inviteMembers_v1',
      summary: 'Invite',
      'x-comp-mcp': {
        name: 'invite-members',
        description: 'Invite a teammate',
      },
    };
    applyMcpCompatibility({ '/people': { post: operation } });
    expect(operation['x-speakeasy-mcp']).toEqual(operation['x-comp-mcp']);
    expect(operation.operationId).toBe('PeopleController_inviteMembers_v1');
    expect(operation.summary).toBe('Invite');
  });

  it('imports legacy metadata and preserves disabled names', () => {
    const disabled: OpenApiOperation = {
      operationId: 'FilesController_upload_v1',
      'x-speakeasy-mcp': { name: 'upload', disabled: true },
    };
    const active: OpenApiOperation = {
      operationId: 'OtherController_upload_v1',
    };
    applyMcpCompatibility({
      '/files': { post: disabled },
      '/other': { post: active },
    });
    expect(disabled['x-comp-mcp']).toEqual({ name: 'upload', disabled: true });
    expect(active['x-comp-mcp']).toEqual({ name: 'other-upload' });
  });

  it('retains method/resource/numeric collision naming and is idempotent', () => {
    const paths = {
      '/a': { get: { operationId: 'TasksController_list_v1' } },
      '/b': { get: { operationId: 'PeopleController_list_v1' } },
      '/c': { get: { operationId: 'PeopleController_list_v2' } },
    };
    applyMcpCompatibility(paths);
    const first = structuredClone(paths);
    applyMcpCompatibility(paths);
    expect(paths).toEqual(first);
    expect(Object.values(paths).map((item) => item.get)).toEqual([
      expect.objectContaining({ 'x-comp-mcp': { name: 'list' } }),
      expect.objectContaining({ 'x-comp-mcp': { name: 'people-list' } }),
      expect.objectContaining({ 'x-comp-mcp': { name: 'people-list-2' } }),
    ]);
  });

  it('rejects conflicting extensions and duplicate explicit names', () => {
    expect(() =>
      applyMcpCompatibility({
        '/a': {
          get: {
            'x-comp-mcp': { name: 'new' },
            'x-speakeasy-mcp': { name: 'old' },
          },
        },
      }),
    ).toThrow('Conflicting MCP name');
    expect(() =>
      applyMcpCompatibility({
        '/a': { get: { 'x-comp-mcp': { name: 'same' } } },
        '/b': { post: { 'x-comp-mcp': { name: 'same', disabled: true } } },
      }),
    ).toThrow('Duplicate MCP name');
  });
});
