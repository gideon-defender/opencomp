import { isSafeHttpUrl } from '@gideon-defender/utils';
import { z } from 'zod';

// NOTE (API contract exception): these DTOs are zod schemas, not classes,
// so they predate the class-DTO rule in AGENTS.md ("DTOs are classes").
// They stay because the endpoints document their shape with explicit
// @ApiBody({ schema }) plus openapi regression tests (trust-portal.openapi
// spec), and validate at runtime via Schema.parse. Do NOT copy this pattern
// for new endpoints — new DTOs must be classes with @ApiProperty +
// class-validator decorators and @ApiBody({ type }).

// Custom links render as plain <a href> on the unauthenticated public
// portal — only http(s) targets are safe. zod's url() accepts any scheme
// (including javascript:), so enforce the scheme explicitly via the shared
// helper (same rule the catalog service and frontend enforce at read time).
const httpUrl = z
  .string()
  .url()
  .max(2000)
  .refine(isSafeHttpUrl, { message: 'URL must use http or https' });

export const CreateCustomLinkSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  url: httpUrl,
});

export type CreateCustomLinkDto = z.infer<typeof CreateCustomLinkSchema>;

export const UpdateCustomLinkSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  url: httpUrl.optional(),
  isActive: z.boolean().optional(),
});

export type UpdateCustomLinkDto = z.infer<typeof UpdateCustomLinkSchema>;

export const ReorderCustomLinksSchema = z.object({
  linkIds: z.array(z.string()),
});

export type ReorderCustomLinksDto = z.infer<typeof ReorderCustomLinksSchema>;
