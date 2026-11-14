#!/usr/bin/env sh
set -eu

test -f infra/terraform/bootstrap/main.tf
test -f infra/terraform/bootstrap/variables.tf
test -f infra/terraform/environments/verification/main.tf
test -f infra/terraform/environments/verification/backend.tf
test -f infra/terraform/environments/verification/variables.tf
test -f infra/terraform/environments/verification/backend.hcl.example

rg -q 'aws_s3_bucket' infra/terraform/bootstrap
rg -q 'aws_dynamodb_table' infra/terraform/bootstrap
rg -q 'aws_s3_bucket_versioning' infra/terraform/bootstrap
rg -q 'aws_s3_bucket_server_side_encryption_configuration' infra/terraform/bootstrap
rg -q 'expected_account_id' infra/terraform/bootstrap infra/terraform/environments/verification
rg -q 'environment.*verification' infra/terraform/environments/verification
rg -q 'ttl' infra/terraform/environments/verification
rg -q 'backend "s3"' infra/terraform/environments/verification/backend.tf

if rg -n --glob '*.tf' --glob '*.tfvars*' '(access_key|secret_key|password)[[:space:]]*=' infra/terraform; then
  echo 'Terraform source must not contain credential values.' >&2
  exit 1
fi
