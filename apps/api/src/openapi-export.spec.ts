import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  canonicalDocument,
  createPublicDocument,
} from './openapi/public-document';
import { collectPublicOpenApiIssues } from './openapi/public-docs-quality';

const mode = process.env.OPENAPI_EXPORT_MODE;
const run = mode ? describe : describe.skip;
run('Offline OpenAPI export', () => {
  it('exports real controller/DTO metadata without constructors or application lifecycle', async () => {
    const { AppModule } =
      jest.requireActual<typeof import('./app.module')>('./app.module');
    // Preview creates controller prototypes but never constructs providers or
    // calls factories. Never init/listen/close: close would run lifecycle hooks.
    const factory = jest.fn(() => {
      throw new Error('Preview must never construct providers');
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [{ provide: 'offline-preview-sentinel', useFactory: factory }],
    }).compile({ preview: true });
    expect(factory).not.toHaveBeenCalled();
    const app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    const init = jest.spyOn(app, 'init');
    const listen = jest.spyOn(app, 'listen');
    const document = createPublicDocument(app);
    expect(init).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect(Object.keys(document.paths).length).toBeGreaterThan(300);
    const issues = collectPublicOpenApiIssues(document);
    for (const [name, entries] of Object.entries(issues)) {
      expect({ [name]: entries }).toEqual({ [name]: [] });
    }
    const target = path.resolve(
      __dirname,
      '../../../packages/docs/openapi.json',
    );
    if (mode === 'write') {
      writeFileSync(target, JSON.stringify(document, null, 2));
      return;
    }
    const committed: unknown = JSON.parse(readFileSync(target, 'utf8'));
    // Hash-sized diagnostics avoid dumping the entire 1MB spec on failure.
    const hash = (value: unknown) =>
      createHash('sha256').update(canonicalDocument(value)).digest('hex');
    expect({
      committed: hash(committed),
      regenerate: 'pnpm --filter @gideon-defender/api run openapi:export',
    }).toEqual({
      committed: hash(document),
      regenerate: 'pnpm --filter @gideon-defender/api run openapi:export',
    });
  }, 120000);
});
