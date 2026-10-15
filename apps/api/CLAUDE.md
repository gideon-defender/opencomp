# API Development Guidelines

This document provides guidelines for AI assistants (Claude, Cursor, etc.) when working on the API codebase.

## Project Structure

```
apps/api/src/
├── auth/           # Authentication (better-auth, guards, decorators)
├── roles/          # Custom roles CRUD API
├── stripe/         # Stripe billing (global module)
├── security-penetration-tests/  # Pen testing product (controller, service, billing)
├── <module>/       # Feature modules (controller, service, DTOs)
└── utils/          # Shared utilities
```

## Authentication

- **Session-based auth + Gideon JWT (Phase 0 cutover).** Sessions remain primary. Gideon JWTs (direct Bearer + MCP, verified via JWKS) run alongside sessions: shadow mode falls through to session on Gideon failure, enforce mode hard-fails Gideon-presenting tokens with 401.
- **HybridAuthGuard** checks in order: API Key (`x-api-key`), Service Token (`x-service-token`), Gideon JWT (shadow/enforce, tenant-pinned), Session (cookies/native + MCP OAuth fallback).
- **Gideon tenant contract:** tenant resolves from verified claims (`tid`/`tenant_id`/`organizationId`/`tenantId`, strict missing/malformed/conflict → reject), subject links via `User.oidcSub` only with `User.tenantId` equal to the token tenant, and callers stay pinned to the token tenant (org headers cannot override).
- `@Public()` decorator skips auth entirely (use for webhooks).
- Access auth context via `@AuthContext()` decorator.
- Access organization ID via `@OrganizationId()` decorator.

## RBAC System

The API uses a hybrid RBAC system:

- **Built-in roles**: owner, admin, auditor, employee, contractor (defined in `packages/auth/src/permissions.ts`)
- **Custom roles**: Stored in `organization_role` table with JSON permissions
- **Permissions**: Flat `resource:action` format (e.g., `control:read`, `pentest:create`)
- **Multiple roles**: Users can have multiple roles (comma-separated in `member.role`)

### Permission Resources

`organization`, `member`, `control`, `evidence`, `policy`, `risk`, `vendor`, `task`, `framework`, `audit`, `finding`, `questionnaire`, `integration`, `apiKey`, `trust`, `pentest`, `app`, `compliance`

### Endpoint Protection

Every customer-facing endpoint MUST have:

```typescript
@UseGuards(HybridAuthGuard, PermissionGuard)  // at controller or endpoint level
@RequirePermission('resource', 'action')       // on every endpoint
```

- **Controller format**: `@Controller({ path: 'name', version: '1' })`, NOT `@Controller('v1/name')` (double prefix bug)
- **Webhooks**: `@Public()` — no auth/RBAC required
- **Self-endpoints** (e.g., `/me`): `HybridAuthGuard` only, no `@RequirePermission` needed
- `AuditLogInterceptor` only logs mutations when `@RequirePermission` metadata is present — without it, changes are silently untracked

### Multi-Product Architecture

- Products (compliance, pen testing) are org-level subscription concerns — NOT RBAC
- RBAC controls user access within products
- `pentest` is its own resource: `['create', 'read', 'delete']`
- Custom roles can grant access to any combination of product resources

## Testing Requirements

### Mandatory Testing

**Every new feature MUST include tests.** Before marking a task as complete:

1. Write unit tests for new services and controllers
2. Run the tests to verify they pass
3. Commit tests alongside the feature code

### Running Tests

```bash
# Run tests for a specific module (from apps/api directory)
npx jest src/<module-name> --passWithNoTests

# Run tests for changed files only
npx jest --onlyChanged

# Run all API tests (from repo root)
npx turbo run test --filter=@gideon-defender/api

# Type-check before committing
npx turbo run typecheck --filter=@gideon-defender/api
```

### Test Patterns

```typescript
// Mock external dependencies
jest.mock('@gideon-defender/db', () => ({
  db: {
    someTable: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

// Override guards in controller tests
const module = await Test.createTestingModule({
  controllers: [MyController],
  providers: [{ provide: MyService, useValue: mockService }],
})
  .overrideGuard(HybridAuthGuard)
  .useValue({ canActivate: () => true })
  .compile();
```

### What to Test

| Component   | Test Coverage                                        |
| ----------- | ---------------------------------------------------- |
| Services    | All public methods, validation logic, error handling |
| Controllers | Parameter passing to services, response mapping      |
| Guards      | Authorization decisions, edge cases                  |
| DTOs        | Validation decorators (via e2e or integration tests) |
| Utils       | All functions, edge cases, error conditions          |

## Code Style

### Error Handling

- Use NestJS exceptions: `BadRequestException`, `NotFoundException`, `ForbiddenException`
- Use `HttpException` with `HttpStatus.PAYMENT_REQUIRED` for billing failures (402)
- Provide clear, actionable error messages
- Don't expose internal details in error responses

### Database Access

- Use Prisma via `@gideon-defender/db`
- Always scope queries by `organizationId` for multi-tenancy
- Use transactions for operations that modify multiple records
- **Reusing an integration check's results in a feature?** Use `CheckResultsService`
  (`integration-platform/services/check-results.service.ts`) — the universal, read-only way
  to get any check's per-resource results. Do NOT query `IntegrationCheckResult` /
  `CheckRunRepository` directly from a feature. See the `check-results-service` skill.

### Gotchas

- **ValidationPipe with `transform: true`** mangles nested JSON. Use `@Req() req` and `req.body` directly for endpoints receiving complex nested JSON (like TipTap content).
- **No `as any` casts.** Define proper types.
- **Max 300 lines per file.** Split into focused modules.

## Development Workflow

1. **Before coding**: Read existing code patterns in the module
2. **During coding**: Follow established patterns, add types
3. **After coding**:
   - Run `npx turbo run typecheck --filter=@gideon-defender/api`
   - Write and run tests: `npx jest src/<module>`
   - Commit with conventional commit message

## Common Commands

```bash
# Start API in development
npx turbo run dev --filter=@gideon-defender/api

# Type-check
npx turbo run typecheck --filter=@gideon-defender/api

# Run specific test file
npx jest src/roles/roles.service.spec.ts

# Generate Prisma client after schema changes
cd packages/db && npx prisma generate
```
