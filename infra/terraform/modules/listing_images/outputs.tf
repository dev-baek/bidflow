output "bucket_name" {
  value = aws_s3_bucket.images.bucket
  depends_on = [
    aws_s3_bucket_cors_configuration.images,
    aws_s3_bucket_ownership_controls.images,
    aws_s3_bucket_policy.images,
    aws_s3_bucket_server_side_encryption_configuration.images,
  ]
}

output "bucket_arn" {
  value = aws_s3_bucket.images.arn
}
