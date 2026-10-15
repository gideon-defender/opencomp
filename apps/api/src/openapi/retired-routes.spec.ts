import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Operation {
  operationId?: string;
}

interface RouteEntry {
  path: string;
  method: string;
  operationId: string;
}

/**
 * Phase 4 regression: the IdP-owned writers deleted from the controllers
 * must stay deleted. Their absence from the exported OpenAPI document is
 * what makes Nest return 404 (rather than 410 or a live mutation) on direct
 * HTTP access. If any of these reappear, the 410-fence era is back and the
 * IdP-ownership boundary is broken.
 *
 * Kept-neighbor assertions guard against over-deletion in the same edit.
 *
 * Freshness note: this spec reads the committed `packages/docs/openapi.json`.
 * `openapi:check` (openapi-export.spec.ts) fails CI when that file drifts
 * from the live controllers, so a stale artifact cannot silently pass here.
 * Regenerate with `pnpm --filter @gideon-defender/api run openapi:export`.
 */
describe('Retired IdP-owned writers stay gone', () => {
  let operations: RouteEntry[] = [];

  beforeAll(() => {
    const specPath = resolve(
      __dirname,
      '../../../../packages/docs/openapi.json',
    );
    if (!existsSync(specPath)) {
      throw new Error(
        `OpenAPI spec not found at ${specPath}. ` +
          'Run `pnpm --filter @gideon-defender/api run openapi:export` to generate it.',
      );
    }
    let parsed: { paths?: Record<string, Record<string, Operation>> };
    try {
      parsed = JSON.parse(readFileSync(specPath, 'utf8')) as {
        paths?: Record<string, Record<string, Operation>>;
      };
    } catch (error) {
      throw new Error(
        `Failed to parse OpenAPI spec at ${specPath}: ${error instanceof Error ? error.message : String(error)}. ` +
          'Run `pnpm --filter @gideon-defender/api run openapi:export` to regenerate it.',
      );
    }
    if (!parsed.paths || typeof parsed.paths !== 'object') {
      throw new Error(
        `OpenAPI spec at ${specPath} has no paths object. ` +
          'Run `pnpm --filter @gideon-defender/api run openapi:export` to regenerate it.',
      );
    }
    operations = Object.entries(parsed.paths).flatMap(([path, item]) =>
      Object.entries(item).map(([method, operation]) => ({
        path,
        method,
        operationId: operation?.operationId ?? '',
      })),
    );
  });

  const hasOperation = (operationId: string): boolean =>
    operations.some((operation) => operation.operationId === operationId);

  const hasRoute = (method: string, path: string): boolean =>
    operations.some(
      (operation) => operation.method === method && operation.path === path,
    );

  it.each([
    'PeopleController_inviteMembers_v1',
    'PeopleController_createMember_v1',
    'PeopleController_bulkCreateMembers_v1',
    'PeopleController_updateMember_v1',
    'PeopleController_deleteMember_v1',
    'PeopleController_reactivateMember_v1',
    'PeopleController_resendPortalInvite_v1',
    'RolesController_createRole_v1',
    'RolesController_updateRole_v1',
    'RolesController_deleteRole_v1',
    'RolesController_updateBuiltInObligations_v1',
    'OrganizationController_transferOwnership_v1',
  ])('has no %s operation', (operationId) => {
    expect(hasOperation(operationId)).toBe(false);
  });

  it.each([
    ['post', '/v1/people/invite'],
    ['post', '/v1/people/bulk'],
    ['patch', '/v1/people/{id}/reactivate'],
    ['post', '/v1/people/{id}/resend-portal-invite'],
    ['post', '/v1/organization/transfer-ownership'],
  ])('has no %s %s route', (method, path) => {
    expect(hasRoute(method, path)).toBe(false);
  });

  it.each([
    ['get', '/v1/people'],
    ['get', '/v1/people/{id}'],
    ['patch', '/v1/people/{id}/unlink-device'],
    ['delete', '/v1/people/{id}/host/{hostId}'],
    ['get', '/v1/roles'],
    ['get', '/v1/roles/{roleId}'],
    ['get', '/v1/roles/built-in/{name}/obligations'],
    ['get', '/v1/roles/permissions'],
    ['patch', '/v1/organization'],
    ['delete', '/v1/organization'],
  ])('keeps %s %s', (method, path) => {
    expect(hasRoute(method, path)).toBe(true);
  });
});
