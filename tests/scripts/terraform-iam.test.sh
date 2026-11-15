#!/usr/bin/env sh
set -eu

module_dir=infra/terraform/modules/iam

test -f "$module_dir/main.tf"
test -f "$module_dir/variables.tf"
test -f "$module_dir/outputs.tf"

rg -q 'aws_iam_role.*github_actions' "$module_dir"
rg -q 'AssumeRoleWithWebIdentity' "$module_dir"
rg -q 'token.actions.githubusercontent.com:sub' "$module_dir"
rg -q 'environment:verification' "$module_dir"
rg -q 'aws_iam_role.*application' "$module_dir"
rg -q 'aws_iam_instance_profile' "$module_dir"
rg -q 'ecr:GetAuthorizationToken' "$module_dir"
rg -q 's3:PutObject' "$module_dir"
rg -q 'secretsmanager:GetSecretValue' "$module_dir"
rg -q 'logs:PutLogEvents' "$module_dir"
rg -q 'kafka-cluster:Connect' "$module_dir"
rg -q 'AmazonSSMManagedInstanceCore' "$module_dir"

if rg -n 'AdministratorAccess|"\*"[[:space:]]*$|Action[[:space:]]*=[[:space:]]*"\*"' "$module_dir"; then
  echo 'IAM module must not grant administrator or wildcard actions.' >&2
  exit 1
fi
