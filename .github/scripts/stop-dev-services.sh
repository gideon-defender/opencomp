#!/usr/bin/env bash
set -euo pipefail

services=(gideon-dev-opencomp-mcp gideon-dev-opencomp-api gideon-dev-opencomp-app
  gideon-dev-opencomp-trust-center gideon-dev-opencomp-email-worker)
counts="$RUNNER_TEMP/opencomp-service-counts"
scaling="$RUNNER_TEMP/opencomp-service-scaling.json"
receipt="$RUNNER_TEMP/opencomp-stopped-services"
rm -f "$receipt"

state="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "${services[@]}")"
jq -e --argjson count "${#services[@]}" '
  (.failures // [] | length) == 0 and (.services | length) == $count and
  all(.services[]; .status == "ACTIVE" and .schedulingStrategy == "REPLICA")
' <<< "$state" >/dev/null
jq -r '.services[] | "\(.serviceName)|\(.desiredCount)"' <<< "$state" > "$counts"

resources=()
for service in "${services[@]}"; do resources+=("service/$ECS_CLUSTER/$service"); done
aws application-autoscaling describe-scalable-targets --region "$AWS_REGION" \
  --service-namespace ecs --resource-ids "${resources[@]}" > "$scaling"
jq -e '.ScalableTargets | type == "array"' "$scaling" >/dev/null
while IFS= read -r target; do
  aws application-autoscaling register-scalable-target --region "$AWS_REGION" \
    --service-namespace ecs --resource-id "$(jq -r '.ResourceId' <<< "$target")" \
    --scalable-dimension ecs:service:DesiredCount \
    --suspended-state 'DynamicScalingInSuspended=true,DynamicScalingOutSuspended=true,ScheduledScalingSuspended=true'
done < <(jq -c '.ScalableTargets[]' "$scaling")

for service in "${services[@]}"; do
  aws ecs update-service --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
    --service "$service" --desired-count 0 >/dev/null
done
aws ecs wait services-stable --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "${services[@]}"

# Desired STOPPED tasks can still have live database connections during shutdown.
for ((attempt=1; attempt<=${TASK_DRAIN_ATTEMPTS:-60}; attempt++)); do
  drained=true
  state="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "${services[@]}")"
  jq -e --argjson count "${#services[@]}" '
    (.failures // [] | length) == 0 and (.services | length) == $count and
    all(.services[]; .desiredCount == 0 and .runningCount == 0 and .pendingCount == 0)
  ' <<< "$state" >/dev/null || drained=false
  for service in "${services[@]}"; do
    for status in RUNNING STOPPED; do
      # AWS CLI auto-paginates taskArns; only describe-tasks needs 100-item batches.
      arns="$(aws ecs list-tasks --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
        --service-name "$service" --desired-status "$status" --query taskArns --output text)"
      batch=()
      for task in $arns; do
        [ "$task" != None ] || continue
        batch+=("$task")
        if [ "${#batch[@]}" -eq 100 ]; then
          tasks="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --tasks "${batch[@]}")"
          jq -e '(.failures // [] | length) == 0 and all(.tasks[]; .lastStatus == "STOPPED")' <<< "$tasks" >/dev/null || drained=false
          batch=()
        fi
      done
      if [ "${#batch[@]}" -gt 0 ]; then
        tasks="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --tasks "${batch[@]}")"
        jq -e '(.failures // [] | length) == 0 and all(.tasks[]; .lastStatus == "STOPPED")' <<< "$tasks" >/dev/null || drained=false
      fi
    done
  done
  if [ "$drained" = true ]; then
    cp "$counts" "$receipt"
    exit 0
  fi
  echo "Waiting for all dev database consumers to stop ($attempt)"
  sleep "${TASK_DRAIN_DELAY_SECONDS:-10}"
done
echo 'Dev services did not drain; migrations and restart are blocked'
exit 1
