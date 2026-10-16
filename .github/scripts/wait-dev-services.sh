#!/usr/bin/env bash
set -euo pipefail

verify_tasks() {
  local expected="$1"
  shift
  local tasks
  tasks="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --tasks "$@")"
  if ! jq -e --arg expected "$expected" '
    (.failures // [] | length) == 0 and
    all(.tasks[]; .lastStatus == "STOPPED" or
      (.lastStatus == "RUNNING" and .taskDefinitionArn == $expected))
  ' <<< "$tasks" >/dev/null; then
    return 1
  fi
}

test -s "$RUNNER_TEMP/opencomp-expected-tasks"
while IFS='|' read -r service expected; do
  aws ecs wait services-stable --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$service"
  # The stability waiter can return before rolloutState changes to COMPLETED.
  completed=false
  for ((attempt=1; attempt<=${SERVICE_ROLLOUT_ATTEMPTS:-60}; attempt++)); do
    state="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$service")"
    if ! jq -e --arg expected "$expected" '
      (.failures // [] | length) == 0 and (.services | length) == 1 and
      all(.services[]; .taskDefinition == $expected and
        all(.deployments[]; .rolloutState != "FAILED"))
    ' <<< "$state" >/dev/null; then
      echo "$service rolled back or failed the requested rollout; autoscaling restoration is blocked"
      exit 1
    fi
    if jq -e --arg expected "$expected" '
      (.failures // [] | length) == 0 and (.services | length) == 1 and
      all(.services[];
        .taskDefinition == $expected and .pendingCount == 0 and .runningCount == .desiredCount and
        (.deployments | length) == 1 and
        all(.deployments[]; .taskDefinition == $expected and .rolloutState == "COMPLETED"))
    ' <<< "$state" >/dev/null; then
      completed=true
      break
    fi
    echo "Waiting for $service's requested rollout to complete ($attempt)"
    sleep "${SERVICE_ROLLOUT_DELAY_SECONDS:-5}"
  done
  if [ "$completed" != true ]; then
    jq '{failures, services: [.services[] | {taskDefinition, desiredCount, runningCount, pendingCount,
      deployments: [.deployments[] | {taskDefinition, rolloutState, rolloutStateReason}]}]}' <<< "$state"
    echo "$service did not complete the requested rollout; autoscaling restoration is blocked"
    exit 1
  fi
  # Desired STOPPED tasks can still be alive during shutdown; inspect both lists.
  drained=false
  for ((attempt=1; attempt<=${TASK_DRAIN_ATTEMPTS:-60}; attempt++)); do
    drained=true
    for desired_status in RUNNING STOPPED; do
      task_arns="$(aws ecs list-tasks --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
        --service-name "$service" --desired-status "$desired_status" --query taskArns --output text)"
      batch=()
      for task in $task_arns; do
        if [ "$task" = None ]; then continue; fi
        batch+=("$task")
        if [ "${#batch[@]}" -eq 100 ]; then
          verify_tasks "$expected" "${batch[@]}" || drained=false
          batch=()
        fi
      done
      if [ "${#batch[@]}" -gt 0 ]; then verify_tasks "$expected" "${batch[@]}" || drained=false; fi
    done
    if [ "$drained" = true ]; then break; fi
    echo "Waiting for $service's old tasks to stop ($attempt)"
    sleep "${TASK_DRAIN_DELAY_SECONDS:-10}"
  done
  if [ "$drained" != true ]; then
    echo "$service still has old or transitioning tasks; autoscaling restoration is blocked"
    exit 1
  fi
done < "$RUNNER_TEMP/opencomp-expected-tasks"
