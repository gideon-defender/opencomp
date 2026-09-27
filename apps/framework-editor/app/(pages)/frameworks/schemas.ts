import { z } from 'zod';

export interface FrameworkSchemaMessages {
  nameRequired: string;
  descriptionRequired: string;
  versionRequired: string;
  requirementNameRequired: string;
}

const fallbackMessages: FrameworkSchemaMessages = {
  nameRequired: 'Name is required.',
  descriptionRequired: 'Description is required.',
  versionRequired: 'Version is required.',
  requirementNameRequired: 'Requirement name is required.',
};

export function createFrameworkBaseSchema(messages: FrameworkSchemaMessages = fallbackMessages) {
  return z.object({
    name: z.string().min(1, { message: messages.nameRequired }),
    description: z.string().min(1, { message: messages.descriptionRequired }),
    version: z.string().min(1, { message: messages.versionRequired }),
    visible: z.boolean().optional(),
  });
}

// FRAME-20: a framework family (folder). No version — it's an organisational
// unit, not a published artifact.
export function createFrameworkFamilyBaseSchema(
  messages: FrameworkSchemaMessages = fallbackMessages,
) {
  return z.object({
    name: z.string().min(1, { message: messages.nameRequired }),
    description: z.string().optional(),
    status: z.enum(['visible', 'hidden', 'under_construction', 'partial']),
  });
}

export function createRequirementBaseSchema(
  messages: FrameworkSchemaMessages = fallbackMessages,
) {
  return z.object({
    name: z.string().min(1, { message: messages.requirementNameRequired }),
    description: z.string().optional(), // Assuming description can be optional
    identifier: z.string().optional(), // Identifier is optional
  });
}

// Static English-fallback schemas preserve the existing imports for callers
// that have not been migrated to translated validation messages yet.
export const FrameworkBaseSchema = createFrameworkBaseSchema();
export const FrameworkFamilyBaseSchema = createFrameworkFamilyBaseSchema();
export const RequirementBaseSchema = createRequirementBaseSchema();

export type FrameworkFormValues = z.infer<typeof FrameworkBaseSchema>;
export type FrameworkFamilyFormValues = z.infer<typeof FrameworkFamilyBaseSchema>;
export type RequirementFormValues = z.infer<typeof RequirementBaseSchema>;
