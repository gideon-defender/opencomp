import { buildAzurePreviewResponse } from './azure-remediation-responses';
import type { AzureFixPlan } from './azure-ai-remediation.prompt';

function plan(): AzureFixPlan {
  return {
    canAutoFix: true,
    risk: 'low',
    description: 'fix',
    currentState: {},
    proposedState: {},
    readSteps: [],
    fixSteps: [
      {
        method: 'PATCH',
        url: 'https://management.azure.com/subscriptions/s/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa',
        queryParams: { 'api-version': '2023-05-01' },
        body: { properties: { supportsHttpsTrafficOnly: true } },
        purpose: 'fix',
      },
    ],
    rollbackSteps: [
      {
        method: 'PATCH',
        url: 'https://management.azure.com/subscriptions/s/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01',
        body: { properties: { supportsHttpsTrafficOnly: false } },
        purpose: 'undo',
      },
    ],
    rollbackSupported: true,
    requiresAcknowledgment: true,
    acknowledgmentMessage: 'ack',
  };
}

describe('buildAzurePreviewResponse', () => {
  it('shows the effective URL the wire sees, not the raw step URL', () => {
    const response = buildAzurePreviewResponse(plan());
    expect(response.apiCalls).toHaveLength(1);
    // queryParams merge into the displayed endpoint: the user approves
    // the exact request string the executor sends.
    expect(response.apiCalls[0]).toMatchObject({
      method: 'PATCH',
      endpoint:
        'https://management.azure.com/subscriptions/s/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01',
      purpose: 'fix',
    });
  });

  it('shows bodies and rollback writes under the same acknowledgment', () => {
    const response = buildAzurePreviewResponse(plan());
    expect(response.apiCalls[0]).toMatchObject({
      body: { properties: { supportsHttpsTrafficOnly: true } },
    });
    expect(response.rollbackCalls).toHaveLength(1);
    expect(response.rollbackCalls[0]).toMatchObject({
      method: 'PATCH',
      purpose: 'undo',
      body: { properties: { supportsHttpsTrafficOnly: false } },
    });
  });
});
