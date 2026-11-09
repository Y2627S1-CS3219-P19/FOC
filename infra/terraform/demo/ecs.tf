# aws-infra-plan.txt COMPUTE: the cluster, the Service Connect namespace, log groups, and the one-off
# foc-admin task. The 7 services themselves are in services.tf.

# Service Connect: every service registers under its Compose name and port (user-service:3001, ...),
# so gateway/nginx.conf and the *_SERVICE_URL env vars work unchanged.
resource "aws_service_discovery_http_namespace" "foc" {
  name = "foc"
}

resource "aws_ecs_cluster" "main" {
  name = "foc"

  setting {
    name  = "containerInsights"
    value = "disabled" # cost (aws-infra-plan.txt COST)
  }

  service_connect_defaults {
    namespace = aws_service_discovery_http_namespace.foc.arn
  }
}

# Spot = ~70% cheaper Fargate; a task can be stopped with 2 minutes' notice and ECS starts a new one.
resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
  }
}

# Logs are JSON (pino), so CloudWatch Logs Insights can follow one correlationId across services.
resource "aws_cloudwatch_log_group" "service" {
  for_each = toset(concat(local.images, ["rabbitmq", "chroma", "admin"]))

  name              = "/foc/${each.key}"
  retention_in_days = 90 # NFR18.1
}

# ---- foc-admin: one-off jobs inside the VPC (implementation-plan.txt 7.3) -------------------------
# Runs ../scripts/admin-task.sh, which creates the 5 database users + databases.
# Both scripts are copied into the task definition (base64) so the container needs no repo
# access. Start it with `aws ecs run-task` (command in infra/terraform/README.md). Safe to re-run.

resource "aws_ecs_task_definition" "admin" {
  family                   = "foc-admin"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution["admin"].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "admin"
    image     = "postgres:16-alpine"
    essential = true
    # tr strips Windows line endings, in case git checked the script out with CRLF.
    command = ["sh", "-c", "echo \"$SCRIPT_B64\" | base64 -d | tr -d '\\r' > /tmp/admin-task.sh && sh /tmp/admin-task.sh"]

    environment = [
      { name = "PGHOST", value = aws_db_instance.main.address },
      { name = "PGUSER", value = aws_db_instance.main.username },
      { name = "PGDATABASE", value = "postgres" },
      { name = "PGSSLMODE", value = "require" },
      { name = "SCRIPT_B64", value = filebase64("${path.module}/../scripts/admin-task.sh") },
      { name = "SQL_B64", value = filebase64("${path.module}/../scripts/create-databases.sql") },
    ]

    secrets = concat(
      [for env in sort(keys(local.admin_secret_arns)) : { name = env, valueFrom = local.admin_secret_arns[env] }],
      [{ name = "PGPASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" }],
    )

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service["admin"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "admin"
      }
    }
  }])
}
