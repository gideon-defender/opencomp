import assert from 'node:assert/strict';

// Additive API contracts have no generated predecessor. Preserve the frozen
// 412-tool oracle and require these exact additions alongside full old parity.
export const reviewedToolAdditions = [
  {
    name: 'check-candidate-screening-readiness',
    method: 'get',
    path: '/v1/people/candidate-screenings/readiness',
    operationId: 'CandidateScreeningsController_readiness_v1',
  },
  {
    name: 'check-checkr-connection-readiness',
    method: 'get',
    path: '/v1/people/candidate-screenings/connection/readiness',
    operationId: 'CandidateScreeningsController_connectionReadiness_v1',
  },
  {
    name: 'list-candidate-screenings',
    method: 'get',
    path: '/v1/people/candidate-screenings',
    operationId: 'CandidateScreeningsController_list_v1',
  },
  {
    name: 'get-candidate-screening',
    method: 'get',
    path: '/v1/people/candidate-screenings/{id}',
    operationId: 'CandidateScreeningsController_get_v1',
  },
  {
    name: 'start-candidate-screening',
    method: 'post',
    path: '/v1/people/candidate-screenings',
    operationId: 'CandidateScreeningsController_start_v1',
  },
  {
    name: 'configure-checkr-candidate-intake',
    method: 'put',
    path: '/v1/people/candidate-screenings/connection',
    operationId: 'CandidateScreeningsController_configure_v1',
  },
];

export function assertReviewedRegistry({ tools, baseline }) {
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      ...baseline.tools.map((tool) => tool.name),
      ...reviewedToolAdditions.map((tool) => tool.name),
    ].sort(),
  );
  for (const addition of reviewedToolAdditions) {
    const tool = tools.find((item) => item.name === addition.name);
    for (const field of ['method', 'path', 'operationId'])
      assert.equal(tool[field], addition[field], addition.name);
  }
}
