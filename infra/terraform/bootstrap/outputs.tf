output "state_bucket_name" {
  description = "Use this value in the verification backend configuration."
  value       = aws_s3_bucket.terraform_state.bucket
}

output "lock_table_name" {
  description = "Use this value while the verification backend uses DynamoDB locking."
  value       = aws_dynamodb_table.terraform_lock.name
}
