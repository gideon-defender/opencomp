import { TaskStatus, VendorCategory, VendorStatus } from '@db';
import { z } from 'zod';

/**
 * English fallback messages for vendor server-action schemas.
 *
 * These schemas run server-side (safe actions), where next-intl hooks are
 * unavailable, so messages stay as literals. Each key mirrors the `validation`
 * message namespace — clients should translate `VendorValidationKey` via
 * `useTranslations('validation')` before display.
 */
export const vendorValidationMessages = {
  vendorIdRequired: 'Vendor ID is required',
  taskIdRequired: 'Task ID is required',
  taskContentRequired: 'Task content is required',
  titleRequired: 'Title is required',
  descriptionRequired: 'Description is required',
  dueDateRequired: 'Due date is required',
  taskStatusRequired: 'Task status is required',
  nameRequired: 'Name is required',
  validUrl: 'Must be a valid URL',
  validUrlWithProtocol: 'Must be a valid URL (include https://)',
  invalidEmail: 'Invalid email address',
  roleRequired: 'Role is required',
  contactRequired: 'At least one contact is required',
} as const;

export type VendorValidationKey = keyof typeof vendorValidationMessages;

const m = vendorValidationMessages;

export const createVendorTaskCommentSchema = z.object({
  vendorId: z.string().min(1, {
    message: m.vendorIdRequired,
  }),
  vendorTaskId: z.string().min(1, {
    message: m.taskIdRequired,
  }),
  content: z.string().min(1, {
    message: m.taskContentRequired,
  }),
});

export const createVendorTaskSchema = z.object({
  vendorId: z.string().min(1, {
    message: m.vendorIdRequired,
  }),
  title: z.string().min(1, {
    message: m.titleRequired,
  }),
  description: z.string().min(1, {
    message: m.descriptionRequired,
  }),
  dueDate: z.date({ error: m.dueDateRequired }),
  assigneeId: z.string().nullable(),
});

export const vendorContactSchema = z.object({
  name: z.string().min(1, m.nameRequired),
  email: z.string().email(m.invalidEmail),
  role: z.string().min(1, m.roleRequired),
});

export const createVendorSchema = z.object({
  name: z.string().min(1, m.nameRequired),
  website: z.string().url(m.validUrl),
  description: z.string().min(1, m.descriptionRequired),
  category: z.nativeEnum(VendorCategory),
  assigneeId: z.string().nullable(),
  contacts: z.array(vendorContactSchema).min(1, m.contactRequired),
});

export const updateVendorSchema = z.object({
  id: z.string(),
  name: z.string().min(1, m.nameRequired),
  description: z.string().optional(),
  category: z.nativeEnum(VendorCategory),
  status: z.nativeEnum(VendorStatus),
  assigneeId: z.string().nullable(),
  website: z.union([z.string().url(m.validUrlWithProtocol), z.literal('')]).optional(),
  isSubProcessor: z.boolean().optional(),
});

export const createVendorCommentSchema = z.object({
  vendorId: z.string(),
  content: z.string().min(1),
});

export const updateVendorRiskSchema = z.object({
  id: z.string(),
  inherent_risk: z.enum(['low', 'medium', 'high', 'unknown']).optional(),
  residual_risk: z.enum(['low', 'medium', 'high', 'unknown']).optional(),
});

export const updateVendorTaskSchema = z.object({
  id: z.string().min(1, {
    message: m.taskIdRequired,
  }),
  vendorId: z.string().min(1, {
    message: m.vendorIdRequired,
  }),
  title: z.string().min(1, {
    message: m.titleRequired,
  }),
  description: z.string().min(1, {
    message: m.descriptionRequired,
  }),
  dueDate: z.date().optional(),
  status: z.nativeEnum(TaskStatus, { error: m.taskStatusRequired }),
  assigneeId: z.string().nullable(),
});
