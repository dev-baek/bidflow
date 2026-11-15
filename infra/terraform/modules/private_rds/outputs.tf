output "endpoint" {
  value = aws_db_instance.postgres.address
}

output "port" {
  value = aws_db_instance.postgres.port
}

output "master_user_secret_arn" {
  description = "RDS-managed secret ARN; do not export its value to Terraform variables or CI logs."
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
}
