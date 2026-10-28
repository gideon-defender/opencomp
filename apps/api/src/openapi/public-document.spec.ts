import {
  canonicalDocument,
  OPERATION_ID_CLASS_ALIASES,
  publicOperationIdFactory,
} from './public-document';

describe('public spec canonicalization', () => {
  it('ignores object key order but retains nested schema constraints and route changes', () => {
    expect(canonicalDocument({ b: 2, a: { x: 1, y: 2 } })).toBe(
      canonicalDocument({ a: { y: 2, x: 1 }, b: 2 }),
    );
    expect(canonicalDocument({ schema: { minimum: 1 } })).not.toBe(
      canonicalDocument({ schema: { minimum: 2 } }),
    );
    expect(canonicalDocument({ paths: { '/v1/tasks': {} } })).not.toBe(
      canonicalDocument({ paths: { '/v1/other': {} } }),
    );
  });
  it('does not reorder arrays or drop null and optional-looking properties', () => {
    expect(canonicalDocument({ values: ['a', 'b'] })).not.toBe(
      canonicalDocument({ values: ['b', 'a'] }),
    );
    expect(canonicalDocument({ value: null })).not.toBe(canonicalDocument({}));
    expect(canonicalDocument({ additionalProperties: false })).not.toBe(
      canonicalDocument({}),
    );
  });
});

describe('public operationId factory', () => {
  it('pins every renamed cloud-security controller to the pre-split operationId', () => {
    expect(
      publicOperationIdFactory('CloudSecurityScanController', 'scan', '1'),
    ).toBe('CloudSecurityController_scan_1');
    expect(
      publicOperationIdFactory('CloudSecurityGcpController', 'setupGcp', '1'),
    ).toBe('CloudSecurityController_setupGcp_1');
    expect(
      publicOperationIdFactory(
        'CloudSecurityAzureValidateController',
        'validateAzure',
        '1',
      ),
    ).toBe('CloudSecurityController_validateAzure_1');
  });

  it('leaves controllers without an alias unchanged', () => {
    expect(publicOperationIdFactory('TasksController', 'list', '1')).toBe(
      'TasksController_list_1',
    );
    expect(publicOperationIdFactory('TasksController', 'list')).toBe(
      'TasksController_list',
    );
  });

  it('maps each aliased controller class to the CloudSecurityController name', () => {
    const targets = new Set(Object.values(OPERATION_ID_CLASS_ALIASES));
    expect([...targets]).toEqual(['CloudSecurityController']);
  });
});
