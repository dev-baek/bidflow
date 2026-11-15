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
  region                   = var.region
}

module "web_delivery" {
  source = "../../modules/web_delivery"

  asset_prefix = var.web_asset_prefix
  bucket_name  = "bidflow-${var.environment}-${data.aws_caller_identity.current.account_id}-web"
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
  enable_nat_gateway                = var.enable_nat_gateway
  max_size                          = var.application_max_size
  min_size                          = var.application_min_size
  name                              = "bidflow-${var.environment}"
  region                            = var.region
  runtime_secret_arn                = var.application_runtime_secret_arn
  target_group_arn                  = module.application_edge.target_group_arn
  vpc_id                            = module.network.vpc_id
}

module "private_rds" {
  source = "../../modules/private_rds"

  data_subnet_ids            = module.network.data_subnet_ids
  name                       = "bidflow-${var.environment}"
  postgres_security_group_id = module.network.security_group_ids.postgres
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
