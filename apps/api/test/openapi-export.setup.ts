/* Offline metadata-only export: never read local credentials. */
import { Server, Socket } from 'node:net';

jest.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
  throw new Error('Offline OpenAPI export must not open network connections');
});
jest.spyOn(Server.prototype, 'listen').mockImplementation(() => {
  throw new Error('Offline OpenAPI export must not start a listener');
});
jest
  .spyOn(globalThis, 'fetch')
  .mockImplementation(() =>
    Promise.reject(
      new Error('Offline OpenAPI export must not fetch remote resources'),
    ),
  );
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }));
jest.mock('dotenv/config', () => ({}));
jest.mock('@nestjs/config', () => {
  const actual =
    jest.requireActual<typeof import('@nestjs/config')>('@nestjs/config');
  const forRoot = actual.ConfigModule.forRoot.bind(actual.ConfigModule);
  jest
    .spyOn(actual.ConfigModule, 'forRoot')
    .mockImplementation((options) =>
      forRoot({ ...options, ignoreEnvFile: true }),
    );
  return actual;
});
// Mock better-auth ESM-only modules so Jest (CJS) can import AppModule's transitive AuthModule.
jest.mock('../src/auth/auth.server', () => ({
  auth: {
    api: {},
    handler: () => Promise.resolve(new Response(null, { status: 204 })),
    options: {},
  },
  getTrustedOrigins: () => [],
  isTrustedOrigin: () => Promise.resolve(false),
  isStaticTrustedOrigin: () => false,
}));

jest.mock('@thallesp/nestjs-better-auth', () => {
  const { Module } =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  @Module({})
  class AuthModuleStub {
    static forRoot() {
      return {
        module: AuthModuleStub,
        imports: [],
        providers: [],
        exports: [],
      };
    }
  }
  return { AuthModule: AuthModuleStub };
});

// @inference/tracing is ESM-only, same as better-auth above.
jest.mock('@inference/tracing', () => ({ setup: jest.fn() }));
jest.mock('@inference/tracing/ai-sdk', () => ({
  createAISdkTelemetrySettings: jest.fn(() => ({})),
}));

jest.mock('better-auth/plugins/access', () => ({
  createAccessControl: () => ({
    newRole: () => ({}),
    statement: {},
  }),
}));
jest.mock('better-auth/plugins/organization/access', () => ({
  defaultStatements: {},
  adminAc: {},
  ownerAc: {},
}));

jest.mock('@gideon-defender/auth', () => {
  const emptyRole = { statements: {} };
  const roles = {
    owner: emptyRole,
    admin: emptyRole,
    auditor: emptyRole,
    employee: emptyRole,
    contractor: emptyRole,
  };
  return {
    ac: { newRole: () => emptyRole },
    statement: {},
    allRoles: roles,
    ...roles,
    ROLE_HIERARCHY: ['contractor', 'employee', 'auditor', 'admin', 'owner'],
    RESTRICTED_ROLES: ['employee', 'contractor'],
    PRIVILEGED_ROLES: ['owner', 'admin', 'auditor'],
    BUILT_IN_ROLE_PERMISSIONS: {},
    BUILT_IN_ROLE_OBLIGATIONS: {},
  };
});

jest.mock('@db', () => {
  const prismaClient =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  return {
    ...prismaClient,
    db: {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      organization: { findFirst: jest.fn(), findMany: jest.fn() },
      auditLog: { create: jest.fn() },
      trust: { findMany: jest.fn().mockResolvedValue([]) },
      dynamicIntegration: { findMany: jest.fn().mockResolvedValue([]) },
      apiKey: { findFirst: jest.fn() },
      session: { findFirst: jest.fn() },
      member: { findFirst: jest.fn() },
    },
  };
});

process.env.SECRET_KEY = 'offline-schema-test-secret-only';
process.env.BASE_URL = 'http://localhost:3333';
process.env.APP_AWS_ACCESS_KEY_ID = 'offline-fake-key';
process.env.APP_AWS_SECRET_ACCESS_KEY = 'offline-fake-secret';
process.env.APP_AWS_BUCKET_NAME = 'offline-fake-bucket';
process.env.APP_AWS_REGION = 'us-east-1';
process.env.MACED_API_KEY = 'mc_dev_offline-schema';
process.env.DATABASE_URL = 'postgres://fake:fake@localhost:1/offline';
