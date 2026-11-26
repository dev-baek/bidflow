variable "name" {
  description = "Stable name prefix for the private Spring Boot runtime."
  type        = string
}

variable "region" {
  description = "Region used for ECR login and Secrets Manager access."
  type        = string
}

variable "vpc_id" {
  description = "Verification VPC that contains the runtime instances."
  type        = string
}

variable "application_subnet_ids" {
  description = "Private application subnets for Auto Scaling instances."
  type        = list(string)
}

variable "application_security_group_id" {
  description = "Security group that accepts only ALB traffic on port 8080."
  type        = string
}

variable "application_instance_profile_name" {
  description = "SSM and runtime least-privilege instance profile."
  type        = string
}

variable "target_group_arn" {
  description = "ALB target group that checks Spring Boot readiness."
  type        = string
}

variable "ami_id" {
  description = "Pre-baked private-runtime AMI containing Docker and AWS CLI."
  type        = string

  validation {
    condition     = can(regex("^ami-[0-9a-f]+$", var.ami_id))
    error_message = "ami_id must be an AMI identifier."
  }
}

variable "instance_type" {
  description = "ARM64 instance type compatible with the pre-baked AMI and application image."
  type        = string
  default     = "t4g.small"
}

variable "application_image" {
  description = "Immutable ECR image URI including a sha256 digest, never a tag."
  type        = string

  validation {
    condition     = can(regex("^.+@sha256:[0-9a-f]{64}$", var.application_image))
    error_message = "application_image must include an immutable sha256 digest."
  }
}

variable "runtime_secret_arn" {
  description = "Secrets Manager ARN whose SecretString contains the root-owned Docker env-file."
  type        = string
}

variable "verification_auth" {
  description = "Public verification auth configuration owned by Terraform, not Runtime Secret."
  type = object({
    issuer_uri = string
    client_id  = string
    web_origin = string
  })
  default = null

  validation {
    condition = var.verification_auth == null ? true : (
      can(regex("^https://cognito-idp\\.ap-northeast-1\\.amazonaws\\.com/ap-northeast-1_[A-Za-z0-9]+$", var.verification_auth.issuer_uri)) &&
      can(regex("^[A-Za-z0-9]{1,128}$", var.verification_auth.client_id)) &&
      can(regex("^https://d[a-z0-9]{1,62}\\.cloudfront\\.net$", var.verification_auth.web_origin))
    )
    error_message = "Verification auth requires a Tokyo Cognito issuer, public client ID, and exact CloudFront HTTPS origin."
  }
}

variable "verification_image_bucket" {
  description = "The provisioned image bucket for the Tokyo verification profile, or null."
  type        = string
  default     = null

  validation {
    condition = var.verification_image_bucket == null ? true : (
      var.verification_auth != null && var.region == "ap-northeast-1" &&
      can(regex("^bidflow-verification-[0-9]{12}-images$", var.verification_image_bucket))
    )
    error_message = "The image bucket requires the Tokyo verification authentication configuration."
  }
}

variable "database_secret_arn" {
  description = "RDS-managed PostgreSQL credential secret read only at instance boot."
  type        = string
}

variable "database_host" {
  description = "Private RDS endpoint used for the JDBC URL."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9.-]*$", var.database_host))
    error_message = "database_host must be an RDS hostname, without URL or port."
  }
}

variable "database_port" {
  description = "Private RDS PostgreSQL port used for the JDBC URL."
  type        = number

  validation {
    condition     = var.database_port != null && try(var.database_port >= 1 && var.database_port <= 65535 && floor(var.database_port) == var.database_port, false)
    error_message = "database_port must be an integer from 1 to 65535."
  }
}

variable "enable_managed_redis" { type = bool }
variable "redis_endpoint" {
  type     = string
  nullable = true
}
variable "redis_secret_arn" {
  type     = string
  nullable = true
}
variable "enable_managed_kafka" { type = bool }
variable "kafka_bootstrap_brokers" {
  type     = string
  nullable = true
}

variable "enable_managed_search" { type = bool }

variable "opensearch_endpoint" {
  type     = string
  nullable = true
}

variable "enable_nat_gateway" {
  description = "Explicit approval switch for the temporary NAT Gateway required by this first runtime implementation."
  type        = bool
}

variable "min_size" {
  description = "Minimum instances. Two are required for rolling refresh availability verification."
  type        = number
}

variable "desired_capacity" {
  description = "Initial private runtime instances. Two are required for rolling refresh availability verification."
  type        = number
}

variable "max_size" {
  description = "Maximum private runtime instances during verification."
  type        = number
}
