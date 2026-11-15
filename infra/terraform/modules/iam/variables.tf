variable "account_id" {
  description = "AWS account that owns the verification environment."
  type        = string
}

variable "region" {
  description = "AWS Region that owns the verification environment."
  type        = string
}

variable "project_name" {
  description = "Resource name prefix shared by IAM policies and later infrastructure modules."
  type        = string
  default     = "bidflow"
}

variable "environment" {
  description = "Environment scope encoded in IAM resource patterns."
  type        = string
  default     = "verification"
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deployment trust role."
  type        = string
  default     = "dev-baek/bidflow"
}

variable "github_oidc_provider_arn" {
  description = "Existing account-level GitHub Actions OIDC provider ARN."
  type        = string

  validation {
    condition     = can(regex("^arn:[^:]+:iam::[0-9]{12}:oidc-provider/token.actions.githubusercontent.com$", var.github_oidc_provider_arn))
    error_message = "github_oidc_provider_arn must identify the GitHub Actions OIDC provider in the verification account."
  }
}

variable "opensearch_domain_arn" {
  description = "Optional private OpenSearch domain ARN that the application runtime may query."
  type        = string
  nullable    = true
  default     = null
}
