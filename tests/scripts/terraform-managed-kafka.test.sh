#!/usr/bin/env sh
set -eu
module_dir=infra/terraform/modules/managed_kafka
test -f "$module_dir/main.tf"
rg -q 'enable_managed_kafka' "$module_dir"
rg -q 'default.*false' "$module_dir/variables.tf"
rg -q 'aws_msk_serverless_cluster' "$module_dir"
rg -q 'subnet_ids' "$module_dir"
rg -q 'security_group_ids' "$module_dir"
rg -q 'module "managed_kafka"' infra/terraform/environments/verification/main.tf
