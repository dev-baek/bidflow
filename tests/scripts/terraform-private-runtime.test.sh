#!/usr/bin/env sh
set -eu

module_dir=infra/terraform/modules/private_runtime

test -f "$module_dir/main.tf"
test -f "$module_dir/variables.tf"
test -f "$module_dir/outputs.tf"
test -f "$module_dir/user-data.sh.tftpl"

rg -q 'aws_launch_template' "$module_dir"
rg -q 'aws_autoscaling_group' "$module_dir"
rg -q 'associate_public_ip_address.*false' "$module_dir"
rg -q 'http_tokens.*required' "$module_dir"
rg -q 'encrypted.*true' "$module_dir"
rg -q 'target_group_arns' "$module_dir"
rg -q 'health_check_type.*ELB' "$module_dir"
rg -q 'instance_refresh' "$module_dir"
rg -q 'application_image' "$module_dir/user-data.sh.tftpl"
rg -q 'get-secret-value' "$module_dir/user-data.sh.tftpl"
rg -q 'enable_nat_gateway' "$module_dir"
rg -q 'module "private_runtime"' infra/terraform/environments/verification/main.tf
rg -q 'application_autoscaling_group_name' infra/terraform/environments/verification/outputs.tf

if rg -q 'key_name' "$module_dir"; then
  echo 'Private runtime instances must be operated through SSM, not SSH key pairs.' >&2
  exit 1
fi
