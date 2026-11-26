variable "bucket_name" {
  type     = string
  nullable = false

  validation {
    condition     = can(regex("^bidflow-verification-[0-9]{12}-images$", var.bucket_name))
    error_message = "The image bucket must use the dedicated verification bucket name."
  }
}

variable "web_origin" {
  type     = string
  nullable = false

  validation {
    condition     = can(regex("^https://d[a-z0-9]{1,62}\\.cloudfront\\.net$", var.web_origin))
    error_message = "Image PUT requires a single CloudFront HTTPS origin."
  }
}
