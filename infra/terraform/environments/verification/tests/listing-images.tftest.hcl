mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::bidflow-verification-123456789012-images" }
  }
}

run "bucket_is_private_and_accepts_only_cloudfront_put" {
  command = apply
  module {
    source = "../../modules/listing_images"
  }
  variables {
    bucket_name = "bidflow-verification-123456789012-images"
    web_origin  = "https://d123example.cloudfront.net"
  }

  assert {
    condition = (
      !aws_s3_bucket.images.force_destroy &&
      aws_s3_bucket_public_access_block.images.block_public_acls &&
      aws_s3_bucket_public_access_block.images.block_public_policy &&
      aws_s3_bucket_public_access_block.images.ignore_public_acls &&
      aws_s3_bucket_public_access_block.images.restrict_public_buckets &&
      aws_s3_bucket_ownership_controls.images.rule[0].object_ownership == "BucketOwnerEnforced" &&
      one(one(aws_s3_bucket_server_side_encryption_configuration.images.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    )
    error_message = "The image bucket must be private, ACL-free, encrypted, and require explicit cleanup."
  }

  assert {
    condition = (
      toset(one(aws_s3_bucket_cors_configuration.images.cors_rule).allowed_origins) == toset(["https://d123example.cloudfront.net"]) &&
      toset(one(aws_s3_bucket_cors_configuration.images.cors_rule).allowed_methods) == toset(["PUT"]) &&
      toset(one(aws_s3_bucket_cors_configuration.images.cors_rule).allowed_headers) == toset(["Content-Type", "If-None-Match"])
    )
    error_message = "Only CloudFront PUT and the two signed request headers may be allowed."
  }

  assert {
    condition = one(jsondecode(aws_s3_bucket_policy.images.policy).Statement) == {
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = ["arn:aws:s3:::bidflow-verification-123456789012-images", "arn:aws:s3:::bidflow-verification-123456789012-images/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }
    error_message = "The bucket policy must deny insecure access and must not grant public permissions."
  }
}

run "runtime_has_no_image_policy_when_disabled" {
  command = plan
  module {
    source = "../../modules/iam"
  }
  variables {
    account_id               = "123456789012"
    region                   = "ap-northeast-1"
    github_oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  }

  assert {
    condition     = length(aws_iam_role_policy.application_image_storage) == 0
    error_message = "No image-bucket permissions should be attached before enabling uploads."
  }
}

run "runtime_role_gets_only_the_dedicated_image_permissions" {
  command = plan
  module {
    source = "../../modules/iam"
  }
  variables {
    account_id               = "123456789012"
    region                   = "ap-northeast-1"
    github_oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    image_storage            = { bucket_arn = "arn:aws:s3:::bidflow-verification-123456789012-images" }
  }

  assert {
    condition = jsondecode(aws_iam_role_policy.application_image_storage[0].policy).Statement == [
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = ["arn:aws:s3:::bidflow-verification-123456789012-images"] },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["arn:aws:s3:::bidflow-verification-123456789012-images/products/*"] },
    ]
    error_message = "Listing is bucket-scoped; GET/PUT are limited to products and must not grant deletes."
  }
}
