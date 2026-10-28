import { CloudSecurityAzureValidateController } from './cloud-security-azure-validate.controller';
import type { CloudSecurityService } from './cloud-security.service';
import type { AzureSecurityService } from './providers/azure-security.service';

type Services = {
  cloudSecurityService: { getConnectionForDetect: jest.Mock };
  azureSecurityService: { getAccessToken: jest.Mock };
};

function makeController(connection: {
  credentials: Record<string, unknown>;
  variables?: Record<string, unknown>;
}) {
  const services: Services = {
    cloudSecurityService: {
      getConnectionForDetect: jest.fn().mockResolvedValue(connection),
    },
    azureSecurityService: {
      getAccessToken: jest.fn().mockResolvedValue('access-token'),
    },
  };

  const controller = new CloudSecurityAzureValidateController(
    services.cloudSecurityService as unknown as CloudSecurityService,
    services.azureSecurityService as unknown as AzureSecurityService,
  );
  return { controller, services };
}

function stubFetch(ok: boolean) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 403,
    text: async () => 'upstream-correlation-id-leak',
  });
  jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
  return fetchMock;
}

const VALID_SUB = '12345678-1234-1234-1234-123456789012';

describe('CloudSecurityAzureValidateController.validateAzure', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a subscription step error when the stored id is malformed', async () => {
    const fetchMock = stubFetch(true);
    const { controller } = makeController({
      credentials: { tenantId: 't', clientId: 'c', clientSecret: 's' },
      variables: { subscription_id: '../traversal' },
    });

    const result = await controller.validateAzure('conn_1', 'org_1');

    expect(result.subscriptionId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not echo the raw Azure error body to the caller', async () => {
    stubFetch(false);
    const { controller } = makeController({
      credentials: { subscriptionId: VALID_SUB },
    });

    const result = await controller.validateAzure('conn_1', 'org_1');
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('upstream-correlation-id-leak');
  });

  it('reports success steps when Azure accepts the subscription', async () => {
    stubFetch(true);
    const { controller } = makeController({
      credentials: { subscriptionId: VALID_SUB },
    });

    const result = await controller.validateAzure('conn_1', 'org_1');

    expect(result.subscriptionId).toBe(VALID_SUB);
    expect(result.steps.every((s) => s.success)).toBe(true);
  });
});
