provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project     = "bidflow"
      environment = var.environment
      managed-by  = "terraform"
      owner       = var.owner
      ttl         = var.ttl
    }
  }
}

locals {
  cognito_public_config = one(module.cognito[*].public_config)
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

module "network" {
  source = "../../modules/network"

  availability_zones = data.aws_availability_zones.available.names
  enable_nat_gateway = var.enable_nat_gateway
  vpc_cidr           = var.vpc_cidr
}

module "iam" {
  source = "../../modules/iam"

  account_id               = data.aws_caller_identity.current.account_id
  github_oidc_provider_arn = var.github_oidc_provider_arn
  opensearch_domain_arn    = module.managed_opensearch.domain_arn
  region                   = var.region
}

module "web_delivery" {
  source = "../../modules/web_delivery"

  asset_prefix = var.web_asset_prefix
  bucket_name  = "bidflow-${var.environment}-${data.aws_caller_identity.current.account_id}-web"
}

module "cognito" {
  source = "../../modules/cognito"
  count  = var.enable_cognito ? 1 : 0

  name          = "bidflow-${var.environment}"
  region        = var.region
  domain_prefix = var.cognito_domain_prefix
  web_origin    = "https://${module.web_delivery.cloudfront_domain_name}"

  depends_on = [terraform_data.verification_guard]
}

module "application_edge" {
  source = "../../modules/application_edge"

  alb_security_group_id = module.network.security_group_ids.alb
  certificate_arn       = var.alb_certificate_arn
  name                  = "bidflow-${var.environment}"
  public_subnet_ids     = module.network.public_subnet_ids
  vpc_id                = module.network.vpc_id
}

module "private_runtime" {
  source = "../../modules/private_runtime"

  ami_id                            = var.application_ami_id
  application_image                 = var.application_image
  application_instance_profile_name = module.iam.application_instance_profile_name
  application_security_group_id     = module.network.security_group_ids.application
  application_subnet_ids            = module.network.application_subnet_ids
  desired_capacity                  = var.application_desired_capacity
  database_secret_arn               = module.private_rds.master_user_secret_arn
  enable_managed_redis              = var.enable_managed_redis
  enable_managed_kafka              = var.enable_managed_kafka
  enable_managed_search             = var.enable_managed_search
  enable_nat_gateway                = var.enable_nat_gateway
  max_size                          = var.application_max_size
  min_size                          = var.application_min_size
  name                              = "bidflow-${var.environment}"
  region                            = var.region
  runtime_secret_arn                = var.application_runtime_secret_arn
  kafka_bootstrap_brokers           = module.managed_kafka.bootstrap_brokers_sasl_iam
  opensearch_endpoint               = module.managed_opensearch.endpoint
  redis_endpoint                    = module.managed_redis.endpoint
  redis_secret_arn                  = module.managed_redis.secret_arn
  target_group_arn                  = module.application_edge.target_group_arn
  verification_auth = var.enable_cognito ? {
    issuer_uri = local.cognito_public_config.issuer_uri
    client_id  = local.cognito_public_config.client_id
    web_origin = "https://${module.web_delivery.cloudfront_domain_name}"
  } : null
  vpc_id = module.network.vpc_id
}

module "private_rds" {
  source = "../../modules/private_rds"

  data_subnet_ids            = module.network.data_subnet_ids
  name                       = "bidflow-${var.environment}"
  postgres_security_group_id = module.network.security_group_ids.postgres
}

module "managed_redis" {
  source = "../../modules/managed_redis"

  data_subnet_ids         = module.network.data_subnet_ids
  enable_managed_redis    = var.enable_managed_redis
  name                    = "bidflow-${var.environment}"
  redis_security_group_id = module.network.security_group_ids.redis
}

module "managed_kafka" {
  source = "../../modules/managed_kafka"

  data_subnet_ids         = module.network.data_subnet_ids
  enable_managed_kafka    = var.enable_managed_kafka
  kafka_security_group_id = module.network.security_group_ids.kafka
  name                    = "bidflow-${var.environment}"
}

module "managed_opensearch" {
  source = "../../modules/managed_opensearch"

  data_subnet_ids              = module.network.data_subnet_ids
  enable_managed_search        = var.enable_managed_search
  name                         = "bidflow-${var.environment}"
  opensearch_security_group_id = module.network.security_group_ids.opensearch
}

resource "terraform_data" "verification_guard" {
  input = {
    account_id = data.aws_caller_identity.current.account_id
    region     = data.aws_region.current.region
    ttl        = var.ttl
  }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "The active AWS account is not the approved verification account."
    }

    precondition {
      condition     = data.aws_region.current.region == var.region
      error_message = "The active AWS Region does not match the requested verification Region."
    }

    precondition {
      condition     = var.environment == "verification"
      error_message = "Only the verification environment can be managed from this workspace."
    }
  }
}
