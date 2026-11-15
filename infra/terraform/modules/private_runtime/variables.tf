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
  description = "Secrets Manager ARN whose JSON value becomes the root-owned Docker environment file."
  type        = string
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
