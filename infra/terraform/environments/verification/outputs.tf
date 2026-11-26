output "github_actions_role_arn" {
  description = "Configure this role in the GitHub Actions verification environment after its resource policy is added."
  value       = module.iam.github_actions_role_arn
}

output "application_instance_profile_name" {
  description = "Attach this profile to the Spring Boot EC2 launch template."
  value       = module.iam.application_instance_profile_name
}

output "web_asset_bucket_name" {
  description = "Private destination bucket for Vite assets; upload through the deployment workflow only."
  value       = module.web_delivery.bucket_name
}

output "web_cloudfront_domain_name" {
  description = "Temporary HTTPS domain for the Vite application after CloudFront deployment completes."
  value       = module.web_delivery.cloudfront_domain_name
}

output "application_ecr_repository_url" {
  description = "Push the Spring Boot OCI image here, then deploy by immutable digest only."
  value       = module.application_edge.ecr_repository_url
}

output "application_alb_dns_name" {
  description = "Temporary HTTPS endpoint after target registration and readiness checks succeed."
  value       = module.application_edge.alb_dns_name
}

output "application_autoscaling_group_name" {
  description = "ALB-backed private runtime group; absent while the runtime is disabled."
  value       = one(module.private_runtime[*].autoscaling_group_name)
}

output "postgres_endpoint" {
  description = "Private RDS hostname for the runtime secret assembly step; never expose publicly."
  value       = module.private_rds.endpoint
}

output "postgres_master_user_secret_arn" {
  description = "RDS-managed credential secret ARN; value retrieval is restricted to the EC2 runtime role."
  value       = module.private_rds.master_user_secret_arn
}

output "cognito_public_config" {
  description = "Public issuer, client and return URLs for the verification build; absent when Cognito is disabled."
  value       = local.cognito_public_config
}

output "verification_image_bucket_name" {
  description = "Dedicated verification image bucket for the approved upload and cleanup checks; absent when disabled."
  value       = one(module.listing_images[*].bucket_name)
}

output "verification_web_build_env" {
  description = "Only the public Vite inputs used when building the Cognito verification artifact."
  value = var.enable_cognito ? {
    VITE_AUTH_MODE            = "cognito"
    VITE_COGNITO_ISSUER       = local.cognito_public_config.issuer_uri
    VITE_COGNITO_ORIGIN       = local.cognito_public_config.login_origin
    VITE_COGNITO_CLIENT_ID    = local.cognito_public_config.client_id
    VITE_COGNITO_REDIRECT_URI = local.cognito_public_config.callback_url
    VITE_API_BASE_URL         = "https://${var.verification_api_fqdn}"
    VITE_WS_BASE_URL          = "wss://${var.verification_api_fqdn}"
  } : null
}
