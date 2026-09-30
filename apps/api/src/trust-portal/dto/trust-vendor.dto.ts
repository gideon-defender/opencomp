import { isSafeHttpUrl } from '@gideon-defender/utils';
import { z } from 'zod';

const ComplianceBadgeSchema = z.object({
  type: z.enum([
    'soc2',
    'iso27001',
    'iso42001',
    'gdpr',
    'hipaa',
    'pci_dss',
    'nen7510',
    'iso9001',
    'dora',
    'nis2',
    'hitrust',
    'nistcsf',
    'nist80053',
  ]),
  verified: z.boolean(),
});

export const UpdateVendorTrustSettingsSchema = z.object({
  // Vendor logos render as <img src> on the unauthenticated public portal.
  // zod's url() accepts any scheme (including javascript:/data:), so enforce
  // http(s) explicitly — same rule as custom links (trust-custom-link.dto).
  logoUrl: z
    .string()
    .url()
    .max(2000)
    .refine(isSafeHttpUrl, { message: 'URL must use http or https' })
    .optional()
    .nullable(),
  showOnTrustPortal: z.boolean().optional(),
  trustPortalOrder: z.number().int().min(0).optional().nullable(),
  complianceBadges: z.array(ComplianceBadgeSchema).optional().nullable(),
});

export type UpdateVendorTrustSettingsDto = z.infer<
  typeof UpdateVendorTrustSettingsSchema
>;
