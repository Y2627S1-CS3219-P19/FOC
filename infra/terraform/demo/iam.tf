# Task EXECUTION roles: what the ECS agent uses to start a task (pull the image, write logs, read the
# task's secrets). One per service, so each can read only its own SSM parameters.
# No task roles: the services make no AWS API calls themselves.

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

locals {
  # role key => the SSM parameter names it may read
  execution_roles = merge(
    { for svc, m in local.service_secrets : svc => distinct(values(m)) },
    { chroma = [] }, # official image, no secrets: pull + logs only
    { admin = distinct(values(local.admin_secrets)) },
  )
}

resource "aws_iam_role" "execution" {
  for_each = local.execution_roles

  name               = "foc-${each.key}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# AWS-managed: ECR pull + CloudWatch Logs write.
resource "aws_iam_role_policy_attachment" "execution_base" {
  for_each = aws_iam_role.execution

  role       = each.value.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Its own parameters only. No kms:Decrypt needed: SecureStrings use the AWS-managed aws/ssm key.
resource "aws_iam_role_policy" "execution_secrets" {
  for_each = { for k, names in local.execution_roles : k => names if length(names) > 0 }

  name = "read-own-ssm-parameters"
  role = aws_iam_role.execution[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters"]
      Resource = [for n in each.value : "${local.ssm_arn_prefix}${n}"]
    }]
  })
}

# The admin task also logs in to RDS as the master user (password owned by RDS in Secrets Manager).
resource "aws_iam_role_policy" "admin_rds_master_secret" {
  name = "read-rds-master-secret"
  role = aws_iam_role.execution["admin"].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_db_instance.main.master_user_secret[0].secret_arn]
    }]
  })
}
