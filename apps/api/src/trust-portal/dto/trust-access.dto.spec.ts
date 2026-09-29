import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateAccessRequestDto,
  DenyAccessRequestDto,
  RevokeGrantDto,
} from './trust-access.dto';
import { SignNdaDto } from './nda.dto';

function toAccessRequest(
  plain: Record<string, unknown>,
): CreateAccessRequestDto {
  return plainToInstance(CreateAccessRequestDto, plain);
}

const VALID_REQUEST = {
  name: 'Ada Lovelace',
  email: 'ada@company.com',
  company: 'Company',
  jobTitle: 'Security engineer',
  purpose: 'Vendor review',
};

describe('CreateAccessRequestDto length caps', () => {
  it('accepts values at the frontend limits', async () => {
    const dto = toAccessRequest({
      ...VALID_REQUEST,
      name: 'x'.repeat(100),
      company: 'x'.repeat(200),
      jobTitle: 'x'.repeat(200),
      purpose: 'x'.repeat(2000),
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an overlong name', async () => {
    const dto = toAccessRequest({ ...VALID_REQUEST, name: 'x'.repeat(101) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects overlong optional fields', async () => {
    const dto = toAccessRequest({
      ...VALID_REQUEST,
      company: 'x'.repeat(201),
      jobTitle: 'x'.repeat(201),
      purpose: 'x'.repeat(2001),
    });
    const errors = await validate(dto);
    const props = new Set(errors.map((e) => e.property));
    expect(props.has('company')).toBe(true);
    expect(props.has('jobTitle')).toBe(true);
    expect(props.has('purpose')).toBe(true);
  });
});

describe('SignNdaDto length cap', () => {
  it('rejects an overlong signer name', async () => {
    const dto = plainToInstance(SignNdaDto, {
      name: 'x'.repeat(101),
      email: 'ada@company.com',
      accept: true,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});

describe('Admin reason length caps', () => {
  it('rejects overlong deny and revoke reasons', async () => {
    const deny = plainToInstance(DenyAccessRequestDto, {
      reason: 'x'.repeat(2001),
    });
    const revoke = plainToInstance(RevokeGrantDto, {
      reason: 'x'.repeat(2001),
    });
    expect((await validate(deny)).some((e) => e.property === 'reason')).toBe(
      true,
    );
    expect((await validate(revoke)).some((e) => e.property === 'reason')).toBe(
      true,
    );
  });
});
