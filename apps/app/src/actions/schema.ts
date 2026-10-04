import {
  CommentEntityType,
  Frequency,
  Impact,
  Likelihood,
  PolicyStatus,
  RiskCategory,
  RiskStatus,
  TaskStatus,
} from '@db';
import { z } from 'zod';

/**
 * English fallback messages for server-action schemas.
 *
 * These schemas run server-side, where next-intl hooks are unavailable, so
 * messages stay as literals. Each key mirrors the `validation` message
 * namespace — clients should translate the key via
 * `useTranslations('validation')` before display.
 */
export const actionValidationMessages = {
  selectFrameworkToStart: 'Please select at least one framework to get started with',
  organizationNameRequired: 'Organization name is required',
  organizationNameTooLong: 'Organization name cannot exceed 255 characters',
  subdomainRequired: 'Subdomain is required',
  subdomainTooLong: 'Subdomain cannot exceed 255 characters',
  subdomainInvalid: 'Subdomain can only contain lowercase letters, numbers, and hyphens',
  websiteInvalid: 'Please enter a valid website that starts with https://',
  websiteTooLong: 'Website cannot exceed 255 characters',
  riskNameRequired: 'Risk name is required',
  riskNameTooShort: 'Risk name should be at least 1 character',
  riskNameTooLong: 'Risk name should be at most 100 characters',
  riskDescriptionRequired: 'Risk description is required',
  riskDescriptionTooShort: 'Risk description should be at least 1 character',
  riskDescriptionTooLong: 'Risk description should be at most 255 characters',
  riskCategoryRequired: 'Risk category is required',
  riskDepartmentRequired: 'Risk department is required',
  riskDepartmentTooLong: 'Risk department must be at most 64 characters',
  riskIdRequired: 'Risk ID is required',
  riskTitleRequired: 'Risk title is required',
  riskStatusRequired: 'Risk status is required',
  commentContentRequired: 'Comment content is required',
  commentContentTooLong: 'Comment content should be at most 1000 characters',
  taskTitleRequired: 'Task title is required',
  taskDescriptionRequired: 'Task description is required',
  taskIdRequired: 'Task ID is required',
  taskStatusRequired: 'Task status is required',
  integrationNameRequired: 'Integration name is required',
  integrationIdRequired: 'Integration ID is required',
  titleRequired: 'Title is required',
  descriptionRequired: 'Description is required',
  organizationIdRequired: 'Organization ID is required',
  selectFrameworkToAdd: 'Please select at least one framework to add',
  departmentRequired: 'Department is required',
  departmentTooLong: 'Department must be at most 64 characters',
  nameRequired: 'Name is required',
  nameTooLong: 'Name must be less than 64 characters',
  policyIdRequired: 'Policy ID is required',
  entityIdRequired: 'Entity ID is required',
  questionRequired: 'Question is required',
  answerRequired: 'Answer is required',
  idRequired: 'ID is required',
} as const;

export type ActionValidationKey = keyof typeof actionValidationMessages;

const m = actionValidationMessages;

export const organizationNameSchema = z.object({
  name: z.string().min(1, m.organizationNameRequired).max(255, m.organizationNameTooLong),
});

export const subdomainAvailabilitySchema = z.object({
  subdomain: z
    .string()
    .min(1, m.subdomainRequired)
    .max(255, m.subdomainTooLong)
    .regex(/^[a-z0-9-]+$/, {
      message: m.subdomainInvalid,
    }),
});

export const deleteOrganizationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
});

export const sendFeedbackSchema = z.object({
  feedback: z.string(),
});

export const organizationWebsiteSchema = z.object({
  website: z
    .string()
    .url({
      message: m.websiteInvalid,
    })
    .max(255, m.websiteTooLong),
});

export const organizationAdvancedModeSchema = z.object({
  advancedModeEnabled: z.boolean(),
});

export const organizationEvidenceApprovalSchema = z.object({
  evidenceApprovalEnabled: z.boolean(),
});

export const organizationDeviceAgentStepSchema = z.object({
  deviceAgentStepEnabled: z.boolean(),
});

export const organizationSecurityTrainingStepSchema = z.object({
  securityTrainingStepEnabled: z.boolean(),
});

