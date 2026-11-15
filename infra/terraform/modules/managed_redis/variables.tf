variable "enable_managed_redis" {
  type    = bool
  default = false
}

variable "name" { type = string }
variable "data_subnet_ids" { type = list(string) }
variable "redis_security_group_id" { type = string }
