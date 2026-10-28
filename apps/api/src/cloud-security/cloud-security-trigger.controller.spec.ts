import { HttpException, HttpStatus } from '@nestjs/common';
import { CloudSecurityTriggerController } from './cloud-security-trigger.controller';
import {
  ConnectionNotFoundError,
  type CloudSecurityService,
} from './cloud-security.service';

function makeController() {
  const service = {
    triggerScan: jest.fn().mockResolvedValue({ runId: 'run_1' }),
    getRunStatus: jest.fn().mockResolvedValue({ status: 'running' }),
  };
  const controller = new CloudSecurityTriggerController(
    service as unknown as CloudSecurityService,
  );
  return { controller, service };
}

describe('CloudSecurityTriggerController', () => {
  it('returns the trigger result', async () => {
    const { controller } = makeController();
    await expect(controller.triggerScan('conn_1', 'org_1')).resolves.toEqual({
      runId: 'run_1',
    });
  });

  it('rejects getRunStatus without a connectionId', async () => {
    const { controller } = makeController();

    const error = await controller
      .getRunStatus('run_1', '', 'org_1')
      .catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('maps ConnectionNotFoundError to a 404', async () => {
    const { controller, service } = makeController();
    service.getRunStatus.mockRejectedValueOnce(new ConnectionNotFoundError());

    const error = await controller
      .getRunStatus('run_1', 'conn_1', 'org_1')
      .catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
  });
});