export const organizationWhistleblowerReportSchema = z.object({
  whistleblowerReportEnabled: z.boolean(),
});

export const organizationAccessRequestFormSchema = z.object({
  accessRequestFormEnabled: z.boolean(),
});

// Risks
export const createRiskSchema = z.object({
  title: z
    .string({ error: m.riskNameRequired })
    .min(1, { message: m.riskNameTooShort })
    .max(100, { message: m.riskNameTooLong }),
  description: z
    .string({ error: m.riskDescriptionRequired })
    .min(1, { message: m.riskDescriptionTooShort })
    .max(255, { message: m.riskDescriptionTooLong }),
  category: z.nativeEnum(RiskCategory, { error: m.riskCategoryRequired }),
  department: z
    .string({ error: m.riskDepartmentRequired })
    .trim()
    .min(1, { message: m.riskDepartmentRequired })
    .max(64, { message: m.riskDepartmentTooLong }),
  assigneeId: z.string().optional().nullable(),
});

export const updateRiskSchema = z.object({
  id: z.string().min(1, {
    message: m.riskIdRequired,
  }),
  title: z.string().min(1, {
    message: m.riskTitleRequired,
  }),
  description: z.string().min(1, {
    message: m.riskDescriptionRequired,
  }),
  category: z.nativeEnum(RiskCategory, { error: m.riskCategoryRequired }),
  department: z
    .string({ error: m.riskDepartmentRequired })
    .trim()
    .min(1, { message: m.riskDepartmentRequired })
    .max(64, { message: m.riskDepartmentTooLong }),
  assigneeId: z.string().optional().nullable(),
  status: z.nativeEnum(RiskStatus, { error: m.riskStatusRequired }),
});

export const createRiskCommentSchema = z.object({
  riskId: z.string().min(1, {
    message: m.riskIdRequired,
  }),
  content: z
    .string()
    .min(1, {
      message: m.commentContentRequired,
    })
    .max(1000, {
      message: m.commentContentTooLong,
    })
    .transform((val) => {
      // Remove any HTML tags by applying the replacement repeatedly until no changes occur
      let sanitized = val;
      let previousValue;

      do {
        previousValue = sanitized;
        sanitized = sanitized.replace(/<[^>]*>/g, '');
      } while (sanitized !== previousValue);

      return sanitized;
    }),
});

export const createTaskSchema = z.object({
  riskId: z.string().min(1, {
    message: m.riskIdRequired,
  }),
  title: z.string().min(1, {
    message: m.taskTitleRequired,
  }),
  description: z.string().min(1, {
    message: m.taskDescriptionRequired,
  }),
  dueDate: z.date().optional(),
  assigneeId: z.string().optional().nullable(),
});

export const updateTaskSchema = z.object({
  id: z.string().min(1, {
    message: m.taskIdRequired,
  }),
  title: z.string().optional(),
  description: z.string().optional(),
  dueDate: z.date().optional(),
  status: z.nativeEnum(TaskStatus, { error: m.taskStatusRequired }),
  assigneeId: z.string().optional().nullable(),
});

export const createTaskCommentSchema = z.object({
  riskId: z.string().min(1, {
    message: m.riskIdRequired,
  }),
  taskId: z.string().min(1, {
    message: m.taskIdRequired,
  }),
  content: z
    .string()
    .min(1, {
      message: m.commentContentRequired,
    })
    .max(1000, {
      message: m.commentContentTooLong,
    })
    .transform((val) => {
      // Remove any HTML tags by applying the replacement repeatedly until no changes occur
      let sanitized = val;
      let previousValue;

      do {
        previousValue = sanitized;
        sanitized = sanitized.replace(/<[^>]*>/g, '');
      } while (sanitized !== previousValue);

      return sanitized;
    }),
});

export const uploadTaskFileSchema = z.object({
  riskId: z.string().min(1, {
    message: m.riskIdRequired,
  }),
  taskId: z.string().min(1, {
    message: m.taskIdRequired,
  }),
});

// Integrations
export const deleteIntegrationConnectionSchema = z.object({
  integrationName: z.string().min(1, {
    message: m.integrationNameRequired,
  }),
});

export const createIntegrationSchema = z.object({
  integrationId: z.string().min(1, {
    message: m.integrationIdRequired,
  }),
});

