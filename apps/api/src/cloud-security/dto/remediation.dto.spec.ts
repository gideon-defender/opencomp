import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateBatchDto,
  ExecuteRemediationDto,
  PreviewRemediationDto,
  UpdateBatchDto,
} from './remediation.dto';

function toDto<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): T {
  return plainToInstance(cls, plain, { enableImplicitConversion: true });
}

describe('PreviewRemediationDto', () => {
  it('accepts a minimal preview without cached permissions', async () => {
    const dto = toDto(PreviewRemediationDto, {
      connectionId: 'conn_1',
      checkResultId: 'chk_1',
      remediationKey: 's3-encryption',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts well-formed cached permissions', async () => {
    const dto = toDto(PreviewRemediationDto, {
      connectionId: 'conn_1',
      checkResultId: 'chk_1',
      remediationKey: 's3-encryption',
      cachedPermissions: [
        's3:PutBucketEncryption',
        'cognito-idp:DescribeUserPool',
      ],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects malformed cached permission tokens', async () => {
    const dto = toDto(PreviewRemediationDto, {
      connectionId: 'conn_1',
      checkResultId: 'chk_1',
      remediationKey: 's3-encryption',
      cachedPermissions: ['not-a-token', 's3:PutBucketEncryption; rm -rf'],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cachedPermissions')).toBe(true);
  });

  it('rejects oversized cached permission lists', async () => {
    const dto = toDto(PreviewRemediationDto, {
      connectionId: 'conn_1',
      checkResultId: 'chk_1',
      remediationKey: 's3-encryption',
      cachedPermissions: Array.from(
        { length: 1001 },
        (_, i) => `s3:Action${i}`,
      ),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cachedPermissions')).toBe(true);
  });
});

describe('ExecuteRemediationDto', () => {
  it('accepts a minimal execute payload', async () => {
    const dto = toDto(ExecuteRemediationDto, {
      connectionId: 'conn_1',
      checkResultId: 'chk_1',
      remediationKey: 's3-encryption',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an overlong acknowledgment', async () => {
    const dto = toDto(ExecuteRemediationDto, {
      connectionId: 'conn_1',
      checkResultId: 'chk_1',
      remediationKey: 's3-encryption',
      acknowledgment: 'x'.repeat(5001),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'acknowledgment')).toBe(true);
  });
});

describe('CreateBatchDto', () => {
  it('accepts up to 500 findings', async () => {
    const dto = toDto(CreateBatchDto, {
      connectionId: 'conn_1',
      findings: [{ id: 'f1', key: 'k1', title: 't1' }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an empty findings list at the DTO boundary', async () => {
    const dto = toDto(CreateBatchDto, {
      connectionId: 'conn_1',
      findings: 'not-an-array',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'findings')).toBe(true);
  });

  it('rejects batches over 500 findings', async () => {
    const dto = toDto(CreateBatchDto, {
      connectionId: 'conn_1',
      findings: Array.from({ length: 501 }, (_, i) => ({
        id: `f${i}`,
        key: `k${i}`,
        title: `t${i}`,
      })),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'findings')).toBe(true);
  });
});

describe('UpdateBatchDto', () => {
  it('accepts a status move', async () => {
    const dto = toDto(UpdateBatchDto, { status: 'completed' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts the legacy done alias', async () => {
    const dto = toDto(UpdateBatchDto, { status: 'done' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects unknown statuses', async () => {
    const dto = toDto(UpdateBatchDto, { status: 'archived' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });
});
