#!/usr/bin/env bash
# Operator-only AWS writes. Never executed by automated tests or CI.
set -euo pipefail
if [[ -n "${CI:-}" || "${1:-}" != "--execute" ]]; then
  echo 'Operator only: release.sh --execute <staging|production> <full git SHA>. Never run in CI.' >&2
  exit 1
fi
stage="${2:-}"; sha="${3:-}"
[[ "$stage" =~ ^(staging|production)$ && "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid stage or full SHA' >&2; exit 1; }
for tool in aws docker git jq; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
root="$(git rev-parse --show-toplevel)"
cd "$root"
[[ "$(git rev-parse HEAD)" == "$sha" ]] || { echo 'Checkout the requested SHA before release' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo 'Tracked working files must be clean' >&2; exit 1; }
: "${AWS_REGION:?Set AWS_REGION to the deployment region}"
work="$(mktemp -d)"
trap 'rm -f "$work"/*.json; rmdir "$work"' EXIT
aws cloudformation describe-stacks --stack-name "crm-$stage-app" --region "$AWS_REGION" > "$work/stack.json"
output() { jq -er --arg key "$1" '.Stacks[0].Outputs[] | select(.OutputKey == $key) | .OutputValue' "$work/stack.json"; }
[[ "$(output Stage)" == "$stage" && "$(output Region)" == "$AWS_REGION" ]] || { echo 'Stack stage or region mismatch' >&2; exit 1; }
cluster="$(output Cluster)"; web="$(output WebService)"; worker="$(output WorkerService)"
aws ecs describe-services --cluster "$cluster" --services "$web" "$worker" --region "$AWS_REGION" > "$work/services.json"
jq -e '.failures | length == 0' "$work/services.json" >/dev/null
previous_web="$(jq -er --arg name "$web" '.services[] | select(.serviceName == $name) | .taskDefinition' "$work/services.json")"
previous_worker="$(jq -er --arg name "$worker" '.services[] | select(.serviceName == $name) | .taskDefinition' "$work/services.json")"
# Printed before writes so it survives a failed migration/rollout; these contain no credential values.
printf 'ROLLBACK: aws ecs update-service --region %q --cluster %q --service %q --task-definition %q\n' "$AWS_REGION" "$cluster" "$web" "$previous_web"
printf 'ROLLBACK: aws ecs update-service --region %q --cluster %q --service %q --task-definition %q\n' "$AWS_REGION" "$cluster" "$worker" "$previous_worker"
registry="$(output webRepository)"; registry="${registry%%/*}"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$registry"
declare -A task_definitions
for name in web worker migrate; do
  repository="$(output "${name}Repository")"
  docker build --platform linux/amd64 --target "$name" -t "$repository:$sha" .
  # Immutable SHA tags allow resuming after partial releases without overwriting any image.
  if ! aws ecr describe-images --region "$AWS_REGION" --repository-name "${repository#*/}" --image-ids "imageTag=$sha" > "$work/image.json" 2> "$work/image-error.json"; then
    if ! jq -e . "$work/image-error.json" >/dev/null 2>&1 && grep -q ImageNotFoundException "$work/image-error.json"; then
      docker push "$repository:$sha"
    else echo 'Cannot verify immutable ECR image (permission/network error); release stopped' >&2; exit 1; fi
  fi
  template="$(output "${name}TaskDefinition")"
  aws ecs describe-task-definition --task-definition "$template" --region "$AWS_REGION" > "$work/current-$name.json"
  jq --arg image "$repository:$sha" --arg name "$name" '.taskDefinition
    | del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy,.deregisteredAt)
    | .containerDefinitions |= map(if .name == $name then .image = $image else . end)' "$work/current-$name.json" > "$work/new-$name.json"
  task_definitions[$name]="$(aws ecs register-task-definition --cli-input-json "file://$work/new-$name.json" --region "$AWS_REGION" --query taskDefinition.taskDefinitionArn --output text)"
done
network="$(jq -cn --arg subnets "$(output PrivateSubnets)" --arg sg "$(output MigrateSecurityGroup)" '{awsvpcConfiguration:{subnets:($subnets|split(",")),securityGroups:[$sg],assignPublicIp:"DISABLED"}}')"
aws ecs run-task --cluster "$cluster" --task-definition "${task_definitions[migrate]}" --launch-type FARGATE --platform-version 1.4.0 --network-configuration "$network" --region "$AWS_REGION" > "$work/migrate.json"
jq -e '.failures | length == 0' "$work/migrate.json" >/dev/null
migration="$(jq -er '.tasks[0].taskArn' "$work/migrate.json")"
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$migration" --region "$AWS_REGION"
aws ecs describe-tasks --cluster "$cluster" --tasks "$migration" --region "$AWS_REGION" > "$work/migration-result.json"
migration_exit="$(jq -er '.tasks[0].containers[] | select(.name == "migrate") | .exitCode' "$work/migration-result.json")"
[[ "$migration_exit" == '0' ]] || { echo "Migration failed (exit $migration_exit); services unchanged. Inspect migrate logs." >&2; exit 1; }
aws ecs update-service --cluster "$cluster" --service "$web" --task-definition "${task_definitions[web]}" --desired-count "$(output WebCount)" --region "$AWS_REGION" > "$work/web-update.json"
aws ecs update-service --cluster "$cluster" --service "$worker" --task-definition "${task_definitions[worker]}" --desired-count "$(output WorkerCount)" --region "$AWS_REGION" > "$work/worker-update.json"
aws ecs wait services-stable --cluster "$cluster" --services "$web" "$worker" --region "$AWS_REGION"
aws ecs describe-services --cluster "$cluster" --services "$web" "$worker" --region "$AWS_REGION" > "$work/final.json"
# The waiter can succeed after circuit-breaker rollback: verify the intended definitions actually won.
jq -e --arg web "${task_definitions[web]}" --arg worker "${task_definitions[worker]}" '
  (.failures|length == 0) and (.services|length == 2) and
  all(.services[]; (.taskDefinition == $web or .taskDefinition == $worker) and (.deployments|length == 1) and (.runningCount == .desiredCount) and .desiredCount > 0)' "$work/final.json" >/dev/null
echo "Released $sha to $stage. Confirm HTTPS readiness and worker readiness; persist release SHA for the next CDK deployment."
