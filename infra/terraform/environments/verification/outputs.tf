output "github_actions_role_arn" {
  description = "Configure this role in the GitHub Actions verification environment after its resource policy is added."
  value       = module.iam.github_actions_role_arn
}

output "application_instance_profile_name" {
  description = "Attach this profile to the Spring Boot EC2 launch template."
  value       = module.iam.application_instance_profile_name
}
