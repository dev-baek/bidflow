variable "expected_account_id" {
  description = "The only AWS account allowed to create BidFlow verification resources."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must be a 12-digit AWS account ID."
  }
}

variable "region" {
  description = "The approved AWS Region for verification infrastructure."
  type        = string

  validation {
    condition     = contains(["ap-northeast-1"], var.region)
    error_message = "BidFlow verification infrastructure is restricted to ap-northeast-1."
  }
}

variable "environment" {
  description = "Terraform workspace purpose. This repository only permits verification."
  type        = string
  default     = "verification"

  validation {
    condition     = var.environment == "verification"
    error_message = "environment must be verification."
  }
}

variable "owner" {
  description = "The person responsible for the temporary environment."
  type        = string

  validation {
    condition     = length(trimspace(var.owner)) > 0
    error_message = "owner must not be empty."
  }
}

variable "ttl" {
  description = "UTC ISO-8601 timestamp after which the verification environment must be destroyed."
  type        = string

  validation {
    condition     = can(formatdate("YYYY-MM-DD'T'hh:mm:ss'Z'", var.ttl)) && can(regex("Z$", var.ttl))
    error_message = "ttl must be a UTC ISO-8601 timestamp, for example 2026-11-15T12:00:00Z."
  }
}

variable "vpc_cidr" {
  description = "CIDR block assigned to the short-lived verification VPC."
  type        = string
  default     = "10.42.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

variable "enable_nat_gateway" {
  description = "Enables one NAT Gateway only for a time-boxed AWS verification run."
  type        = bool
  default     = false
}

variable "github_oidc_provider_arn" {
  description = "Existing GitHub Actions OIDC provider ARN in the verification AWS account."
  type        = string

  validation {
    condition     = can(regex("^arn:[^:]+:iam::[0-9]{12}:oidc-provider/token.actions.githubusercontent.com$", var.github_oidc_provider_arn))
    error_message = "github_oidc_provider_arn must identify the GitHub Actions OIDC provider in the verification account."
  }
}

variable "web_asset_prefix" {
  description = "Optional immutable Vite release prefix in the private web asset bucket."
  type        = string
  default     = ""
}

variable "alb_certificate_arn" {
  description = "ACM certificate ARN in ap-northeast-1 for the verification ALB HTTPS listener."
  type        = string

  validation {
    condition     = can(regex("^arn:[^:]+:acm:ap-northeast-1:[0-9]{12}:certificate/[0-9a-f-]+$", var.alb_certificate_arn))
    error_message = "alb_certificate_arn must be an ap-northeast-1 ACM certificate ARN."
  }
}

variable "application_ami_id" {
  description = "Pre-baked ARM64 AMI with Docker and AWS CLI for the private runtime."
  type        = string
}

variable "application_image" {
  description = "Immutable ECR application image URI with sha256 digest."
  type        = string
}

variable "application_runtime_secret_arn" {
  description = "Secrets Manager ARN holding the private runtime environment JSON."
  type        = string
}

variable "application_min_size" {
  description = "Minimum ALB-backed runtime instances; two are required for rolling refresh checks."
  type        = number
  default     = 2
}

variable "application_desired_capacity" {
  description = "Initial ALB-backed runtime instances; two are required for rolling refresh checks."
  type        = number
  default     = 2
}

variable "application_max_size" {
  description = "Maximum ALB-backed runtime instances during the verification window."
  type        = number
  default     = 2
}

variable "enable_managed_redis" {
  description = "Creates the cost-bearing temporary ElastiCache Redis only after explicit verification approval."
  type        = bool
  default     = false
}

variable "enable_managed_kafka" {
  description = "Creates the cost-bearing temporary MSK Serverless cluster only after explicit verification approval."
  type        = bool
  default     = false
}
