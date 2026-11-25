terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  callback_url = "${var.web_origin}/auth/callback"
  logout_url   = "${var.web_origin}/login"
}

resource "aws_cognito_user_pool" "verification" {
  name                = var.name
  user_pool_tier      = "LITE"
  deletion_protection = "INACTIVE"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

resource "aws_cognito_user_pool_client" "browser" {
  name                                 = "${var.name}-browser"
  user_pool_id                         = aws_cognito_user_pool.verification.id
  generate_secret                      = false
  prevent_user_existence_errors        = "ENABLED"
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = [local.callback_url]
  logout_urls                          = [local.logout_url]
}

resource "aws_cognito_user_pool_domain" "login" {
  domain                = var.domain_prefix
  user_pool_id          = aws_cognito_user_pool.verification.id
  managed_login_version = 1
}
