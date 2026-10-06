/**
 * Barrel for customer-side GCP remediator detection. Detection content
 * (signals, filters, forensic queries) lives in
 * `./remediation-detection-filters`; alerting policies and the Cloud Shell
 * setup script live in `./remediation-detection-script`. Import from either
 * module directly or from here — both re-export below.
 */
export {
  GCP_REMEDIATION_DETECTION_DESCRIPTIONS,
  GCP_REMEDIATION_DETECTION_METRICS,
  GCP_REMEDIATION_DETECTION_RULES,
  GCP_REMEDIATION_LOG_QUERIES,
  buildGcpApprovalGatedFilter,
  buildGcpDeniedFilter,
  buildGcpDetectionFilter,
  buildGcpImpersonationFilter,
} from './remediation-detection-filters';
export type {
  GcpRemediationDetectionRule,
  GcpRemediationLogQuery,
} from './remediation-detection-filters';
export {
  GCP_REMEDIATION_DETECTION_CHANNEL_NAME,
  buildGcpAlertingPolicy,
  getGcpRemediationDetectionScript,
} from './remediation-detection-script';
export type { GcpRemediationDetectionScriptOptions } from './remediation-detection-script';
