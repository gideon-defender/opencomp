const mockSend = jest.fn();
const mockIamCtor = jest.fn();

jest.mock('@aws-sdk/client-iam', () => {
  class IAMClient {
    send = mockSend;
    destroy = jest.fn();
    constructor(config: unknown) {
      mockIamCtor(config);
    }
  }
  class ListRolePoliciesCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class GetRolePolicyCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class ListAttachedRolePoliciesCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class GetPolicyCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class GetPolicyVersionCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    IAMClient,
    ListRolePoliciesCommand,
    GetRolePolicyCommand,
    ListAttachedRolePoliciesCommand,
    GetPolicyCommand,
    GetPolicyVersionCommand,
  };
});

import { readRemediatorRolePermissions } from './remediation-role-reader';

function policyDocument(
  statements: Array<{ Effect: string; Action: string | string[] }>,
): string {
  return encodeURIComponent(
    JSON.stringify({ Version: '2012-10-17', Statement: statements }),
  );
}

/** Healthy IAM: one inline allow, one attached deny. */
function healthyIam() {
  mockSend.mockImplementation((command: { constructor: { name: string } }) => {
    switch (command.constructor.name) {
      case 'ListRolePoliciesCommand':
        return { PolicyNames: ['inline-one'], IsTruncated: false };
      case 'GetRolePolicyCommand':
        return {
          PolicyDocument: policyDocument([
            { Effect: 'Allow', Action: 's3:GetObject' },
          ]),
        };
      case 'ListAttachedRolePoliciesCommand':
        return {
          AttachedPolicies: [
            {
              PolicyArn: 'arn:aws:iam::123:policy/attached',
              PolicyName: 'attached',
            },
          ],
          IsTruncated: false,
        };
      case 'GetPolicyCommand':
        return { Policy: { DefaultVersionId: 'v1' } };
      case 'GetPolicyVersionCommand':
        return {
          PolicyVersion: {
            Document: policyDocument([
              { Effect: 'Deny', Action: 's3:DeleteBucket' },
            ]),
          },
        };
      default:
        throw new Error(`unexpected command: ${command.constructor.name}`);
    }
  });
}

const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };

beforeEach(() => {
  mockSend.mockReset();
  mockIamCtor.mockClear();
  healthyIam();
});

describe('readRemediatorRolePermissions (wire layer)', () => {
  const roleName = 'OpenComp-Remediator-Storage-us-east-1';

  it('returns allowed actions and explicit denies', async () => {
    const { allowed, denied } = await readRemediatorRolePermissions({
      credentials,
      region: 'us-east-1',
      roleName,
    });
    expect(allowed.has('s3:GetObject')).toBe(true);
    expect(denied.has('s3:DeleteBucket')).toBe(true);
  });

  it('wires region and credentials into the IAM client', async () => {
    await readRemediatorRolePermissions({
      credentials,
      region: 'eu-west-1',
      roleName,
    });
    expect(mockIamCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'eu-west-1',
        credentials: expect.objectContaining({ accessKeyId: 'test' }),
      }),
    );
  });

  it('throws instead of reading the removed monolith role when no name is given', async () => {
    await expect(
      readRemediatorRolePermissions({
        credentials,
        region: 'us-east-1',
        roleName: undefined as unknown as string,
      }),
    ).rejects.toThrow(/pair role name is required/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('passes a custom role name through to IAM', async () => {
    await readRemediatorRolePermissions({
      credentials,
      region: 'us-east-1',
      roleName: 'Custom-Role',
    });
    const listCall = mockSend.mock.calls.find(
      (call) =>
        (call[0] as { constructor: { name: string } }).constructor.name ===
        'ListRolePoliciesCommand',
    );
    expect(
      (listCall?.[0] as unknown as { input: { RoleName: string } }).input
        .RoleName,
    ).toBe('Custom-Role');
  });

  it('degrades to deny-everything when an inline document is missing', async () => {
    mockSend.mockImplementation(
      (command: { constructor: { name: string } }) => {
        if (command.constructor.name === 'GetRolePolicyCommand') {
          return {};
        }
        if (command.constructor.name === 'ListAttachedRolePoliciesCommand') {
          return { AttachedPolicies: [], IsTruncated: false };
        }
        return { PolicyNames: ['inline-one'], IsTruncated: false };
      },
    );
    const onWarn = jest.fn();
    const { denied } = await readRemediatorRolePermissions({
      credentials,
      region: 'us-east-1',
      roleName: 'OpenComp-Remediator-Storage-us-east-1',
      onWarn,
    });
    // A missing document is an incomplete read, not an empty policy — the
    // hidden statements may contain an explicit Deny.
    expect(denied.has('*')).toBe(true);
    expect(onWarn).toHaveBeenCalled();
  });

  it('degrades to deny-everything when a managed policy has no default version', async () => {
    mockSend.mockImplementation(
      (command: { constructor: { name: string } }) => {
        switch (command.constructor.name) {
          case 'ListRolePoliciesCommand':
            return { PolicyNames: [], IsTruncated: false };
          case 'ListAttachedRolePoliciesCommand':
            return {
              AttachedPolicies: [
                {
                  PolicyArn: 'arn:aws:iam::123:policy/attached',
                  PolicyName: 'attached',
                },
              ],
              IsTruncated: false,
            };
          case 'GetPolicyCommand':
            return { Policy: {} };
          default:
            throw new Error(`unexpected command: ${command.constructor.name}`);
        }
      },
    );
    const onWarn = jest.fn();
    const { denied } = await readRemediatorRolePermissions({
      credentials,
      region: 'us-east-1',
      roleName: 'OpenComp-Remediator-Storage-us-east-1',
      onWarn,
    });
    expect(denied.has('*')).toBe(true);
    expect(onWarn).toHaveBeenCalled();
  });
});
