import { CloudSecurityLegacyController } from './cloud-security-legacy.controller';
import type { CloudSecurityLegacyService } from './cloud-security-legacy.service';

function makeController() {
  const legacyService = {
    connectLegacy: jest.fn().mockResolvedValue({ integrationId: 'int_1' }),
    validateAwsAccessKeys: jest
      .fn()
      .mockResolvedValue({ accountId: 'acc_1', regions: ['us-east-1'] }),
    disconnectLegacy: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new CloudSecurityLegacyController(
    legacyService as unknown as CloudSecurityLegacyService,
  );
  return { controller, legacyService };
}

describe('CloudSecurityLegacyController', () => {
  it('scopes connectLegacy to the authenticated organization', async () => {
    const { controller, legacyService } = makeController();

    const result = await controller.connectLegacy('org_1', {
      provider: 'aws',
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
    });

    expect(legacyService.connectLegacy).toHaveBeenCalledWith('org_1', 'aws', {
      accessKeyId: 'a',
      secretAccessKey: 'b',
    });
    expect(result).toEqual({ success: true, integrationId: 'int_1' });
  });

  it('returns the validated account id and regions', async () => {
    const { controller } = makeController();

    const result = await controller.validateAwsCredentials({
      accessKeyId: 'a',
      secretAccessKey: 'b',
    });

    expect(result).toEqual({
      success: true,
      accountId: 'acc_1',
      regions: ['us-east-1'],
    });
  });

  it('scopes disconnectLegacy to the authenticated organization', async () => {
    const { controller, legacyService } = makeController();

    const result = await controller.disconnectLegacy('int_1', 'org_1');

    expect(legacyService.disconnectLegacy).toHaveBeenCalledWith(
      'int_1',
      'org_1',
    );
    expect(result).toEqual({ success: true });
  });
});
