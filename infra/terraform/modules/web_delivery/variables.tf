variable "bucket_name" {
  description = "Globally unique private S3 bucket name for Vite build artifacts."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "bucket_name must be a valid 3-63 character S3 bucket name."
  }
}

variable "asset_prefix" {
  description = "Optional immutable release prefix below the bucket root, without leading or trailing slashes."
  type        = string
  default     = ""

  validation {
    condition     = var.asset_prefix == "" || can(regex("^[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9._-]$", var.asset_prefix))
    error_message = "asset_prefix must be empty or a relative path without leading or trailing slashes."
  }
}
