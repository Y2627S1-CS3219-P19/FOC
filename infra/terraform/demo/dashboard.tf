# One CloudWatch dashboard "foc" for the whole stack. Only free metrics (no Container Insights): ALB,
# ECS service CPU/memory, RDS, and the log-based FOC/* metrics from observability.tf.
# Console: CloudWatch > Dashboards > foc.

locals {
  ecs_services = concat(local.images, ["rabbitmq", "chroma"])

  # Only these services log JSON with a pino "level". supplier-service uses console.log.
  error_log_groups = ["user-service", "credit-service", "order-service"]

  alb = ["AWS/ApplicationELB", "LoadBalancer", aws_lb.main.arn_suffix]
  rds = ["AWS/RDS", "DBInstanceIdentifier", aws_db_instance.main.identifier]

  # Each widget is 8 of the dashboard's 24 columns wide.
  metric_widget = { type = "metric", width = 8, height = 6 }
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "foc"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "alarm", x = 0, y = 0, width = 24, height = 3
        properties = {
          title = "Alarms"
          alarms = concat(
            [
              aws_cloudwatch_metric_alarm.alb_5xx.arn,
              aws_cloudwatch_metric_alarm.dead_lettered.arn,
              aws_cloudwatch_metric_alarm.outbox_lag.arn,
              aws_cloudwatch_metric_alarm.rds_cpu.arn,
              aws_cloudwatch_metric_alarm.rds_storage.arn,
            ],
            [for a in values(aws_cloudwatch_metric_alarm.no_healthy_targets) : a.arn],
          )
        }
      },

      # ---- Traffic (ALB) ----
      merge(local.metric_widget, {
        x = 0, y = 3
        properties = {
          title   = "Requests", region = var.region, stat = "Sum", period = 60, view = "timeSeries"
          metrics = [[local.alb[0], "RequestCount", local.alb[1], local.alb[2]]]
        }
      }),
      merge(local.metric_widget, {
        x = 8, y = 3
        properties = {
          title = "5xx errors", region = var.region, stat = "Sum", period = 60, view = "timeSeries"
          metrics = [
            [local.alb[0], "HTTPCode_Target_5XX_Count", local.alb[1], local.alb[2], { label = "from services" }],
            [local.alb[0], "HTTPCode_ELB_5XX_Count", local.alb[1], local.alb[2], { label = "from ALB (no healthy target)" }],
          ]
        }
      }),
      merge(local.metric_widget, {
        x = 16, y = 3
        properties = {
          title = "Response time (seconds)", region = var.region, period = 60, view = "timeSeries"
          metrics = [
            [local.alb[0], "TargetResponseTime", local.alb[1], local.alb[2], { stat = "p50", label = "p50" }],
            [local.alb[0], "TargetResponseTime", local.alb[1], local.alb[2], { stat = "p95", label = "p95" }],
          ]
        }
      }),

      # ---- Messaging (from logs) ----
      merge(local.metric_widget, {
        x = 0, y = 9
        properties = {
          title   = "Messages dead-lettered (credit + order)", region = var.region, stat = "Sum", period = 60, view = "timeSeries"
          metrics = [[local.metrics_namespace, "DeadLetteredMessages", { label = "dead-lettered" }]]
        }
      }),
      merge(local.metric_widget, {
        x = 8, y = 9
        properties = {
          title   = "order-service DLQ depth", region = var.region, stat = "Maximum", period = 60, view = "timeSeries"
          metrics = [[local.metrics_namespace, "OrderDlqDepth", { label = "messages in DLQ" }]]
        }
      }),
      merge(local.metric_widget, {
        x = 16, y = 9
        properties = {
          title = "Outbox (order-service)", region = var.region, stat = "Maximum", period = 60, view = "timeSeries"
          metrics = [
            [local.metrics_namespace, "OutboxOldestUnpublishedSeconds", { label = "oldest unpublished (s)" }],
            [local.metrics_namespace, "OutboxBacklog", { label = "unpublished events", yAxis = "right" }],
          ]
          annotations = { horizontal = [{ value = 120, label = "alarm" }] }
        }
      }),

      # ---- Services (ECS) ----
      merge(local.metric_widget, {
        x = 0, y = 15
        properties = {
          title = "Healthy tasks behind the ALB", region = var.region, stat = "Minimum", period = 60, view = "timeSeries"
          metrics = [
            [local.alb[0], "HealthyHostCount", "TargetGroup", aws_lb_target_group.gateway.arn_suffix, local.alb[1], local.alb[2], { label = "gateway" }],
            [local.alb[0], "HealthyHostCount", "TargetGroup", aws_lb_target_group.keycloak.arn_suffix, local.alb[1], local.alb[2], { label = "keycloak" }],
          ]
        }
      }),
      merge(local.metric_widget, {
        x = 8, y = 15
        properties = {
          title   = "CPU % per service", region = var.region, stat = "Average", period = 300, view = "timeSeries"
          metrics = [for s in local.ecs_services : ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", s, { label = s }]]
        }
      }),
      merge(local.metric_widget, {
        x = 16, y = 15
        properties = {
          title   = "Memory % per service", region = var.region, stat = "Average", period = 300, view = "timeSeries"
          metrics = [for s in local.ecs_services : ["AWS/ECS", "MemoryUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", s, { label = s }]]
        }
      }),

      # ---- Database (RDS) ----
      merge(local.metric_widget, {
        x = 0, y = 21
        properties = {
          title   = "RDS CPU %", region = var.region, stat = "Average", period = 300, view = "timeSeries"
          metrics = [[local.rds[0], "CPUUtilization", local.rds[1], local.rds[2]]]
        }
      }),
      merge(local.metric_widget, {
        x = 8, y = 21
        properties = {
          title   = "RDS connections", region = var.region, stat = "Maximum", period = 300, view = "timeSeries"
          metrics = [[local.rds[0], "DatabaseConnections", local.rds[1], local.rds[2]]]
        }
      }),
      merge(local.metric_widget, {
        x = 16, y = 21
        properties = {
          title   = "RDS free storage (bytes)", region = var.region, stat = "Minimum", period = 300, view = "timeSeries"
          metrics = [[local.rds[0], "FreeStorageSpace", local.rds[1], local.rds[2]]]
        }
      }),

      # ---- FAQ RAG quality (F28, from faq-service logs) ----
      merge(local.metric_widget, {
        x = 0, y = 27
        properties = {
          title = "FAQ asks and refusals", region = var.region, period = 300, view = "timeSeries"
          metrics = [
            [local.metrics_namespace, "FaqAsks", { label = "asks", stat = "Sum" }],
            [local.metrics_namespace, "FaqRefusals", { label = "refusals", stat = "Sum" }],
          ]
        }
      }),
      merge(local.metric_widget, {
        x = 8, y = 27
        properties = {
          title   = "FAQ ask duration", region = var.region, stat = "Average", period = 300, view = "timeSeries"
          metrics = [[local.metrics_namespace, "FaqAskDurationMs", { label = "avg ms", stat = "Average" }]]
        }
      }),

      # ---- Recent errors (Logs Insights) ----
      {
        type = "log", x = 0, y = 33, width = 24, height = 8
        properties = {
          title  = "Recent errors (pino level >= 50)"
          region = var.region
          view   = "table"
          query  = "${join(" | ", [for g in local.error_log_groups : "SOURCE '${aws_cloudwatch_log_group.service[g].name}'"])} | fields @timestamp, @log, msg, err, correlationId, eventId | filter level >= 50 | sort @timestamp desc | limit 50"
        }
      },
    ]
  })
}
