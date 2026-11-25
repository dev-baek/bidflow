output "public_config" {
  value = {
    issuer_uri   = "https://${aws_cognito_user_pool.verification.endpoint}"
    client_id    = aws_cognito_user_pool_client.browser.id
    login_origin = "https://${aws_cognito_user_pool_domain.login.domain}.auth.${var.region}.amazoncognito.com"
    callback_url = local.callback_url
    logout_url   = local.logout_url
  }
}
