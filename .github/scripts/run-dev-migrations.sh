#!/usr/bin/env bash
set -euo pipefail

phase="${1:?Expected expand, contract, offline, or online phase}"
case "$phase" in expand|contract|offline|online) ;; *) echo 'Invalid migration phase'; exit 1 ;; esac
if [ "$phase" = offline ]; then
  test -s "$RUNNER_TEMP/opencomp-stopped-services" || {
    echo 'Offline migration requires a completed service drain'; exit 1;
  }
fi
task_definition="$(cat "$RUNNER_TEMP/opencomp-migrator-task")"
overrides="$RUNNER_TEMP/opencomp-migrator-overrides-$phase.json"
definition_json="$RUNNER_TEMP/opencomp-migrator-definition.json"
aws ecs describe-task-definition --region "$AWS_REGION" \
  --task-definition "$task_definition" --query taskDefinition --output json > "$definition_json"
jq --arg phase "$phase" -f .github/scripts/migrator-overrides.jq "$definition_json" > "$overrides"

task_arn="$(aws ecs run-task \
  --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --launch-type FARGATE \
  --task-definition "$task_definition" \
  --network-configuration "awsvpcConfiguration={subnets=[$MIGRATOR_SUBNETS],securityGroups=[$MIGRATOR_SECURITY_GROUP],assignPublicIp=ENABLED}" \
  --overrides "file://$overrides" --query 'tasks[0].taskArn' --output text)"
if [ -z "$task_arn" ] || [ "$task_arn" = None ]; then
  echo "ECS did not start the $phase migrator"
  exit 1
fi
echo "$phase migration task: $task_arn"
aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --tasks "$task_arn"
exit_code="$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$ECS_CLUSTER" \
  --tasks "$task_arn" --query 'tasks[0].containers[0].exitCode' --output text)"
if [ "$exit_code" != 0 ]; then
  echo "ECS $phase migrator exited with code $exit_code (task $task_arn)"
  aws logs get-log-events --region "$AWS_REGION" \
    --log-group-name /ecs/gideon-dev-opencomp-migrator \
    --log-stream-name "ecs/migrator/${task_arn##*/}" \
    --query 'events[].message' --output text || true
  exit 1
fi
