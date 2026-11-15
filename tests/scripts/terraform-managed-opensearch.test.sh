#!/usr/bin/env sh
set -eu
module_dir=infra/terraform/modules/managed_opensearch
test -f "$module_dir/main.tf"
rg -q 'enable_managed_search' "$module_dir"
rg -q 'default.*false' "$module_dir/variables.tf"
rg -q 'aws_opensearch_domain' "$module_dir"
rg -q 'vpc_options' "$module_dir"
rg -q 'encrypt_at_rest' "$module_dir"
rg -q 'node_to_node_encryption' "$module_dir"
rg -q 'enforce_https.*true' "$module_dir"
rg -q 'output "domain_arn"' "$module_dir/outputs.tf"
rg -q 'module "managed_opensearch"' infra/terraform/environments/verification/main.tf
