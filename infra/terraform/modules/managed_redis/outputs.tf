output "endpoint" { value = var.enable_managed_redis ? aws_elasticache_replication_group.redis[0].primary_endpoint_address : null }
output "secret_arn" { value = var.enable_managed_redis ? aws_secretsmanager_secret.redis[0].arn : null }
