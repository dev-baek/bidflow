output "cluster_arn" { value = var.enable_managed_kafka ? aws_msk_serverless_cluster.kafka[0].arn : null }
output "bootstrap_brokers_sasl_iam" { value = var.enable_managed_kafka ? aws_msk_serverless_cluster.kafka[0].bootstrap_brokers_sasl_iam : null }
