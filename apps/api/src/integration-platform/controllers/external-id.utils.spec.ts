import { generateAwsExternalId } from './external-id.utils';

const SERVER_GENERATED_PATTERN =
  /^org_[A-Za-z0-9_-]+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('generateAwsExternalId', () => {
  it('produces org_<id>_<uuid> values', () => {
    const value = generateAwsExternalId('org_abc123');
    expect(value).toMatch(/^org_org_abc123_[0-9a-f-]{36}$/);
    expect(value).toMatch(SERVER_GENERATED_PATTERN);
  });

  it('mints unique values per call', () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateAwsExternalId('org_abc123')),
    );
    expect(seen.size).toBe(50);
  });

  it('sanitizes hostile org IDs (shell-unsafe chars become _)', () => {
    const value = generateAwsExternalId('org_abc"; evil #$`\n123');
    expect(value).not.toMatch(/["$`\\\r\n;]/);
    expect(value).toMatch(SERVER_GENERATED_PATTERN);
  });

  it('never emits whitespace or shell metacharacters', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateAwsExternalId('org_abc123')).not.toMatch(/[\s"'$`\\]/);
    }
  });

  it('mints values no user-typed shape can collide with (uuid suffix)', () => {
    const uuidSuffix =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const typed of [
      'org_abc123',
      'YOUR_EXTERNAL_ID',
      'org_abc_not-a-uuid',
      'org_abc_zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
    ]) {
      expect(typed).not.toMatch(uuidSuffix);
    }
    // Tied to production output: stubbing the generator fails this loop.
    for (let i = 0; i < 20; i += 1) {
      expect(generateAwsExternalId('org_abc123')).toMatch(uuidSuffix);
    }
  });
});
