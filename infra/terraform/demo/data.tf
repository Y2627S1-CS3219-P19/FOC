# aws-infra-plan.txt DATA. One small Postgres instance holding 5 logical databases (users_db,
# suppliers_db, credits_db, orders_db, keycloak), each with its own user that can only open its own
# database. Those are created once by the foc-admin task (../scripts/create-databases.sql), not here:
# Terraform on a laptop cannot reach a database in a private subnet.

resource "aws_db_subnet_group" "main" {
  name       = "foc"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier     = "foc"
  engine         = "postgres"
  engine_version = "16" # newest 16.x; minor upgrades happen in the maintenance window

  instance_class    = "db.t4g.micro"
  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  # RDS generates the master password and keeps it in Secrets Manager: it never appears in state.
  username                    = "focadmin"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = 7
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  # Cheap defaults (aws-infra-plan.txt COST).
  performance_insights_enabled = false
  monitoring_interval          = 0

  # Two locks against losing the data: AWS refuses to delete the instance, and Terraform refuses any
  # plan that would destroy or replace it. Teardown (implementation-plan.txt 12.4) removes both.
  deletion_protection = true
  skip_final_snapshot = true # teardown decides about a final snapshot by hand

  lifecycle {
    prevent_destroy = true
  }
}
