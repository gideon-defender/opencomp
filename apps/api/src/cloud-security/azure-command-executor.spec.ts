import type { AzureApiStep } from './azure-ai-remediation.prompt';
import { validateAzurePlanSteps } from './azure-command-executor';

function step(overrides: Partial<AzureApiStep>): AzureApiStep {
  return {
    method: 'PATCH',
    url: 'https://management.azure.com/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/name?api-version=2023-05-01',
    purpose: 'test step',
    ...overrides,
  };
}

const ASSIGNMENT_URL =
  'https://management.azure.com/subscriptions/sub/providers/Microsoft.Authorization/roleAssignments/abc?api-version=2022-04-01';

describe('validateAzurePlanSteps — role assignment grants', () => {
  it('refuses PUT role assignments (self-escalation, never a fix)', () => {
    const errors = validateAzurePlanSteps([
      step({ method: 'PUT', url: ASSIGNMENT_URL }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Cannot grant Azure role assignments/),
      ]),
    );
  });

  it('refuses PATCH and POST role assignments too', () => {
    for (const method of ['PATCH', 'POST'] as const) {
      const errors = validateAzurePlanSteps([
        step({ method, url: ASSIGNMENT_URL }),
      ]);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Cannot grant Azure role assignments/),
        ]),
      );
    }
  });

  it('refuses mixed-case and percent-encoded role assignment URLs', () => {
    const mixedCase = ASSIGNMENT_URL.replace(
      '/providers/Microsoft.Authorization/roleAssignments/',
      '/providers/microsoft.authorization/roleassignments/',
    );
    const encoded = ASSIGNMENT_URL.replace(
      '/providers/Microsoft.Authorization/roleAssignments/',
      '/providers/Microsoft.Authorization/%72oleAssignments/',
    );
    for (const url of [mixedCase, encoded]) {
      const errors = validateAzurePlanSteps([step({ method: 'PUT', url })]);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Cannot grant Azure role assignments/),
        ]),
      );
    }
  });

  it('refuses mixed-case role definition edits', () => {
    const errors = validateAzurePlanSteps([
      step({
        method: 'PATCH',
        url: 'https://management.azure.com/sub/providers/microsoft.authorization/roledefinitions/abc?api-version=2022-04-01',
      }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Cannot modify built-in role definitions/),
      ]),
    );
  });

  it('allows reading and removing role assignments', () => {
    // Reads inspect current assignments; DELETE only narrows access.
    expect(
      validateAzurePlanSteps([step({ method: 'GET', url: ASSIGNMENT_URL })]),
    ).toEqual([]);
    expect(
      validateAzurePlanSteps([step({ method: 'DELETE', url: ASSIGNMENT_URL })]),
    ).toEqual([]);
  });

  it('still refuses subscription deletes and role-definition edits', () => {
    expect(
      validateAzurePlanSteps([
        step({
          method: 'DELETE',
          url: 'https://management.azure.com/subscriptions/sub?api-version=2022-04-01',
        }),
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Cannot delete a subscription/),
      ]),
    );
    expect(
      validateAzurePlanSteps([
        step({
          method: 'PATCH',
          url: 'https://management.azure.com/sub/providers/Microsoft.Authorization/roleDefinitions/abc?api-version=2022-04-01',
        }),
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Cannot modify built-in role definitions/),
      ]),
    );
  });
});
