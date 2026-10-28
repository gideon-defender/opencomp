import { ValidationPipe } from '@nestjs/common';
import { SelectGcpProjectsDto } from './select-gcp-projects.dto';

describe('SelectGcpProjectsDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata = { type: 'body' as const, metatype: SelectGcpProjectsDto };

  const validBody = {
    projectIds: ['prj-payments-prod'],
  };

  it('accepts a string-valued projectNames map', async () => {
    const body = {
      ...validBody,
      projectNames: { 'prj-payments-prod': 'Payments Production', '123': 'X' },
    };
    const result = await pipe.transform(body, metadata);
    expect(result.projectNames).toEqual(body.projectNames);
  });

  it('accepts an absent projectNames field', async () => {
    await expect(pipe.transform(validBody, metadata)).resolves.toEqual(
      validBody,
    );
  });

  it.each([
    ['arrays', ['a', 'b']],
    ['nested objects', { prj: { nested: 'x' } }],
    ['numbers', { prj: 42 }],
    ['booleans', { prj: true }],
    ['nulls', { prj: null }],
    ['arrays of strings are not a string map', []],
  ])('rejects projectNames with %s', async (_label, projectNames) => {
    await expect(
      pipe.transform({ ...validBody, projectNames }, metadata),
    ).rejects.toThrow();
  });

  it('rejects a non-array projectIds field', async () => {
    await expect(
      pipe.transform({ ...validBody, projectIds: 'prj-1' }, metadata),
    ).rejects.toThrow();
  });
});
