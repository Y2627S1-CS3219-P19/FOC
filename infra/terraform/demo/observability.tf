# aws-infra-plan.txt OBSERVABILITY. Alarms email alert_email through one SNS topic (confirm the
# subscription email AWS sends). Spend is watched by the existing NUS budget "CS3219".

resource "aws_sns_topic" "alerts" {
  name = "foc-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Lets EventBridge (ECS deployment events below) publish to the topic.
resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.alerts.arn
    }]
  })
}

locals {
  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "foc-alb-target-5xx"
  alarm_description   = "Services returned 5xx through the ALB"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# No healthy gateway / keycloak task = the site is down. Only once the services exist.
resource "aws_cloudwatch_metric_alarm" "no_healthy_targets" {
  for_each = var.services_enabled ? {
    gateway  = aws_lb_target_group.gateway.arn_suffix
    keycloak = aws_lb_target_group.keycloak.arn_suffix
  } : {}

  alarm_name          = "foc-${each.key}-no-healthy-task"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = each.value }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# No DLQ-depth alarm: a RabbitMQ container sends no CloudWatch metrics. order-service's /health/ready
# reports its DLQ depth, and its outbox monitor logs it.

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "foc-rds-cpu"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "foc-rds-free-storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2 * 1024 * 1024 * 1024 # 2 GiB
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.alarm_actions
}

# "Running < desired" without paying for Container Insights: ECS emits an event when a deploy fails
# (circuit breaker) or when tasks keep failing to start.
resource "aws_cloudwatch_event_rule" "ecs_problems" {
  name = "foc-ecs-problems"
  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Deployment State Change", "ECS Service Action"]
    detail = {
      eventName = ["SERVICE_DEPLOYMENT_FAILED", "SERVICE_TASK_START_IMPAIRED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "ecs_problems" {
  rule = aws_cloudwatch_event_rule.ecs_problems.name
  arn  = aws_sns_topic.alerts.arn
}
