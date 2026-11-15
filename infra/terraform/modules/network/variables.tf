variable "availability_zones" {
  description = "Available zones in the approved verification Region. The first two are used."
  type        = list(string)
}

variable "vpc_cidr" {
  description = "CIDR block assigned to the verification VPC."
  type        = string
}

variable "enable_nat_gateway" {
  description = "Creates one cost-bearing NAT Gateway for a short AWS verification run."
  type        = bool
  default     = false
}
