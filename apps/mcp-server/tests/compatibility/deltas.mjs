// Reviewed against current OpenAPI and Phase 0. Exact tool/path/old/new values;
// a new constraint, weakening, rename, or stale expectation fails the parity gate.
const entries = [];
function add({ tools, field, keyword, value, before }) {
  for (const tool of tools.split(','))
    entries.push({ tool, path: `/properties/request/${field}/${keyword}`, before, after: value });
}
const direct = 'properties';
const body = 'properties/body/properties';
add({
  tools: 'update-organization',
  field: '',
  keyword: 'additionalProperties',
  value: false,
});
add({
  tools: 'get-all-risks,create-risk,create-task',
  field: `${direct}/department`,
  keyword: 'maxLength',
  value: 64,
});
// Nullable fields carry constraints on their non-null branch.
entries.find((item) => item.tool === 'create-task').path =
  '/properties/request/properties/department/anyOf/0/maxLength';
add({
  tools: 'update-risk,create-policy,update-policy,update-task',
  field: `${body}/department`,
  keyword: 'maxLength',
  value: 64,
});
for (const [field, value] of [
  ['description', 500],
  ['fileName', 255],
]) {
  add({ tools: 'create-attachment', field: `${direct}/${field}`, keyword: 'maxLength', value });
  add({
    tools: 'upload-employment-evidence,upload-task-attachment,upload-evidence',
    field: `${body}/${field}`,
    keyword: 'maxLength',
    value,
  });
  add({
    tools: 'create-comment',
    field: `properties/attachments/items/properties/${field}`,
    keyword: 'maxLength',
    value,
  });
}
add({ tools: 'get-all-risks', field: `${direct}/page`, keyword: 'minimum', value: 1 });
for (const [keyword, value] of [
  ['minimum', 1],
  ['maximum', 250],
])
  add({ tools: 'get-all-risks', field: `${direct}/perPage`, keyword, value });
for (const [field, value] of [
  ['content', 50000],
  ['contextUrl', 2048],
]) {
  add({ tools: 'create-comment', field: `${direct}/${field}`, keyword: 'maxLength', value });
  add({ tools: 'update-comment', field: `${body}/${field}`, keyword: 'maxLength', value });
}
for (const index of [0, 1])
  add({
    tools: 'update-custom-framework',
    field: `anyOf/${index}/properties/customFrameworkId`,
    keyword: 'minLength',
    value: 1,
  });
for (const [field, value] of [
  ['overviewContent', 10000],
  ['overviewTitle', 200],
])
  add({
    tools: 'update-overview',
    field: `${direct}/${field}/anyOf/0`,
    keyword: 'maxLength',
    value,
  });
add({
  tools: 'create-custom-link',
  field: `${direct}/description/anyOf/0`,
  keyword: 'maxLength',
  value: 500,
});
for (const [field, keyword, value] of [
  ['title', 'minLength', 1],
  ['title', 'maxLength', 100],
  ['url', 'maxLength', 2000],
  ['url', 'format', 'uri'],
])
  add({ tools: 'create-custom-link', field: `${direct}/${field}`, keyword, value });
for (const [field, value] of [
  ['company', 200],
  ['jobTitle', 200],
  ['name', 100],
  ['purpose', 2000],
])
  add({ tools: 'create-access-request', field: `${body}/${field}`, keyword: 'maxLength', value });
for (const [keyword, value] of [
  ['minimum', 1],
  ['maximum', 365],
]) {
  add({ tools: 'create-access-request', field: `${body}/requestedDurationDays`, keyword, value });
  add({ tools: 'approve-request', field: `${body}/durationDays`, keyword, value });
}
add({
  tools: 'deny-request,revoke-grant',
  field: `${body}/reason`,
  keyword: 'maxLength',
  value: 2000,
});
add({ tools: 'create-finding', field: `${direct}/content`, keyword: 'maxLength', value: 5000 });
add({ tools: 'update-finding', field: `${body}/content`, keyword: 'maxLength', value: 5000 });
add({
  tools: 'answer-single-question',
  field: `${direct}/questionIndex`,
  keyword: 'minimum',
  value: 0,
});
add({
  tools: 'answer-single-question',
  field: `${direct}/totalQuestions`,
  keyword: 'minimum',
  value: 1,
});
add({
  tools: 'create-row,update-row',
  field: `${body}/position`,
  keyword: 'minimum',
  before: -9007199254740991,
  value: 0,
});
for (const [keyword, value] of [
  ['minItems', 1],
  ['maxItems', 200],
])
  add({ tools: 'bulk-create-measurements', field: `${body}/measurements`, keyword, value });
for (const [field, keyword, value] of [
  ['limit', 'minimum', 1],
  ['limit', 'maximum', 100],
  ['page', 'minimum', 1],
])
  add({ tools: 'get-task-items', field: `${direct}/${field}`, keyword, value });
