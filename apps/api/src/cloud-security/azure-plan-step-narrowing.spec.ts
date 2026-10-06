import { narrowToAzureApiSteps } from './azure-plan-step-validation';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const STORAGE_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`;

describe('narrowToAzureApiSteps', () => {
  it('narrows well-formed steps and defaults the purpose', () => {
    expect(
      narrowToAzureApiSteps([
        { method: 'PATCH', url: STORAGE_URL, body: { a: 1 }, purpose: 'fix' },
      ]),
    ).toEqual([
      {
        method: 'PATCH',
        url: STORAGE_URL,
        body: { a: 1 },
        purpose: 'fix',
      },
    ]);
  });

  it('fails closed on attacker-shaped stored state', () => {
    expect(narrowToAzureApiSteps(null)).toBeUndefined();
    expect(narrowToAzureApiSteps({})).toBeUndefined();
    expect(narrowToAzureApiSteps([null])).toBeUndefined();
    expect(
      narrowToAzureApiSteps([{ method: 'BREW', url: STORAGE_URL }]),
    ).toBeUndefined();
    expect(narrowToAzureApiSteps([{ method: 'PUT', url: '' }])).toBeUndefined();
    expect(
      narrowToAzureApiSteps([{ method: 'PUT', url: STORAGE_URL, body: [] }]),
    ).toEqual([{ method: 'PUT', url: STORAGE_URL, purpose: '' }]);
    expect(
      narrowToAzureApiSteps([
        {
          method: 'PUT',
          url: STORAGE_URL,
          queryParams: { 'api-version': 5 },
        },
      ]),
    ).toBeUndefined();
  });
});
