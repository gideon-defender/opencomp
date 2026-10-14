import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { rolesGrantPermissions } from '../auth/app-access';
import { CandidateScreeningsController } from './candidate-screenings.controller';
import { StartCandidateScreeningDto } from './dto/start-candidate-screening.dto';

jest.mock('@db', () => ({ db: { organizationRole: { findMany: jest.fn() } } }));
// Contract tests inspect real permission metadata without starting session auth.
jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

describe('Candidate intake contract and permissions', () => {
  it('permits admins to screen and gives auditors read-only access', async () => {
    await expect(
      rolesGrantPermissions({
        organizationId: 'tenant_a',
        roles: ['admin'],
        required: { backgroundCheck: ['create'] },
      }),
    ).resolves.toBe(true);
    await expect(
      rolesGrantPermissions({
        organizationId: 'tenant_a',
        roles: ['auditor'],
        required: { backgroundCheck: ['create'] },
      }),
    ).resolves.toBe(false);
    await expect(
      rolesGrantPermissions({
        organizationId: 'tenant_a',
        roles: ['auditor'],
        required: { backgroundCheck: ['read'] },
      }),
    ).resolves.toBe(true);
  });

  it('requires screening permission rather than legacy member-create permission', () => {
    expect(
      Reflect.getMetadata(
        'required_permissions',
        CandidateScreeningsController.prototype.start,
      ),
    ).toEqual([{ resource: 'backgroundCheck', actions: ['create'] }]);
  });

  it('normalizes email and rejects tenant, roles, and portal-email fields', async () => {
    const dto = plainToInstance(StartCandidateScreeningDto, {
      operationId: 'd99e647c-a4ac-4ff1-b5b5-ddd96f7f423a',
      firstName: ' Ada ',
      lastName: ' Lovelace ',
      email: ' A@B.COM ',
      country: 'US',
      state: 'CA',
      roles: ['owner'],
      organizationId: 'tenant_b',
      sendPortalEmail: true,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((error) => error.property).sort()).toEqual([
      'organizationId',
      'roles',
      'sendPortalEmail',
    ]);
    expect(dto.email).toBe('a@b.com');
    expect(dto.firstName).toBe('Ada');
  });

  it('requires work state for US invitations', async () => {
    const dto = plainToInstance(StartCandidateScreeningDto, {
      operationId: 'd99e647c-a4ac-4ff1-b5b5-ddd96f7f423a',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'a@b.com',
      country: 'US',
    });
    expect((await validate(dto)).map((error) => error.property)).toContain(
      'state',
    );
  });
});
