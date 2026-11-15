resource "aws_db_subnet_group" "postgres" {
  name       = "${var.name}-postgres"
  subnet_ids = var.data_subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier                   = "${var.name}-postgres"
  allocated_storage            = 20
  max_allocated_storage        = 30
  storage_type                 = "gp3"
  storage_encrypted            = true
  engine                       = "postgres"
  engine_version               = "17.5"
  instance_class               = var.instance_class
  db_name                      = "bidflow"
  username                     = "bidflow_admin"
  manage_master_user_password  = true
  port                         = 5432
  db_subnet_group_name         = aws_db_subnet_group.postgres.name
  vpc_security_group_ids       = [var.postgres_security_group_id]
  publicly_accessible          = false
  multi_az                     = false
  backup_retention_period      = 0
  deletion_protection          = false
  skip_final_snapshot          = true
  apply_immediately            = true
  auto_minor_version_upgrade   = true
  performance_insights_enabled = false
}
