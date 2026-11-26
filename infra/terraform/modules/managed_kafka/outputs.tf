output "cluster_arn" { value = var.enable_managed_kafka ? aws_msk_serverless_cluster.kafka[0].arn : null }
output "cluster_name" { value = var.enable_managed_kafka ? aws_msk_serverless_cluster.kafka[0].cluster_name : null }
output "bootstrap_brokers_sasl_iam" { value = var.enable_managed_kafka ? aws_msk_serverless_cluster.kafka[0].bootstrap_brokers_sasl_iam : null }
