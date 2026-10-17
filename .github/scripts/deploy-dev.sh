#!/usr/bin/env bash
set -euo pipefail

# DEPLOY MODE CONTRACT — read before changing this file.
#
# Rolling deploys apply compatible migrations before new images. They do not
# stop services or require an attestation. The online driver rejects pending
# maintenance migrations before it writes to the database.
#
# Draining (offline) migrations are the rare exception, not the rule. Enable
# them temporarily per run via RUN_OFFLINE_MIGRATIONS=true only when a
# migration cannot run while old code is live (e.g. column renames). Do NOT
# re-introduce a gate that blocks plain deploys without an attestation —
# that was tried and removed because it blocked every routine deploy.

offline_migrations="${RUN_OFFLINE_MIGRATIONS:-false}"
case "$offline_migrations" in
  true|false) ;;
  *) echo 'RUN_OFFLINE_MIGRATIONS must be true or false'; exit 1 ;;
esac

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
if [ "$offline_migrations" = true ]; then
  bash .github/scripts/stop-dev-services.sh
  bash .github/scripts/run-dev-migrations.sh offline
else
  echo 'Rolling image deploy (default): applying compatible migrations without stopping services.'
  bash .github/scripts/run-dev-migrations.sh online
fi

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
# Validate all saved counts before restarting services after maintenance.
for service_definition in "${service_definitions[@]}"; do
  IFS='|' read -r service task_definition <<< "$service_definition"
  desired_count=''
  if [ "$offline_migrations" = true ]; then
    if ! desired_count="$(awk -F'|' -v service="$service" '
    $1 == service {matches++; count = $2; if (NF != 2 || $2 !~ /^[0-9]+$/) invalid = 1}
    END {if (matches != 1 || invalid) exit 1; print count}
    ' "$RUNNER_TEMP/opencomp-service-counts")"; then
      echo "Invalid or missing desired count for $service; all service restarts are blocked"
      exit 1
    fi
  fi
  printf '%s|%s|%s\n' "$service" "$task_definition" "$desired_count" >> "$restart_plan"
done

while IFS='|' read -r service task_definition desired_count; do
  deployment_args=(--task-definition "$task_definition")
  if [ "$offline_migrations" = true ]; then
    deployment_args+=(--desired-count "$desired_count")
  fi
  aws ecs update-service \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --service "$service" \
    "${deployment_args[@]}" \
    --deployment-configuration 'deploymentCircuitBreaker={enable=true,rollback=false}' \
    --force-new-deployment \
    >/dev/null
  printf '%s|%s\n' "$service" "$task_definition" >> "$RUNNER_TEMP/opencomp-expected-tasks"
done < "$restart_plan"
