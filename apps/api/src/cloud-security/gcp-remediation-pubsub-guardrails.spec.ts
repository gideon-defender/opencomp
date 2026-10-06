import { validateGcpWriteStepParams } from './gcp-remediation-param-guardrails';
import { validateGcpPubSubWrite } from './gcp-remediation-pubsub-guardrails';

const PREFIX = 'Step 1 (POST /subscriptions/s:modifyPushConfig)';
const MODIFY_URL =
  'https://pubsub.googleapis.com/v1/projects/p/subscriptions/s:modifyPushConfig';

function write(args: Partial<Parameters<typeof validateGcpPubSubWrite>[0]>) {
  return validateGcpPubSubWrite({
    method: 'POST',
    pathname: '/v1/projects/p/subscriptions/s:modifyPushConfig',
    body: {},
    prefix: PREFIX,
    ...args,
  });
}

describe('validateGcpPubSubWrite', () => {
  it('refuses push redirection to an attacker endpoint', () => {
    const errors = write({
      body: { pushConfig: { pushEndpoint: 'https://attacker.example/hook' } },
      fixStep: { url: MODIFY_URL },
    });
    expect(errors.join(' ')).toMatch(/redirects topic data/);
  });

  it('refuses push redirection even with unrelated prior state', () => {
    const errors = write({
      body: { pushConfig: { pushEndpoint: 'https://attacker.example/hook' } },
      realState: {
        read: { pushConfig: { pushEndpoint: 'http://hooks.example.com/x' } },
      },
      readSteps: [{ purpose: 'read', url: MODIFY_URL }],
      fixStep: { url: MODIFY_URL },
    });
    expect(errors.join(' ')).toMatch(/redirects topic data/);
  });

  it('allows a same-host HTTP→HTTPS upgrade proven by bound prior state', () => {
    const errors = write({
      body: { pushConfig: { pushEndpoint: 'https://hooks.example.com/x' } },
      realState: {
        read: { pushConfig: { pushEndpoint: 'http://hooks.example.com/x' } },
      },
      readSteps: [{ purpose: 'read', url: MODIFY_URL }],
      fixStep: { url: MODIFY_URL },
    });
    expect(errors).toEqual([]);
  });

  it('refuses a same-host upgrade that changes the port', () => {
    // Port is part of the destination: `https://host:8443` is a different
    // listener than `http://host`, possibly attacker-controlled.
    const errors = write({
      body: {
        pushConfig: { pushEndpoint: 'https://hooks.example.com:8443/x' },
      },
      realState: {
        read: { pushConfig: { pushEndpoint: 'http://hooks.example.com/x' } },
      },
      readSteps: [{ purpose: 'read', url: MODIFY_URL }],
      fixStep: { url: MODIFY_URL },
    });
    expect(errors.join(' ')).toMatch(/redirects topic data/);
  });

  it('allows clearing the endpoint (pull delivery removes the call)', () => {
    const errors = write({ body: { pushConfig: { pushEndpoint: '' } } });
    expect(errors).toEqual([]);
  });

  it('refuses message injection on any publish-shaped write', () => {
    const errors = write({
      method: 'POST',
      pathname: '/v1/projects/p/topics/t:publish',
      body: { messages: [{ data: 'aGk=' }] },
    });
    expect(errors.join(' ')).toMatch(/injects data/);
  });

  it('refuses message consumption via :pull', () => {
    const errors = write({
      method: 'POST',
      pathname: '/v1/projects/p/subscriptions/s:pull',
      body: { maxMessages: 10 },
    });
    expect(errors.join(' ')).toMatch(/data-plane/);
  });

  it('refuses message deletion via :acknowledge', () => {
    const errors = write({
      method: 'POST',
      pathname: '/v1/projects/p/subscriptions/s:acknowledge',
      body: { ackIds: ['ack-1'] },
    });
    expect(errors.join(' ')).toMatch(/data-plane/);
  });

  it('refuses :seek and :modifyAckDeadline', () => {
    for (const action of [':seek', ':modifyAckDeadline']) {
      const errors = write({
        method: 'POST',
        pathname: `/v1/projects/p/subscriptions/s${action}`,
        body: {},
      });
      expect(errors.join(' ')).toMatch(/data-plane/);
    }
  });

  it('refuses streaming reads via :streamingPull', () => {
    const errors = write({
      method: 'POST',
      pathname: '/v1/projects/p/subscriptions/s:streamingPull',
      body: {},
    });
    expect(errors.join(' ')).toMatch(/data-plane/);
  });

  it('refuses topic and subscription creation (provisioning)', () => {
    for (const pathname of [
      '/v1/projects/p/topics',
      '/v1/projects/p/topics/t',
      '/v1/projects/p/subscriptions/s',
    ]) {
      const errors = write({
        method: 'POST',
        pathname,
        body: { labels: { env: 'prod' } },
      });
      expect(errors.join(' ')).toMatch(/provisioning/);
    }
  });

  it('still allows PATCH topic config without an action suffix', () => {
    const errors = write({
      method: 'PATCH',
      pathname: '/v1/projects/p/topics/t',
      body: { pushConfig: { pushEndpoint: '' } },
    });
    expect(errors).toEqual([]);
  });

  it('skips the provisioning refusal on the rollback replay path', () => {
    // POST replays are constrained by prior-state comparison instead —
    // refusing here would block every restore of a created topic.
    const errors = write({
      method: 'POST',
      pathname: '/v1/projects/p/topics/t',
      body: { labels: { env: 'prod' } },
      isRollback: true,
    });
    expect(errors).toEqual([]);
  });
});

describe('validateGcpWriteStepParams (pubsub wiring)', () => {
  function step(overrides: Record<string, unknown> = {}) {
    return {
      method: 'POST',
      url: MODIFY_URL,
      body: {},
      purpose: 'fix',
      ...overrides,
    } as Parameters<typeof validateGcpWriteStepParams>[0];
  }

  it('refuses push redirection through the dispatcher', () => {
    const errors = validateGcpWriteStepParams(
      step({
        body: { pushConfig: { pushEndpoint: 'https://attacker.example/hook' } },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/redirects topic data/);
  });
});
