#!/usr/bin/env sh
set -eu
module_dir=infra/terraform/modules/managed_redis
test -f "$module_dir/main.tf"
rg -q 'enable_managed_redis' "$module_dir"
rg -q 'default.*false' "$module_dir/variables.tf"
rg -q 'aws_elasticache_replication_group' "$module_dir"
rg -q 'transit_encryption_enabled.*true' "$module_dir"
rg -q 'at_rest_encryption_enabled.*true' "$module_dir"
rg -q 'aws_secretsmanager_secret' "$module_dir"
rg -q 'random_password' "$module_dir"
rg -q 'module "managed_redis"' infra/terraform/environments/verification/main.tf
