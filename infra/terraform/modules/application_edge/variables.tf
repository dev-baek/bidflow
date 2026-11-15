variable "name" {
  description = "Stable name prefix for the verification application edge resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC that contains the public ALB and private application targets."
  type        = string
}

variable "public_subnet_ids" {
  description = "Two public subnets for the internet-facing ALB."
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group that permits public HTTPS only."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN in ap-northeast-1 for the public HTTPS listener."
  type        = string

  validation {
    condition     = can(regex("^arn:[^:]+:acm:ap-northeast-1:[0-9]{12}:certificate/[0-9a-f-]+$", var.certificate_arn))
    error_message = "certificate_arn must be an ap-northeast-1 ACM certificate ARN."
  }
}
