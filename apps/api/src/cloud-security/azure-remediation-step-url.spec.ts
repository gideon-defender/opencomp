import {
  buildEffectiveAzureStepUrl,
  extractAzureResourceGroup,
  extractAzureStepSubscriptionId,
} from './azure-remediation-step-url';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const STORAGE_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`;

describe('buildEffectiveAzureStepUrl', () => {
  it('merges queryParams into the URL', () => {
    expect(
      buildEffectiveAzureStepUrl({
        url: STORAGE_URL.split('?')[0],
        queryParams: { 'api-version': '2023-05-01' },
      }),
    ).toBe(STORAGE_URL);
  });

  it('returns the raw URL when unparseable', () => {
    expect(buildEffectiveAzureStepUrl({ url: 'not a url' })).toBe('not a url');
  });
});

describe('extractAzureStepSubscriptionId', () => {
  it('extracts case-insensitively', () => {
    expect(extractAzureStepSubscriptionId(STORAGE_URL)).toBe(SUB);
    expect(
      extractAzureStepSubscriptionId(
        STORAGE_URL.replace('/subscriptions/', '/SUBSCRIPTIONS/'),
      ),
    ).toBe(SUB);
  });

  it('returns undefined without a subscription scope', () => {
    expect(
      extractAzureStepSubscriptionId('https://graph.microsoft.com/v1.0/users'),
    ).toBeUndefined();
    expect(extractAzureStepSubscriptionId('garbage')).toBeUndefined();
  });

  it('resolves percent-encoded scope keys', () => {
    expect(
      extractAzureStepSubscriptionId(
        STORAGE_URL.replace('/subscriptions/', '/%73ubscriptions/'),
      ),
    ).toBe(SUB);
    expect(
      extractAzureStepSubscriptionId(
        STORAGE_URL.replace('/subscriptions/', '/%2573ubscriptions/'),
      ),
    ).toBe(SUB);
  });
});

describe('extractAzureResourceGroup', () => {
  it('extracts the resource group from an ARM id', () => {
    expect(
      extractAzureResourceGroup(
        `/subscriptions/${SUB}/resourceGroups/myRg/providers/Microsoft.Storage/storageAccounts/sa`,
      ),
    ).toBe('myRg');
  });

  it('returns undefined for subscription-scoped ids', () => {
    expect(extractAzureResourceGroup(`/subscriptions/${SUB}`)).toBeUndefined();
  });

  it('resolves percent-encoded resourceGroups keys', () => {
    expect(
      extractAzureResourceGroup(
        `/subscriptions/${SUB}/%72esourceGroups/myRg/providers/Microsoft.Storage/storageAccounts/sa`,
      ),
    ).toBe('myRg');
  });
});
