variable "expected_account_id" {
  description = "The only AWS account allowed to create BidFlow verification bootstrap resources."
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

variable "owner" {
  description = "The person responsible for this bootstrap state backend."
  type        = string

  validation {
    condition     = length(trimspace(var.owner)) > 0
    error_message = "owner must not be empty."
  }
}

variable "state_bucket_name" {
  description = "A globally unique bucket name for Terraform state."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "state_bucket_name must be a valid S3 bucket name."
  }
}

variable "lock_table_name" {
  description = "DynamoDB table name used by the S3 backend lockfile migration path."
  type        = string

  validation {
    condition     = length(trimspace(var.lock_table_name)) > 0
    error_message = "lock_table_name must not be empty."
  }
}

variable "monthly_budget_amount" {
  description = "Monthly account-wide cost ceiling in the account billing currency."
  type        = string
  default     = "100000"
}

variable "monthly_budget_currency" {
  description = "Billing currency for the monthly cost ceiling. Confirm it against the AWS account before apply."
  type        = string
  default     = "KRW"
}

variable "budget_notification_emails" {
  description = "Email recipients for AWS Budget notifications. Supply outside version control."
  type        = list(string)
}
