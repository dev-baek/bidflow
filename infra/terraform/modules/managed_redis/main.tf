resource "random_password" "auth_token" {
  count   = var.enable_managed_redis ? 1 : 0
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "redis" {
  count                   = var.enable_managed_redis ? 1 : 0
  name                    = "${var.name}/redis"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "redis" {
  count         = var.enable_managed_redis ? 1 : 0
  secret_id     = aws_secretsmanager_secret.redis[0].id
  secret_string = jsonencode({ redis_auth_token = random_password.auth_token[0].result })
}

resource "aws_elasticache_subnet_group" "redis" {
  count      = var.enable_managed_redis ? 1 : 0
  name       = "${var.name}-redis"
  subnet_ids = var.data_subnet_ids
}

resource "aws_elasticache_replication_group" "redis" {
  count                      = var.enable_managed_redis ? 1 : 0
  replication_group_id       = "${var.name}-redis"
  description                = "Temporary BidFlow verification Redis."
  engine                     = "redis"
  node_type                  = "cache.t4g.micro"
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false
  subnet_group_name          = aws_elasticache_subnet_group.redis[0].name
  security_group_ids         = [var.redis_security_group_id]
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  auth_token                 = random_password.auth_token[0].result
  snapshot_retention_limit   = 0
  apply_immediately          = true
}
