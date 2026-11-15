variable "enable_managed_search" {
  type    = bool
  default = false
}
variable "name" { type = string }
variable "data_subnet_ids" { type = list(string) }
variable "opensearch_security_group_id" { type = string }