add({
  tools: 'upload-task-item-attachment',
  field: `${direct}/fileName`,
  keyword: 'maxLength',
  value: 255,
});
add({ tools: 'add-frameworks', field: `${direct}/frameworkIds`, keyword: 'minItems', value: 1 });
add({
  tools: 'security-penetration-tests-create',
  field: `${body}/additionalContext`,
  keyword: 'maxLength',
  value: 4000,
});
add({
  tools: 'set-pentest-finding-context',
  field: `${body}/context`,
  keyword: 'maxLength',
  value: 2000,
});
// Reviewed evolution: get-permissions-for-roles declares its `roles` query
// input explicitly (custom roles branch). The generated baseline inferred the
// parameter with no description; the owned spec documents the format + limit.
add({
  tools: 'get-permissions-for-roles',
  field: `${direct}/roles`,
  keyword: 'description',
  value:
    'Comma-separated role names (or repeated roles params), e.g. admin,Compliance Lead. Max 100 names.',
});
// Reviewed evolution: get-activity gained its optional `take` query parameter
// (1-100, default 30). The frozen Phase 0 baseline predates it.
entries.push({
  tool: 'get-activity',
  path: '/properties/request/properties/take',
  before: undefined,
  after: {
    type: 'string',
    description: 'Number of activity records to return (1-100, default 30)',
  },
});
// Reviewed evolution: EmailPreferencesDto gained optional findingNotifications.
// Phase 0 baseline has 6 keys; current spec has 7.
entries.push({
  tool: 'update-email-preferences',
  path: '/properties/request/properties/preferences/properties/findingNotifications',
  before: undefined,
  after: { type: 'boolean' },
});
// Reviewed evolution: provider and identifying DTO fields are now string schemas.
for (const [tool, path, before] of [
  ['set-employee-sync-provider', '/properties/request/properties/provider/anyOf/0/type', 'object'],
  ['set-two-factor-source', '/properties/request/properties/provider/anyOf/0/type', 'object'],
  [
    'update-finding',
    '/properties/request/properties/body/properties/revisionNote/anyOf/0/type',
    'object',
  ],
  [
    'update-task-item',
    '/properties/request/properties/body/properties/assigneeId/anyOf/0/type',
    'object',
  ],
  [
    'update-vendor',
    '/properties/request/properties/body/properties/treatmentStrategyDescription/type',
    'object',
  ],
]) {
  entries.push({ tool, path, before, after: 'string' });
}
entries.push({
  tool: 'update-finding',
  path: '/properties/request/properties/body/properties/revisionNote/anyOf/0/maxLength',
  before: undefined,
  after: 2000,
});
// Reviewed evolution: get-primary-color now exposes the token name as a string.
entries.push({
  tool: 'get-primary-color',
  path: '/properties/request/properties/token/type',
  before: undefined,
  after: 'string',
});
// Reviewed evolution: the three GCP setup bodies moved from inline @Body()
// parameter types (invisible to OpenAPI) to DTO classes in the cloud-security
// controller split. These endpoints already required the bodies at runtime
// (missing or invalid payloads were rejected); the spec now documents them
// and the request envelope marks `body` required. setup-gcp keeps every body
// field optional — only the envelope is required.
for (const [tool, after] of [
  [
    'setup-gcp',
    {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            'GCP project to enable the Security Command Center APIs on. Defaults to the first explicitly selected project for this connection.',
        },
      },
    },
  ],
  [
    'select-gcp-projects',
    {
      type: 'object',
      properties: {
        projectIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'GCP project IDs to scan for this connection. Replaces the previous selection.',
        },
        projectNames: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Project display names keyed by project ID and project number; surfaced on findings.',
        },
        gcpOrganizationId: {
          type: 'string',
          description: 'GCP organization resource ID (numeric) to scope the connection to.',
        },
      },
      required: ['projectIds'],
    },
  ],
  [
    'resolve-gcp-setup-step',
    {
      type: 'object',
      properties: {
        stepId: {
          description:
            'Setup step to resolve — use the id from the failed step in the setup-gcp response.',
          type: 'string',
          enum: [
            'enable_cloud_resource_manager_api',
            'enable_security_command_center_api',
            'enable_service_usage_api',
            'grant_findings_viewer_role',
          ],
        },
      },
      required: ['stepId'],
    },
  ],
]) {
  entries.push({ tool, path: '/properties/request/properties/body', before: undefined, after });
  entries.push({
    tool,
    path: '/properties/request/required',
    before: ['connectionId'],
    after: ['body', 'connectionId'],
  });
}
export const reviewedSchemaDeltas = entries.map((item) => ({
  ...item,
  path: item.path.replace('request//', 'request/'),
}));