// Seed Data
export const seedDataSchema = z.object({
  organizationId: z.string(),
});

export const updateInherentRiskSchema = z.object({
  id: z.string().min(1, {
    message: m.riskIdRequired,
  }),
  probability: z.nativeEnum(Likelihood),
  impact: z.nativeEnum(Impact),
});

export const updateResidualRiskSchema = z.object({
  id: z.string().min(1, {
    message: m.riskIdRequired,
  }),
  probability: z.number().min(1).max(10),
  impact: z.number().min(1).max(10),
});

// ADD START: Schema for enum-based residual risk update
export const updateResidualRiskEnumSchema = z.object({
  id: z.string().min(1, {
    message: m.riskIdRequired,
  }),
  probability: z.nativeEnum(Likelihood),
  impact: z.nativeEnum(Impact),
});
// ADD END

// Policies
export const createPolicySchema = z.object({
  title: z.string({ error: m.titleRequired }).min(1, m.titleRequired),
  description: z.string({ error: m.descriptionRequired }).min(1, m.descriptionRequired),
  frameworkIds: z.array(z.string()).optional(),
  controlIds: z.array(z.string()).optional(),
  entityId: z.string().optional(),
});

export type CreatePolicySchema = z.infer<typeof createPolicySchema>;

export const updatePolicySchema = z.object({
  id: z.string(),
  content: z.any(),
  entityId: z.string(),
});

export const addFrameworksSchema = z.object({
  organizationId: z.string().min(1, m.organizationIdRequired),
  frameworkIds: z.array(z.string()).min(1, m.selectFrameworkToAdd),
});

export const assistantSettingsSchema = z.object({
  enabled: z.boolean().optional(),
});

export const updatePolicyOverviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  entityId: z.string(),
});

export const updatePolicyFormSchema = z.object({
  id: z.string(),
  status: z.nativeEnum(PolicyStatus),
  assigneeId: z.string().optional().nullable(),
  department: z
    .string({ error: m.departmentRequired })
    .trim()
    .min(1, { message: m.departmentRequired })
    .max(64, { message: m.departmentTooLong }),
  review_frequency: z.nativeEnum(Frequency),
  review_date: z.date(),
  approverId: z.string().optional().nullable(), // Added for selecting an approver
  entityId: z.string(),
});

export const apiKeySchema = z.object({
  name: z.string().min(1, { message: m.nameRequired }).max(64, { message: m.nameTooLong }),
  expiresAt: z.enum(['30days', '90days', '1year', 'never']),
});

export const createPolicyCommentSchema = z.object({
  policyId: z.string().min(1, {
    message: m.policyIdRequired,
  }),
  content: z
    .string()
    .min(1, {
      message: m.commentContentRequired,
    })
    .max(1000, {
      message: m.commentContentTooLong,
    })
    .transform((val) => {
      // Remove any HTML tags by applying the replacement repeatedly until no changes occur
      let sanitized = val;
      let previousValue;

      do {
        previousValue = sanitized;
        sanitized = sanitized.replace(/<[^>]*>/g, '');
      } while (sanitized !== previousValue);

      return sanitized;
    }),
});

export const addCommentSchema = z.object({
  content: z
    .string()
    .min(1, m.commentContentRequired)
    .max(1000, m.commentContentTooLong)
    .transform((val) => {
      // Remove any HTML tags by applying the replacement repeatedly until no changes occur
      let sanitized = val;
      let previousValue;

      do {
        previousValue = sanitized;
        sanitized = sanitized.replace(/<[^>]*>/g, '');
      } while (sanitized !== previousValue);

      return sanitized;
    }),
  entityId: z.string().min(1, m.entityIdRequired),
  entityType: z.nativeEnum(CommentEntityType),
});

export const createContextEntrySchema = z.object({
  question: z.string().min(1, m.questionRequired),
  answer: z.string().min(1, m.answerRequired),
  tags: z.string().optional(), // comma separated
});

export const updateContextEntrySchema = z.object({
  id: z.string().min(1, m.idRequired),
  question: z.string().min(1, m.questionRequired),
  answer: z.string().min(1, m.answerRequired),
  tags: z.string().optional(),
});

export const deleteContextEntrySchema = z.object({
  id: z.string().min(1, m.idRequired),
});
