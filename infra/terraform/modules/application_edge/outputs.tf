output "ecr_repository_url" {
  value = aws_ecr_repository.application.repository_url
}

output "target_group_arn" {
  value = aws_lb_target_group.application.arn
}

output "alb_dns_name" {
  value = aws_lb.application.dns_name
}
