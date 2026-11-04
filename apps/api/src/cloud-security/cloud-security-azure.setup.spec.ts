import { CloudSecurityAzureController } from './cloud-security-azure.controller';
import type { CloudSecurityService } from './cloud-security.service';
import type { AzureSecurityService } from './providers/azure-security.service';

// Real Azure subscription ids are GUIDs — use the real shape so the
// subscription-id validation is exercised the same way it is in production.
const SUB_SAVED = '11111111-1111-1111-1111-111111111111';
const SUB_FIRST = '22222222-2222-2222-2222-222222222222';
const SUB_GONE = '33333333-3333-3333-3333-333333333333';

type Services = {
  cloudSecurityService: {
    getConnectionForDetect: jest.Mock;
    saveConnectionVariable: jest.Mock;
  };
  azureSecurityService: { detectSubscriptions: jest.Mock };
};

function makeController(variables: Record<string, unknown>) {
  const services: Services = {
    cloudSecurityService: {
      getConnectionForDetect: jest.fn().mockResolvedValue({
        credentials: { access_token: 'token' },
        variables,
      }),
      saveConnectionVariable: jest.fn().mockResolvedValue(undefined),
    },
    azureSecurityService: {
      detectSubscriptions: jest.fn().mockResolvedValue([]),
    },
  };

  const controller = new CloudSecurityAzureController(
    services.cloudSecurityService as unknown as CloudSecurityService,
    services.azureSecurityService as unknown as AzureSecurityService,
  );
  return { controller, services };
}

function stubAzureFetch() {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ value: [{ actions: ['*'], notActions: [] }] }),
  });
  jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
  return fetchMock;
}

describe('CloudSecurityAzureController.setupAzure subscription handling', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = stubAzureFetch();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps a saved, still-accessible subscription instead of re-pinning subs[0]', async () => {
    const { controller, services } = makeController({
      subscription_id: SUB_SAVED,
    });
    services.azureSecurityService.detectSubscriptions.mockResolvedValue([
      { id: SUB_FIRST, displayName: 'First' },
      { id: SUB_SAVED, displayName: 'Saved' },
    ]);

    const result = await controller.setupAzure('conn_1', 'org_1');

    expect(result.subscriptionId).toBe(SUB_SAVED);
    expect(result.subscriptionName).toBe('Saved');
    // The user's deliberate choice is not overwritten.
    expect(
      services.cloudSecurityService.saveConnectionVariable,
    ).not.toHaveBeenCalled();
    // Verification runs against the saved subscription.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/subscriptions/${SUB_SAVED}/`),
      expect.anything(),
    );
  });

  it('persists the first detected subscription when none was saved', async () => {
    const { controller, services } = makeController({});
    services.azureSecurityService.detectSubscriptions.mockResolvedValue([
      { id: SUB_FIRST, displayName: 'First' },
    ]);

    const result = await controller.setupAzure('conn_1', 'org_1');

    expect(result.subscriptionId).toBe(SUB_FIRST);
    expect(
      services.cloudSecurityService.saveConnectionVariable,
    ).toHaveBeenCalledWith('conn_1', 'subscription_id', SUB_FIRST, 'org_1');
  });

  it('falls back to a detected subscription when the saved one is no longer accessible', async () => {
    const { controller, services } = makeController({
      subscription_id: SUB_GONE,
    });
    services.azureSecurityService.detectSubscriptions.mockResolvedValue([
      { id: SUB_FIRST, displayName: 'First' },
    ]);

    const result = await controller.setupAzure('conn_1', 'org_1');

    expect(result.subscriptionId).toBe(SUB_FIRST);
    expect(
      services.cloudSecurityService.saveConnectionVariable,
    ).toHaveBeenCalledWith('conn_1', 'subscription_id', SUB_FIRST, 'org_1');
  });

  it('keeps the saved subscription when detection fails', async () => {
    const { controller, services } = makeController({
      subscription_id: SUB_SAVED,
    });
    services.azureSecurityService.detectSubscriptions.mockRejectedValue(
      new Error('boom'),
    );

    const result = await controller.setupAzure('conn_1', 'org_1');

    expect(result.subscriptionId).toBe(SUB_SAVED);
    expect(
      services.cloudSecurityService.saveConnectionVariable,
    ).not.toHaveBeenCalled();
    expect(
      result.steps.some((s) => !s.success && s.name === 'Detect subscription'),
    ).toBe(true);
  });

  it('does not persist anything when no subscriptions are detected', async () => {
    const { controller, services } = makeController({});
    services.azureSecurityService.detectSubscriptions.mockResolvedValue([]);

    const result = await controller.setupAzure('conn_1', 'org_1');

    expect(result.subscriptionId).toBeUndefined();
    expect(
      services.cloudSecurityService.saveConnectionVariable,
    ).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
