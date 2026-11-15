output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = values(aws_subnet.public)[*].id
}

output "application_subnet_ids" {
  value = values(aws_subnet.application)[*].id
}

output "data_subnet_ids" {
  value = values(aws_subnet.data)[*].id
}

output "security_group_ids" {
  value = {
    alb         = aws_security_group.alb.id
    application = aws_security_group.application.id
    postgres    = aws_security_group.postgres.id
    redis       = aws_security_group.redis.id
    kafka       = aws_security_group.kafka.id
    opensearch  = aws_security_group.opensearch.id
  }
}
