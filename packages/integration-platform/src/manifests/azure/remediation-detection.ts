/**
 * Barrel for customer-side Azure remediator detection. Detection content
 * (signals, conditions, forensic queries) lives in
 * `./remediation-detection-filters`; the action group and the Cloud Shell
 * setup script live in `./remediation-detection-script`. Import from either
 * module directly or from here — both re-export below.
 */
export {
  AZURE_APPROVAL_GATED_SURFACES,
  AZURE_REMEDIATION_DETECTION_DESCRIPTIONS,
  AZURE_REMEDIATION_DETECTION_RULES,
  buildAzureApprovalGatedConditions,
  buildAzureDetectionConditions,
  buildAzureForensicQueries,
  buildAzureRemediatorDeniedConditions,
  buildAzureRemediatorWriteConditions,
  renderAzureAlertCondition,
} from './remediation-detection-filters';
export type {
  AzureAlertCondition,
  AzureApprovalGatedSurfaceCode,
  AzureForensicQuery,
  AzureRemediationDetectionRule,
} from './remediation-detection-filters';
export {
  AZURE_REMEDIATION_DETECTION_ACTION_GROUP_NAME,
  azureActionGroupId,
  azureDetectionRuleName,
  getAzureRemediationDetectionScript,
} from './remediation-detection-script';
export type {
  AzureRemediationDetectionScriptOptions,
  AzureRemediationDetectionService,
} from './remediation-detection-script';
