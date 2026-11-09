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

# ---- Messaging metrics from logs -------------------------------------------------------------
# A RabbitMQ container sends no CloudWatch metrics, so these come from the services' JSON (pino) logs.

locals {
  metrics_namespace = "FOC"
}

# credit-service and order-service both log "Message dead-lettered" when a message gives up (5 tries,
# or malformed). Both filters write the same metric, so the alarm sees the total.
resource "aws_cloudwatch_log_metric_filter" "dead_lettered" {
  for_each = toset(["credit-service", "order-service"])

  name           = "foc-${each.key}-dead-lettered"
  log_group_name = aws_cloudwatch_log_group.service[each.key].name
  pattern        = "{ $.msg = \"Message dead-lettered\" }"

  metric_transformation {
    name          = "DeadLetteredMessages"
    namespace     = local.metrics_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

# order-service's outbox monitor logs these every 30s (jobs/outboxMonitor.ts). dlqDepth is null while
# RabbitMQ is down, and a null value does not match the >= 0 test, so no point is written then.
locals {
  outbox_metrics = {
    OutboxOldestUnpublishedSeconds = "$.outbox.oldestUnpublishedSeconds"
    OutboxBacklog                  = "$.outbox.backlog"
    OrderDlqDepth                  = "$.dlqDepth"
  }
}

resource "aws_cloudwatch_log_metric_filter" "outbox" {
  for_each = local.outbox_metrics

  name           = "foc-order-service-${each.key}"
  log_group_name = aws_cloudwatch_log_group.service["order-service"].name
  pattern        = "{ ${each.value} >= 0 }"

  metric_transformation {
    name      = each.key
    namespace = local.metrics_namespace
    value     = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "dead_lettered" {
  alarm_name          = "foc-messages-dead-lettered"
  alarm_description   = "A message went to a dead-letter queue. Search the credit-service / order-service logs for \"Message dead-lettered\", then look at the .dlq queue in the RabbitMQ UI."
  namespace           = local.metrics_namespace
  metric_name         = "DeadLetteredMessages"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# Events waiting in the outbox for over 2 minutes = RabbitMQ (or the relay) is down. Orders still save.
resource "aws_cloudwatch_metric_alarm" "outbox_lag" {
  alarm_name          = "foc-outbox-publish-lag"
  alarm_description   = "order-service events are not reaching RabbitMQ. Check the rabbitmq ECS service and the order-service logs."
  namespace           = local.metrics_namespace
  metric_name         = "OutboxOldestUnpublishedSeconds"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 120
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

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

# ---- FAQ RAG quality signals (F28) --------------------------------------------------------------
# faq-service logs one structured line per ask: msg "faq ask" with refused / top1Similarity /
# durationMs. No alerting by design (user, 7 Nov): these are dashboard-only quality signals.
# The refusal rate is the RAG health indicator - creeping up means the corpus no longer covers
# what students ask, or FAQ_SIMILARITY_FLOOR is mis-tuned.

resource "aws_cloudwatch_log_metric_filter" "faq_asks" {
  name           = "foc-faq-service-asks"
  log_group_name = aws_cloudwatch_log_group.service["faq-service"].name
  pattern        = "{ $.msg = \"faq ask\" }"

  metric_transformation {
    name          = "FaqAsks"
    namespace     = local.metrics_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

# Boolean JSON fields match as strings in filter patterns.
resource "aws_cloudwatch_log_metric_filter" "faq_refusals" {
  name           = "foc-faq-service-refusals"
  log_group_name = aws_cloudwatch_log_group.service["faq-service"].name
  pattern        = "{ $.msg = \"faq ask\" && $.refused = true }"

  metric_transformation {
    name          = "FaqRefusals"
    namespace     = local.metrics_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "faq_latency" {
  name           = "foc-faq-service-latency"
  log_group_name = aws_cloudwatch_log_group.service["faq-service"].name
  pattern        = "{ $.msg = \"faq ask\" && $.durationMs >= 0 }"

  metric_transformation {
    name      = "FaqAskDurationMs"
    namespace = local.metrics_namespace
    value     = "$.durationMs"
    unit      = "Milliseconds"
  }
}
