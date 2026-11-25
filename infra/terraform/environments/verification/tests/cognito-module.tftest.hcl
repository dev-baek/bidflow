mock_provider "aws" {}

run "classic_public_client_has_exact_oauth_contract" {
  command = plan

  module {
    source = "../../modules/cognito"
  }

  variables {
    name          = "bidflow-mock"
    region        = "ap-northeast-1"
    domain_prefix = "bidflow-mock-test"
    web_origin    = "https://d123example.cloudfront.net"
  }

  assert {
    condition     = aws_cognito_user_pool.verification.user_pool_tier == "LITE" && aws_cognito_user_pool.verification.admin_create_user_config[0].allow_admin_create_user_only && aws_cognito_user_pool.verification.deletion_protection == "INACTIVE"
    error_message = "The temporary pool must use Lite, restrict public sign-up, and remain eligible for verified teardown."
  }

  assert {
    condition = (
      !aws_cognito_user_pool_client.browser.generate_secret &&
      aws_cognito_user_pool_client.browser.allowed_oauth_flows_user_pool_client &&
      aws_cognito_user_pool_client.browser.allowed_oauth_flows == toset(["code"]) &&
      aws_cognito_user_pool_client.browser.allowed_oauth_scopes == toset(["openid"]) &&
      aws_cognito_user_pool_client.browser.supported_identity_providers == toset(["COGNITO"]) &&
      aws_cognito_user_pool_client.browser.callback_urls == toset(["https://d123example.cloudfront.net/auth/callback"]) &&
      aws_cognito_user_pool_client.browser.logout_urls == toset(["https://d123example.cloudfront.net/login"])
    )
    error_message = "The public client must accept only the required OAuth flow, scope, provider and exact CloudFront URLs."
  }

  assert {
    condition     = aws_cognito_user_pool_domain.login.managed_login_version == 1 && aws_cognito_user_pool_domain.login.domain == "bidflow-mock-test"
    error_message = "The login domain must use the configured Cognito classic prefix."
  }
}
