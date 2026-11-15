locals {
  availability_zones = slice(var.availability_zones, 0, 2)
  public_subnets = {
    for index, availability_zone in local.availability_zones : availability_zone => cidrsubnet(var.vpc_cidr, 4, index)
  }
  application_subnets = {
    for index, availability_zone in local.availability_zones : availability_zone => cidrsubnet(var.vpc_cidr, 4, index + 2)
  }
  data_subnets = {
    for index, availability_zone in local.availability_zones : availability_zone => cidrsubnet(var.vpc_cidr, 4, index + 4)
  }
}

resource "terraform_data" "availability_zone_guard" {
  input = var.availability_zones

  lifecycle {
    precondition {
      condition     = length(var.availability_zones) >= 2
      error_message = "BidFlow verification network requires at least two availability zones."
    }
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_subnet" "public" {
  for_each = local.public_subnets

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false

  tags = {
    tier = "public-alb"
  }
}

resource "aws_subnet" "application" {
  for_each = local.application_subnets

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = each.value

  tags = {
    tier = "private-application"
  }
}

resource "aws_subnet" "data" {
  for_each = local.data_subnets

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = each.value

  tags = {
    tier = "private-data"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  count = var.enable_nat_gateway ? 1 : 0

  domain = "vpc"
}

resource "aws_nat_gateway" "this" {
  count = var.enable_nat_gateway ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = values(aws_subnet.public)[0].id

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "application" {
  vpc_id = aws_vpc.this.id
}

resource "aws_route" "application_nat" {
  count = var.enable_nat_gateway ? 1 : 0

  route_table_id         = aws_route_table.application.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}

resource "aws_route_table_association" "application" {
  for_each = aws_subnet.application

  subnet_id      = each.value.id
  route_table_id = aws_route_table.application.id
}

resource "aws_route_table" "data" {
  vpc_id = aws_vpc.this.id
}

resource "aws_route_table_association" "data" {
  for_each = aws_subnet.data

  subnet_id      = each.value.id
  route_table_id = aws_route_table.data.id
}

resource "aws_security_group" "alb" {
  name        = "bidflow-verification-alb"
  description = "Accepts public HTTPS and forwards only to the application security group."
  vpc_id      = aws_vpc.this.id
}

resource "aws_security_group" "application" {
  name        = "bidflow-verification-application"
  description = "Spring Boot instances receive HTTP only from the ALB."
  vpc_id      = aws_vpc.this.id
}

resource "aws_security_group" "postgres" {
  name        = "bidflow-verification-postgres"
  description = "PostgreSQL accepts traffic only from the application security group."
  vpc_id      = aws_vpc.this.id
}

resource "aws_security_group" "redis" {
  name        = "bidflow-verification-redis"
  description = "Redis accepts traffic only from the application security group."
  vpc_id      = aws_vpc.this.id
}

resource "aws_security_group" "kafka" {
  name        = "bidflow-verification-kafka"
  description = "Kafka accepts IAM-authenticated TLS traffic only from the application security group."
  vpc_id      = aws_vpc.this.id
}

resource "aws_security_group" "opensearch" {
  name        = "bidflow-verification-opensearch"
  description = "OpenSearch accepts HTTPS only from the application security group."
  vpc_id      = aws_vpc.this.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "Public HTTPS entry point."
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_to_application" {
  security_group_id            = aws_security_group.alb.id
  description                  = "ALB forwards traffic only to Spring Boot."
  referenced_security_group_id = aws_security_group.application.id
  from_port                    = 8080
  ip_protocol                  = "tcp"
  to_port                      = 8080
}

resource "aws_vpc_security_group_ingress_rule" "application_from_alb" {
  security_group_id            = aws_security_group.application.id
  description                  = "Spring Boot accepts HTTP only from the ALB."
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 8080
  ip_protocol                  = "tcp"
  to_port                      = 8080
}

resource "aws_vpc_security_group_egress_rule" "application_https" {
  security_group_id = aws_security_group.application.id
  description       = "Application may reach AWS HTTPS endpoints through explicit network routing."
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "application_to_postgres" {
  security_group_id            = aws_security_group.application.id
  referenced_security_group_id = aws_security_group.postgres.id
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "postgres_from_application" {
  security_group_id            = aws_security_group.postgres.id
  referenced_security_group_id = aws_security_group.application.id
  from_port                    = 5432
  ip_protocol                  = "tcp"
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "application_to_redis" {
  security_group_id            = aws_security_group.application.id
  referenced_security_group_id = aws_security_group.redis.id
  from_port                    = 6379
  ip_protocol                  = "tcp"
  to_port                      = 6379
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_application" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.application.id
  from_port                    = 6379
  ip_protocol                  = "tcp"
  to_port                      = 6379
}

resource "aws_vpc_security_group_egress_rule" "application_to_kafka" {
  security_group_id            = aws_security_group.application.id
  referenced_security_group_id = aws_security_group.kafka.id
  from_port                    = 9098
  ip_protocol                  = "tcp"
  to_port                      = 9098
}

resource "aws_vpc_security_group_ingress_rule" "kafka_from_application" {
  security_group_id            = aws_security_group.kafka.id
  referenced_security_group_id = aws_security_group.application.id
  from_port                    = 9098
  ip_protocol                  = "tcp"
  to_port                      = 9098
}

resource "aws_vpc_security_group_egress_rule" "application_to_opensearch" {
  security_group_id            = aws_security_group.application.id
  referenced_security_group_id = aws_security_group.opensearch.id
  from_port                    = 443
  ip_protocol                  = "tcp"
  to_port                      = 443
}

resource "aws_vpc_security_group_ingress_rule" "opensearch_from_application" {
  security_group_id            = aws_security_group.opensearch.id
  referenced_security_group_id = aws_security_group.application.id
  from_port                    = 443
  ip_protocol                  = "tcp"
  to_port                      = 443
}
