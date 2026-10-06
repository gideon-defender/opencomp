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

  it('accepts an optional previewed plan hash', async () => {
    const dto = toDto(ExecuteRemediationDto, {
      connectionId: 'conn_1',
      checkResultId: 'chk_1',
      remediationKey: 's3-encryption',
      acknowledgment: 'acknowledged',
      expectedPlanHash: 'gcp-abc123',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an overlong previewed plan hash', async () => {
    const dto = toDto(ExecuteRemediationDto, {
      connectionId: 'conn_1',
      checkResultId: 'chk_1',
      remediationKey: 's3-encryption',
      acknowledgment: 'acknowledged',
      expectedPlanHash: 'x'.repeat(257),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'expectedPlanHash')).toBe(true);
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

  it('rejects an empty triggerRunId (no silent no-op writes)', async () => {
    const dto = toDto(UpdateBatchDto, { triggerRunId: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'triggerRunId')).toBe(true);
  });

  it('accepts a non-empty triggerRunId', async () => {
    const dto = toDto(UpdateBatchDto, { triggerRunId: 'run_1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects line breaks in triggerRunId (log forgery)', async () => {
    const dto = toDto(UpdateBatchDto, { triggerRunId: 'run_1\nforged: true' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'triggerRunId')).toBe(true);
  });
});

describe('line-break hardening across DTOs', () => {
  it('rejects line breaks in CreateBatchDto.connectionId', async () => {
    const dto = toDto(CreateBatchDto, {
      connectionId: 'conn_1\nX-Injected: true',
      findings: [],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'connectionId')).toBe(true);
  });

  it('rejects line breaks in ExecuteRemediationDto free-text fields', async () => {
    const base = {
      connectionId: 'conn_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
    };
    for (const extra of [
      { acknowledgment: 'acknowledged\nforged-log-line' },
      { expectedPlanHash: 'abc123\nforged-log-line' },
    ]) {
      const dto = toDto(ExecuteRemediationDto, { ...base, ...extra });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('accepts clean acknowledgment and plan hash values', async () => {
    const dto = toDto(ExecuteRemediationDto, {
      connectionId: 'conn_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
      acknowledgment: 'acknowledged',
      expectedPlanHash: 'abc123',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
