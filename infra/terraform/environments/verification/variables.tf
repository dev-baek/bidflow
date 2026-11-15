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
