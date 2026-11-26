output "github_actions_role_arn" {
  value = aws_iam_role.github_actions.arn
}

output "application_role_arn" {
  value = aws_iam_role.application.arn
}

output "application_instance_profile_name" {
  value = aws_iam_instance_profile.application.name

  depends_on = [aws_iam_role_policy.application_bootstrap, aws_iam_role_policy.application_image_storage]
}
