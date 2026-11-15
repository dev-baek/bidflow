#!/usr/bin/env sh
set -eu

module_dir=infra/terraform/modules/private_rds

test -f "$module_dir/main.tf"
test -f "$module_dir/variables.tf"
test -f "$module_dir/outputs.tf"

rg -q 'aws_db_subnet_group' "$module_dir"
rg -q 'aws_db_instance' "$module_dir"
rg -q 'publicly_accessible.*false' "$module_dir"
rg -q 'storage_encrypted.*true' "$module_dir"
rg -q 'manage_master_user_password.*true' "$module_dir"
rg -q 'skip_final_snapshot.*true' "$module_dir"
rg -q 'vpc_security_group_ids' "$module_dir"
rg -q 'module "private_rds"' infra/terraform/environments/verification/main.tf
rg -q 'postgres_endpoint' infra/terraform/environments/verification/outputs.tf

if rg -P -q '^\s*password\s*=' "$module_dir"; then
  echo 'RDS password must be managed by RDS Secrets Manager integration, not Terraform input.' >&2
  exit 1
fi
