import { db } from '@db';
import { CheckrIntakeConfigService } from './checkr-intake-config.service';
import { SecretsService } from '../secrets/secrets.service';
import { CheckrIntakeClient } from './checkr-intake-client';

jest.mock('@db', () => ({
  db: { checkrIntakeConnection: { findFirst: jest.fn() } },
}));
jest.mock('./checkr-intake-client', () => ({ CheckrIntakeClient: jest.fn() }));

describe('Checkr intake tenant credentials', () => {
  const secrets = { getSecret: jest.fn() };
  const verifyAccount = jest.fn();
  const config = new CheckrIntakeConfigService(
    secrets as unknown as SecretsService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(CheckrIntakeClient)
      .mockImplementation(
        () => ({ verifyAccount }) as unknown as CheckrIntakeClient,
      );
    verifyAccount.mockResolvedValue(undefined);
  });

  it('fails closed without a tenant connection, irrespective of the legacy global key', async () => {
    jest.mocked(db.checkrIntakeConnection.findFirst).mockResolvedValue(null);
    await expect(config.client({ organizationId: 'tenant_b' })).rejects.toThrow(
      'not configured',
    );
    expect(secrets.getSecret).not.toHaveBeenCalled();
    expect(CheckrIntakeClient).not.toHaveBeenCalled();
  });

  it('resolves credentials only inside the connection’s authenticated tenant', async () => {
    jest.mocked(db.checkrIntakeConnection.findFirst).mockResolvedValue({
      id: 'conn_a',
      organizationId: 'tenant_a',
      apiKeySecretId: 'secret_a',
      accountId: 'account_a',
      package: 'basic',
      environment: 'sandbox',
      enabled: true,
      node: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    secrets.getSecret.mockResolvedValue({ value: 'tenant_a_key' });
    await config.client({ organizationId: 'tenant_a', connectionId: 'conn_a' });
    expect(db.checkrIntakeConnection.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'tenant_a', id: 'conn_a' },
    });
    expect(secrets.getSecret).toHaveBeenCalledWith('secret_a', 'tenant_a');
    expect(verifyAccount).toHaveBeenCalledWith('account_a');
  });
});
