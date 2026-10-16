#!/usr/bin/env bash
set -euo pipefail

jq -e '.ScalableTargets | type == "array"' "$RUNNER_TEMP/opencomp-service-scaling.json" >/dev/null
while IFS= read -r target; do
  aws application-autoscaling register-scalable-target --region "$AWS_REGION" \
    --service-namespace ecs --resource-id "$(jq -r '.ResourceId' <<< "$target")" \
    --scalable-dimension ecs:service:DesiredCount \
    --suspended-state "$(jq -c '{DynamicScalingInSuspended: false, DynamicScalingOutSuspended: false, ScheduledScalingSuspended: false} + (.SuspendedState // {})' <<< "$target")"
done < <(jq -c '.ScalableTargets[]' "$RUNNER_TEMP/opencomp-service-scaling.json")
