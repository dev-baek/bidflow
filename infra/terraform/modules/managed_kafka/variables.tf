variable "enable_managed_kafka" {
  type    = bool
  default = false
}

variable "name" { type = string }
variable "data_subnet_ids" { type = list(string) }
variable "kafka_security_group_id" { type = string }
