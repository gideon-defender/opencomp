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
  tools: 'update-organization,transfer-ownership',
  field: '',
  keyword: 'additionalProperties',
  value: false,
});
add({
  tools: 'create-member,get-all-risks,create-risk,create-task',
  field: `${direct}/department`,
  keyword: 'maxLength',
  value: 64,
});
// Nullable fields carry constraints on their non-null branch.
entries.find((item) => item.tool === 'create-task').path =
  '/properties/request/properties/department/anyOf/0/maxLength';
add({
  tools: 'bulk-create-members',
  field: 'properties/members/items/properties/department',
  keyword: 'maxLength',
  value: 64,
});
add({
  tools: 'update-member,update-risk,create-policy,update-policy,update-task',
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
for (const [keyword, value] of [
  ['minLength', 2],
  ['maxLength', 50],
]) {
  add({ tools: 'create-role', field: `${direct}/name`, keyword, value });
  add({ tools: 'update-role', field: `${body}/name`, keyword, value });
}
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
export const reviewedSchemaDeltas = entries.map((item) => ({
  ...item,
  path: item.path.replace('request//', 'request/'),
}));
