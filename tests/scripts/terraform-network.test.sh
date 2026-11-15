#!/usr/bin/env sh
set -eu

module_dir=infra/terraform/modules/network

test -f "$module_dir/main.tf"
test -f "$module_dir/variables.tf"
test -f "$module_dir/outputs.tf"

rg -q 'aws_vpc' "$module_dir"
rg -q 'aws_internet_gateway' "$module_dir"
rg -q 'aws_subnet.*public' "$module_dir"
rg -q 'aws_subnet.*application' "$module_dir"
rg -q 'aws_subnet.*data' "$module_dir"
rg -q 'aws_route_table.*data' "$module_dir"
rg -q 'aws_security_group.*alb' "$module_dir"
rg -q 'aws_security_group.*application' "$module_dir"
rg -q 'aws_security_group.*postgres' "$module_dir"
rg -q 'aws_security_group.*redis' "$module_dir"
rg -q 'aws_security_group.*kafka' "$module_dir"
rg -q 'aws_security_group.*opensearch' "$module_dir"
rg -q 'var.enable_nat_gateway' "$module_dir"
rg -q 'default.*false' "$module_dir/variables.tf"

internet_rule_count=$(rg -o 'cidr_ipv4[[:space:]]*=[[:space:]]*"0\.0\.0\.0/0"' "$module_dir" | wc -l | tr -d ' ')
if [ "$internet_rule_count" -ne 2 ]; then
  echo 'Only the ALB ingress and application HTTPS egress may use the public internet CIDR.' >&2
  exit 1
fi
