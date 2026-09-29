/**
 * Single source of truth for public trust-portal framework display names.
 * Previously triplicated across the trust-center frontend (`FRAMEWORK_TITLES`),
 * the catalog service (`NATIVE_FRAMEWORKS` titles), and the badge label map.
 */

/** Native framework slug (snake_case) -> display title. */
export const FRAMEWORK_TITLES: Record<string, string> = {
  soc2_type1: 'SOC 2 Type 1',
  soc2_type2: 'SOC 2 Type 2',
  soc3: 'SOC 3',
  iso_27001: 'ISO 27001',
  iso_42001: 'ISO 42001',
  iso_9001: 'ISO 9001',
  gdpr: 'GDPR',
  hipaa: 'HIPAA',
  pci_dss: 'PCI DSS',
  nen_7510: 'NEN 7510',
  pipeda: 'PIPEDA',
  ccpa: 'CCPA',
  dora: 'DORA',
  nis_2: 'NIS 2',
  hitrust_csf: 'HITRUST CSF',
  nist_csf: 'NIST CSF',
  nist_800_53: 'NIST 800-53',
};

/** Compliance badge type (compact key) -> display label. */
export const COMPLIANCE_BADGE_LABELS: Record<string, string> = {
  soc2: 'SOC 2',
  soc3: 'SOC 3',
  iso27001: 'ISO 27001',
  iso42001: 'ISO 42001',
  iso9001: 'ISO 9001',
  gdpr: 'GDPR',
  hipaa: 'HIPAA',
  pci_dss: 'PCI DSS',
  nen7510: 'NEN 7510',
  pipeda: 'PIPEDA',
  ccpa: 'CCPA',
  dora: 'DORA',
  nis2: 'NIS 2',
  hitrust: 'HITRUST CSF',
  nistcsf: 'NIST CSF',
  nist80053: 'NIST 800-53',
};
