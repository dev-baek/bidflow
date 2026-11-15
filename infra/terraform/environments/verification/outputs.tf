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
