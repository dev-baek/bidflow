output "endpoint" { value = var.enable_managed_search ? aws_opensearch_domain.search[0].endpoint : null }

output "domain_arn" { value = var.enable_managed_search ? aws_opensearch_domain.search[0].arn : null }
