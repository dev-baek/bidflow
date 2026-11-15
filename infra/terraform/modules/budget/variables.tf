variable "project_name" {
  description = "Project name included in the budget name."
  type        = string
  default     = "bidflow"
}

variable "environment" {
  description = "Environment included in the budget name."
  type        = string
  default     = "verification"
}

variable "monthly_budget_amount" {
  description = "Monthly account-wide cost ceiling in the account billing currency."
  type        = string
  default     = "100000"

  validation {
    condition     = can(tonumber(var.monthly_budget_amount)) && tonumber(var.monthly_budget_amount) > 0
    error_message = "monthly_budget_amount must be a positive number."
  }
}

variable "monthly_budget_currency" {
  description = "Three-letter billing currency code. Confirm it against the AWS account before apply."
  type        = string
  default     = "KRW"

  validation {
    condition     = can(regex("^[A-Z]{3}$", var.monthly_budget_currency))
    error_message = "monthly_budget_currency must be a three-letter uppercase currency code."
  }
}

variable "budget_notification_emails" {
  description = "Email recipients for the 80% warning and 100% threshold alerts. Supply outside version control."
  type        = list(string)

  validation {
    condition     = length(var.budget_notification_emails) > 0 && alltrue([for email in var.budget_notification_emails : can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", email))])
    error_message = "budget_notification_emails must contain at least one valid email address."
  }
}
