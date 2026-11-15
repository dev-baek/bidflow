resource "aws_msk_serverless_cluster" "kafka" {
  count        = var.enable_managed_kafka ? 1 : 0
  cluster_name = "${var.name}-kafka"

  vpc_config {
    subnet_ids         = var.data_subnet_ids
    security_group_ids = [var.kafka_security_group_id]
  }

  client_authentication {
    sasl {
      iam {
        enabled = true
      }
    }
  }
}
