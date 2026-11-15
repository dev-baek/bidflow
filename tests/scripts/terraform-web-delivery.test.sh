#!/usr/bin/env sh
set -eu

module_dir=infra/terraform/modules/web_delivery

test -f "$module_dir/main.tf"
test -f "$module_dir/variables.tf"
test -f "$module_dir/outputs.tf"

rg -q 'aws_s3_bucket' "$module_dir"
rg -q 'aws_s3_bucket_public_access_block' "$module_dir"
rg -q 'aws_s3_bucket_policy' "$module_dir"
rg -q 'aws_cloudfront_origin_access_control' "$module_dir"
rg -q 'aws_cloudfront_distribution' "$module_dir"
rg -q 'cloudfront.amazonaws.com' "$module_dir"
rg -q 's3:GetObject' "$module_dir"
rg -q 'viewer_protocol_policy.*redirect-to-https' "$module_dir"
rg -q 'origin_access_control_id' "$module_dir"
rg -q 'module "web_delivery"' infra/terraform/environments/verification/main.tf
rg -q 'web_asset_bucket_name' infra/terraform/environments/verification/outputs.tf

if rg -q 'acl[[:space:]]*=[[:space:]]*"public-read"' "$module_dir"; then
  echo 'The web asset bucket must not use a public ACL.' >&2
  exit 1
fi
