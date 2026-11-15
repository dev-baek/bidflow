variable "name" {
  description = "Stable identifier prefix for the temporary PostgreSQL instance."
  type        = string
}

variable "data_subnet_ids" {
  description = "Private data subnets used by the RDS subnet group."
  type        = list(string)
}

variable "postgres_security_group_id" {
  description = "Security group that accepts PostgreSQL only from the application tier."
  type        = string
}

variable "instance_class" {
  description = "Small verification-only RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}
