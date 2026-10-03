/**
 * Visibility guardrail validators — every validator here refuses a shape
 * that silently blinds a detective control (detection off, log delivery
 * emptied, encryption dropped). Split out of
 * `remediation-rollback-validators` to respect the 300-line file limit.
 * Wired into fix-step validation through `validateRollbackShape`, so a
 * step must clear both the param table and these shapes.
 */

/**
 * GuardDuty `CreateDetector` is the fix API for missing detectors — the
 * fix only ever enables detection. An explicit `Enable: false` creates a
 * blinded detector while the plan reads like an improvement. An absent
 * `Enable` passes: the API default is enabled.
 */
export function validateCreateDetector(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  if (params.Enable === false) {
    return [
      `${prefix}: creating a detector with "Enable: false" leaves detection off — refused for safety`,
    ];
  }
  return [];
}

/**
 * GuardDuty `UpdateDetector` takes `Enable: false`, which silently blinds
 * GuardDuty without any Delete/Disable/Stop verb for the generic rules to
 * catch (the denylist blocks the grant for the same reason). Detector
 * creation stays allowed via `CreateDetector`; detector config changes go
 * to manual review. An absent `Enable` passes — updates to other settings
 * (e.g. finding publish frequency) are legitimate.
 */
export function validateUpdateDetector(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  if (params.Enable === false) {
    return [
      `${prefix}: disabling the detector ("Enable: false") blinds GuardDuty while the plan reads like a fix — refused for safety`,
    ];
  }
  return [];
}

/**
 * True when a route-settings object explicitly opts out of execution
 * logging (`LoggingLevel: "OFF"`). Non-objects and absent keys pass —
 * only the affirmative opt-out is refused.
 */
export function hasLoggingOptOut(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const level = (value as Record<string, unknown>).LoggingLevel;
  return typeof level === 'string' && level.trim().toLowerCase() === 'off';
}

/**
 * API Gateway `UpdateStage` is the fix API for missing access logging —
 * the fix only ever wires `AccessLogSettings` to a log-group ARN. An
 * `AccessLogSettings` object without a destination is the documented
 * rollback (it blinds the stage). Execution-logging opt-outs
 * (`LoggingLevel: "OFF"` in default or per-route settings) are the same
 * weakening shape through a different key and are refused too. A step
 * that touches other stage settings leaves these keys absent and passes.
 */
export function validateUpdateStage(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const errors: string[] = [];
  const settings = params.AccessLogSettings;
  if (
    settings !== null &&
    typeof settings === 'object' &&
    !Array.isArray(settings)
  ) {
    const destination = (settings as Record<string, unknown>).DestinationArn;
    if (typeof destination !== 'string' || destination.trim().length === 0) {
      errors.push(
        `${prefix}: an access-logging update without a log destination blinds the stage — refused for safety`,
      );
    }
  }
  if (hasLoggingOptOut(params.DefaultRouteSettings)) {
    errors.push(
      `${prefix}: turning default route logging "OFF" blinds execution logging — refused for safety`,
    );
  }
  const routeSettings = params.RouteSettings;
  if (
    routeSettings !== null &&
    typeof routeSettings === 'object' &&
    !Array.isArray(routeSettings)
  ) {
    const hasRouteOptOut = Object.values(routeSettings).some(hasLoggingOptOut);
    if (hasRouteOptOut) {
      errors.push(
        `${prefix}: turning route logging "OFF" blinds execution logging — refused for safety`,
      );
    }
  }
  return errors;
}

/**
 * CloudTrail log delivery: emptying `CloudWatchLogsLogGroupArn` is the
 * documented rollback — it silently stops log delivery while every other
 * trail flag still reads enabled.
 */
export function validateTrailLogDelivery(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const arn = params.CloudWatchLogsLogGroupArn;
  if (typeof arn === 'string' && arn.trim().length === 0) {
    return [
      `${prefix}: emptying "CloudWatchLogsLogGroupArn" stops log delivery — refused for safety`,
    ];
  }
  return [];
}

/**
 * Network Firewall `UpdateLoggingConfiguration` is the fix API for missing
 * firewall logging — the fix only ever attaches log destinations. An
 * emptied `LogDestinationConfigs` (or an entry with an emptied
 * `LogDestination`) is the update-verb equivalent of the blocked
 * Delete/Stop/Disable kill-switches: it stops firewall log delivery while
 * the plan reads like a logging improvement. A step that leaves
 * `LoggingConfiguration` absent passes.
 */
export function validateUpdateLoggingConfiguration(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const config = params.LoggingConfiguration;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return [];
  }
  const destinations = (config as Record<string, unknown>)
    .LogDestinationConfigs;
  if (!Array.isArray(destinations) || destinations.length === 0) {
    return [
      `${prefix}: emptying "LogDestinationConfigs" stops firewall log delivery — refused for safety`,
    ];
  }
  for (const entry of destinations) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const destination = (entry as Record<string, unknown>).LogDestination;
    if (typeof destination !== 'string' || destination.trim().length === 0) {
      return [
        `${prefix}: a log destination without a "LogDestination" stops firewall log delivery — refused for safety`,
      ];
    }
  }
  return [];
}

/**
 * SNS SSE: emptying `KmsMasterKeyId` is the documented rollback — it
 * silently drops topic encryption while the plan reads like a fix.
 */
export function validateTopicEncryption(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const name = params.AttributeName;
  const value = params.AttributeValue;
  if (
    typeof name === 'string' &&
    name.trim().toLowerCase() === 'kmsmasterkeyid' &&
    (typeof value !== 'string' || value.trim().length === 0)
  ) {
    return [
      `${prefix}: emptying "KmsMasterKeyId" drops topic encryption — refused for safety`,
    ];
  }
  return [];
}

/**
 * SQS SSE: same shape through the `Attributes` map — an emptied
 * `KmsMasterKeyId` drops queue encryption (the documented rollback
 * removes the attribute; an explicit empty value is its executable
 * equivalent).
 */
export function validateQueueEncryption(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const attributes = params.Attributes;
  if (
    attributes === null ||
    typeof attributes !== 'object' ||
    Array.isArray(attributes)
  ) {
    return [];
  }
  const key = Object.keys(attributes).find(
    (candidate) => candidate.trim().toLowerCase() === 'kmsmasterkeyid',
  );
  if (!key) {
    return [];
  }
  const value = (attributes as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [
      `${prefix}: emptying "KmsMasterKeyId" drops queue encryption — refused for safety`,
    ];
  }
  return [];
}
