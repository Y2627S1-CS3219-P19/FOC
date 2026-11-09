# One ECS service on Fargate (Spot by default) in the private subnets: its task definition + service + Service
# Connect entry. Called once per service from demo/services.tf. A module has no state of its own.
#
# TASK DEFINITION OWNERSHIP (aws-infra-plan.txt): Terraform owns everything in the task definition
# (CPU, memory, env, secrets, health check, logs) but CI owns the image. CI registers new revisions
# from the latest one with a new image, so the service ignores task_definition changes here - otherwise
# every apply would roll the service back to the first image. After changing env/secrets/CPU here,
# apply and then redeploy that service from main.yml (workflow_dispatch).

resource "aws_ecs_task_definition" "this" {
  family                   = "foc-${var.name}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn

  # Keep old revisions registered when Terraform replaces this one, so a manual rollback to them works.
  skip_destroy = true

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64" # Fargate Spot is x86 only
  }

  dynamic "volume" {
    for_each = var.volumes
    content {
      name = volume.value.name
      efs_volume_configuration {
        file_system_id     = volume.value.efs.file_system_id
        transit_encryption = "ENABLED"
        authorization_config {
          access_point_id = volume.value.efs.access_point_id
          iam             = "DISABLED" # default EFS policy: authorized by network + POSIX, no task role
        }
      }
    }
  }

  container_definitions = jsonencode([{
    name      = var.name
    image     = var.image
    essential = true

    portMappings = concat(
      [{ name = "http", containerPort = var.port, protocol = "tcp" }],
      var.extra_port_mappings,
    )

    environment = [for k in sort(keys(var.environment)) : { name = k, value = var.environment[k] }]
    secrets     = [for k in sort(keys(var.secrets)) : { name = k, valueFrom = var.secrets[k] }]

    healthCheck = var.health_check_command == null ? null : {
      command     = var.health_check_command
      interval    = 15
      timeout     = 10 # rabbitmq-diagnostics is slow on 0.25 vCPU
      retries     = 5
      startPeriod = var.health_check_start_period
    }

    mountPoints = [for m in var.mount_points : { containerPath = m.container_path, sourceVolume = m.source_volume }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = var.log_group_name
        awslogs-region        = var.region
        awslogs-stream-prefix = var.name
      }
    }
  }])
}

resource "aws_ecs_service" "this" {
  name            = var.name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  propagate_tags  = "SERVICE"

  capacity_provider_strategy {
    capacity_provider = var.capacity_provider
    weight            = 1
  }

  # Rolling deploy: start the new task, wait until healthy, then stop the old one. If new tasks keep
  # failing, the circuit breaker stops the deploy and rolls back to the last working revision.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  health_check_grace_period_seconds = var.target_group_arn == null ? null : var.health_check_grace_period
  wait_for_steady_state             = var.wait_for_steady_state

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn == null ? [] : [var.target_group_arn]
    content {
      target_group_arn = load_balancer.value
      container_name   = var.name
      container_port   = var.port
    }
  }

  service_connect_configuration {
    enabled   = true
    namespace = var.namespace_arn

    dynamic "service" {
      for_each = var.service_connect_server ? [1] : []
      content {
        port_name      = "http"
        discovery_name = var.name
        client_alias {
          port     = var.port
          dns_name = var.name
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}
