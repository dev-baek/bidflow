#!/usr/bin/env sh
set -eu

module_dir=infra/terraform/modules/application_edge

test -f "$module_dir/main.tf"
test -f "$module_dir/variables.tf"
test -f "$module_dir/outputs.tf"

rg -q 'aws_ecr_repository' "$module_dir"
rg -q 'image_tag_mutability.*IMMUTABLE' "$module_dir"
rg -q 'scan_on_push.*true' "$module_dir"
rg -q 'aws_lb' "$module_dir"
rg -q 'load_balancer_type.*application' "$module_dir"
rg -q 'internal.*false' "$module_dir"
rg -q 'aws_lb_target_group' "$module_dir"
rg -q '/actuator/health/readiness' "$module_dir"
rg -q 'matcher.*200' "$module_dir"
rg -q 'aws_lb_listener' "$module_dir"
rg -q 'protocol.*HTTPS' "$module_dir"
rg -q 'module "application_edge"' infra/terraform/environments/verification/main.tf
rg -q 'application_ecr_repository_url' infra/terraform/environments/verification/outputs.tf
rg -q 'application_alb_dns_name' infra/terraform/environments/verification/outputs.tf

if rg -P -q 'port\s*=\s*80(?![0-9])' "$module_dir"; then
  echo 'The public ALB must not expose an HTTP listener.' >&2
  exit 1
fi
