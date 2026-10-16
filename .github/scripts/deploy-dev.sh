#!/usr/bin/env bash
set -euo pipefail

register_task_definition() {
  local family="$1"
  local image="$2"
  local task_definition_file
  local registered_arn

  task_definition_file="$(mktemp)"
  aws ecs describe-task-definition \
    --region "$AWS_REGION" \
    --task-definition "$family" \
    --query taskDefinition \
    --output json \
    | jq --arg image "$image" '
        del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
            .compatibilities, .registeredAt, .registeredBy)
        | .containerDefinitions |= map(.image = $image)
      ' > "$task_definition_file"

  registered_arn="$(aws ecs register-task-definition \
    --region "$AWS_REGION" \
    --cli-input-json "file://$task_definition_file" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)"
  rm -f "$task_definition_file"
  printf '%s\n' "$registered_arn"
}

api_image="$ECR_REGISTRY/gideon-dev-opencomp-api:$IMAGE_TAG"
app_image="$ECR_REGISTRY/gideon-dev-opencomp-app:$IMAGE_TAG"
mcp_image="$ECR_REGISTRY/gideon-dev-opencomp-mcp:$IMAGE_TAG"
trust_image="$ECR_REGISTRY/gideon-dev-opencomp-trust-center:$IMAGE_TAG"
migrator_image="$ECR_REGISTRY/gideon-dev-opencomp-migrator:$IMAGE_TAG"

api_task_definition="$(register_task_definition gideon-dev-opencomp-api "$api_image")"
app_task_definition="$(register_task_definition gideon-dev-opencomp-app "$app_image")"
trust_task_definition="$(register_task_definition gideon-dev-opencomp-trust-center "$trust_image")"
mcp_task_definition="$(register_task_definition gideon-dev-opencomp-mcp "$mcp_image")"
email_task_definition="$(register_task_definition gideon-dev-opencomp-email-worker "$api_image")"
migrator_task_definition="$(register_task_definition gideon-dev-opencomp-migrator "$migrator_image")"

printf '%s\n' "$migrator_task_definition" > "$RUNNER_TEMP/opencomp-migrator-task"
bash .github/scripts/stop-dev-services.sh
bash .github/scripts/run-dev-migrations.sh offline

: > "$RUNNER_TEMP/opencomp-expected-tasks"

service_definitions=(
  "gideon-dev-opencomp-mcp|$mcp_task_definition" \
  "gideon-dev-opencomp-api|$api_task_definition" \
  "gideon-dev-opencomp-app|$app_task_definition" \
  "gideon-dev-opencomp-trust-center|$trust_task_definition" \
  "gideon-dev-opencomp-email-worker|$email_task_definition"
)
restart_plan="$RUNNER_TEMP/opencomp-restart-plan"
: > "$restart_plan"
# Validate the complete snapshot before starting even the first service.
for service_definition in "${service_definitions[@]}"; do
  IFS='|' read -r service task_definition <<< "$service_definition"
  if ! desired_count="$(awk -F'|' -v service="$service" '
    $1 == service {matches++; count = $2; if (NF != 2 || $2 !~ /^[0-9]+$/) invalid = 1}
    END {if (matches != 1 || invalid) exit 1; print count}
  ' "$RUNNER_TEMP/opencomp-service-counts")"; then
    echo "Invalid or missing desired count for $service; all service restarts are blocked"
    exit 1
  fi
  printf '%s|%s|%s\n' "$service" "$task_definition" "$desired_count" >> "$restart_plan"
done

while IFS='|' read -r service task_definition desired_count; do
  aws ecs update-service \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --service "$service" \
    --task-definition "$task_definition" \
    --desired-count "$desired_count" \
    --deployment-configuration 'deploymentCircuitBreaker={enable=true,rollback=false}' \
    --force-new-deployment \
    >/dev/null
  printf '%s|%s\n' "$service" "$task_definition" >> "$RUNNER_TEMP/opencomp-expected-tasks"
done < "$restart_plan"
