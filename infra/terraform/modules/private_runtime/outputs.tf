output "autoscaling_group_name" {
  value = aws_autoscaling_group.application.name
}

output "launch_template_id" {
  value = aws_launch_template.application.id
}
