mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_region" {
    defaults = { region = "ap-northeast-1" }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-northeast-1a", "ap-northeast-1c"] }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = { domain_name = "d123example.cloudfront.net" }
  }
  mock_resource "aws_cognito_user_pool" {
    defaults = { endpoint = "cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test" }
  }
  mock_resource "aws_cognito_user_pool_client" {
    defaults = { id = "mockclient123" }
  }
}

mock_provider "random" {}

variables {
  expected_account_id            = "123456789012"
  region                         = "ap-northeast-1"
  owner                          = "mock-only"
  ttl                            = "2030-01-01T00:00:00Z"
  github_oidc_provider_arn       = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  alb_certificate_arn            = "arn:aws:acm:ap-northeast-1:123456789012:certificate/11111111-2222-4333-8444-555555555555"
  application_ami_id             = "ami-123abc"
  application_image              = "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/bidflow-verification-application@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  application_runtime_secret_arn = "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:mock-only"
  enable_nat_gateway             = true
  verification_api_fqdn          = "api.example.test"
}

run "default_creates_no_cognito_module_or_config" {
  command = plan

  assert {
    condition     = length(module.cognito) == 0 && output.cognito_public_config == null && output.verification_web_build_env == null && length(module.listing_images) == 0 && output.verification_image_bucket_name == null
    error_message = "Verification must not create Cognito or expose settings until enabled."
  }
}

run "image_storage_requires_cognito" {
  command = plan
  variables {
    enable_listing_images = true
  }
  expect_failures = [var.enable_listing_images]
}

run "enabled_images_use_the_verification_bucket_name" {
  command = apply

  plan_options {
    target = [module.listing_images]
  }

  variables {
    enable_listing_images = true
    enable_cognito        = true
    cognito_domain_prefix = "bidflow-mock-test"
  }

  assert {
    condition     = length(module.listing_images) == 1 && output.verification_image_bucket_name == "bidflow-verification-123456789012-images"
    error_message = "The dedicated image bucket must use the application naming contract."
  }
}

run "image_configuration_can_plan_with_unknown_bucket_arn" {
  command = plan
  variables {
    enable_listing_images = true
    enable_cognito        = true
    cognito_domain_prefix = "bidflow-mock-test"
  }

  assert {
    condition     = length(module.listing_images) == 1
    error_message = "The full verification plan must not need an already-known image bucket ARN to determine resource counts."
  }
}

run "enabled_without_domain_prefix_is_rejected" {
  command = plan
  variables {
    enable_cognito = true
  }
  expect_failures = [var.cognito_domain_prefix]
}

run "enabled_with_invalid_domain_prefix_is_rejected" {
  command = plan
  variables {
    enable_cognito        = true
    cognito_domain_prefix = "https://external.example.test"
  }
  expect_failures = [var.cognito_domain_prefix]
}

run "enabled_config_uses_the_real_web_delivery_output" {
  command = apply

  plan_options {
    target = [module.cognito]
  }

  variables {
    enable_cognito        = true
    cognito_domain_prefix = "bidflow-mock-test"
  }

  assert {
    condition = length(module.cognito) == 1 && output.cognito_public_config == {
      issuer_uri   = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test"
      client_id    = "mockclient123"
      login_origin = "https://bidflow-mock-test.auth.ap-northeast-1.amazoncognito.com"
      callback_url = "https://d123example.cloudfront.net/auth/callback"
      logout_url   = "https://d123example.cloudfront.net/login"
    }
    error_message = "Enabled Cognito must publish exactly the five settings derived from the mocked provider and existing CloudFront module."
  }

  assert {
    condition     = output.verification_web_build_env.VITE_API_BASE_URL == "https://api.example.test" && output.verification_web_build_env.VITE_WS_BASE_URL == "wss://api.example.test" && output.verification_web_build_env.VITE_COGNITO_ISSUER == output.cognito_public_config.issuer_uri && output.verification_web_build_env.VITE_COGNITO_CLIENT_ID == output.cognito_public_config.client_id
    error_message = "Vite must receive the same Cognito configuration and path-free API endpoints."
  }
}

run "enabled_without_api_fqdn_is_rejected" {
  command = plan
  variables {
    enable_cognito        = true
    cognito_domain_prefix = "bidflow-mock-test"
    verification_api_fqdn = null
  }
  expect_failures = [var.verification_api_fqdn]
}

run "enabled_with_api_url_or_port_is_rejected" {
  command = plan
  variables {
    enable_cognito        = true
    cognito_domain_prefix = "bidflow-mock-test"
    verification_api_fqdn = "https://api.example.test:443"
  }
  expect_failures = [var.verification_api_fqdn]
}

run "enabled_cognito_requires_the_verification_account" {
  command = plan

  plan_options {
    target = [module.cognito]
  }

  variables {
    enable_cognito             = true
    cognito_domain_prefix      = "bidflow-mock-test"
    expected_account_id        = "999999999999"
    enable_application_runtime = false
  }

  expect_failures = [terraform_data.verification_guard]
}
