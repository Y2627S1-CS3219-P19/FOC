# The 7 app services + RabbitMQ (aws-infra-plan.txt COMPUTE + PER-SERVICE CONFIG DIFFERENCES FROM
# COMPOSE). Created only when services_enabled = true (second phase), on images tagged initial_image_tag.
#
# Start order matters, because a service that starts before its dependencies keeps failing until the
# deployment circuit breaker gives up:
#   keycloak + rabbitmq (Terraform waits until healthy) -> user-service (waits until healthy, its
#   admin bootstrap needs Keycloak) -> supplier, credit, frontend -> order (needs supplier) -> gateway
#   (nginx resolves every upstream name at startup, so it goes last).

# RabbitMQ as a container instead of Amazon MQ (2026-11-02): the smallest Amazon MQ RabbitMQ broker
# left in ap-southeast-1 is mq.m7g.medium, ~US$100+/month alone - over the whole budget. This costs
# ~US$13/month. Trade-off: no disk, so a restart loses queued messages and the queues themselves (the
# services re-declare them on reconnect; the outbox only re-sends events not yet confirmed). On regular
# FARGATE, not Spot, so it is only restarted by a deploy or a crash.
module "rabbitmq" {
  source = "../modules/ecs-service"
  count  = var.services_enabled ? 1 : 0

  name              = "rabbitmq"
  image             = "rabbitmq:4-management-alpine" # same as compose.yaml
  cpu               = 256
  memory            = 1024
  port              = 5672
  capacity_provider = "FARGATE"

  environment = { RABBITMQ_DEFAULT_USER = "foc" }
  secrets     = local.service_secret_arns["rabbitmq"]

  # Run as the rabbitmq user, not root: the CLI creates ~/.erlang.cookie if the server has not yet,
  # and a root-owned cookie makes the server crash with "eacces" (seen on Fargate, 2026-11-02).
  health_check_command  = ["CMD-SHELL", "su-exec rabbitmq rabbitmq-diagnostics -q ping"]
  wait_for_steady_state = true

  execution_role_arn = aws_iam_role.execution["rabbitmq"].arn
  log_group_name     = aws_cloudwatch_log_group.service["rabbitmq"].name
  region             = var.region
  cluster_arn        = local.service_common.cluster_arn
  namespace_arn      = local.service_common.namespace_arn
  subnet_ids         = local.service_common.subnet_ids
  security_group_ids = local.service_common.security_group_ids
}

locals {
  public_url = "https://${aws_cloudfront_distribution.main.domain_name}"
  image      = { for k, r in aws_ecr_repository.app : k => "${r.repository_url}:${var.initial_image_tag}" }

  # Same keys as compose.yaml, AWS values.
  node_common_env = {
    LOG_LEVEL             = "info"
    KEYCLOAK_INTERNAL_URL = "http://keycloak:8080/auth" # backchannel, via Service Connect
    KEYCLOAK_PUBLIC_URL   = "${local.public_url}/auth"  # token issuer, as the browser sees it
    KEYCLOAK_REALM        = "campuserrand"
    ALLOWED_TOKEN_CLIENTS = "campuserrand-spa" # not the password-grant test client
    DEBUG_EVENT_QUEUE     = "false"
  }

  # CloudFront -> ALB -> gateway -> service: trust 3 proxy hops so rate limits see the real client IP.
  trust_proxy = { TRUST_PROXY = "3" }

  service_common = {
    cluster_arn        = aws_ecs_cluster.main.arn
    namespace_arn      = aws_service_discovery_http_namespace.foc.arn
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.tasks.id]
  }
}

module "keycloak" {
  source = "../modules/ecs-service"
  count  = var.services_enabled ? 1 : 0

  name   = "keycloak"
  image  = local.image["keycloak"]
  cpu    = 512
  memory = 1024 # if it runs out of memory or never gets healthy, go back to 1024 / 2048
  port   = 8080

  extra_port_mappings = [{ name = "management", containerPort = 9000, protocol = "tcp" }]

  environment = {
    KC_DB          = "postgres"
    KC_DB_URL      = "jdbc:postgresql://${aws_db_instance.main.address}:5432/keycloak"
    KC_DB_USERNAME = "keycloak"

    # Served under https://<public host>/auth (the ALB sends /auth/* here). Health stays at :9000/health/ready.
    KC_HTTP_RELATIVE_PATH            = "/auth"
    KC_HTTP_MANAGEMENT_RELATIVE_PATH = "/"
    KC_HOSTNAME                      = "${local.public_url}/auth"
    # false: advertise https://<public host>/auth for EVERY endpoint (token, userinfo, jwks too). With
    # true, those came out as http://<public host>/... (requests reach Keycloak over plain HTTP from
    # the ALB) and the browser blocked them as mixed content -> "Login failed: Failed to fetch".
    # The services still call http://keycloak:8080/auth directly; they never read these URLs.
    KC_HOSTNAME_BACKCHANNEL_DYNAMIC = "false"
    KC_HTTP_ENABLED                 = "true" # TLS ends at CloudFront
    KC_HEALTH_ENABLED               = "true"
    KC_CACHE                        = "local" # one instance, no cluster

    # Filled into campuserrand-realm.json on the first import (empty keycloak database).
    KC_SPA_PUBLIC_URL = local.public_url
    KC_SMTP_HOST      = var.smtp_host # Gmail; see variables.tf for why not SES
    KC_SMTP_PORT      = var.smtp_port
    KC_SMTP_FROM      = var.email_from_address
    KC_SMTP_SSL       = "false"
    KC_SMTP_STARTTLS  = "true"
    KC_SMTP_AUTH      = "true"
  }
  secrets = local.service_secret_arns["keycloak"]

  # Same check as compose.yaml.
  health_check_command      = ["CMD-SHELL", "exec 3<>/dev/tcp/127.0.0.1/9000 && echo -e 'GET /health/ready HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && grep -q '\"status\": \"UP\"' <&3"]
  health_check_start_period = 300 # first boot at 0.5 vCPU takes a few minutes
  health_check_grace_period = 300
  target_group_arn          = aws_lb_target_group.keycloak.arn
  wait_for_steady_state     = true

  execution_role_arn = aws_iam_role.execution["keycloak"].arn
  log_group_name     = aws_cloudwatch_log_group.service["keycloak"].name
  region             = var.region
  cluster_arn        = local.service_common.cluster_arn
  namespace_arn      = local.service_common.namespace_arn
  subnet_ids         = local.service_common.subnet_ids
  security_group_ids = local.service_common.security_group_ids
}

module "user_service" {
  source     = "../modules/ecs-service"
  count      = var.services_enabled ? 1 : 0
  depends_on = [module.keycloak, module.rabbitmq]

  name  = "user-service"
  image = local.image["user-service"]
  port  = 3001

  environment = merge(local.node_common_env, local.trust_proxy, {
    PORT                         = "3001"
    KC_USER_SERVICE_CLIENT_ID    = "user-service"
    SPA_URL                      = local.public_url
    ALLOWED_EMAIL_DOMAINS        = "u.nus.edu"
    ADMIN_CONTACT_EMAIL          = var.admin_contact_email
    REGISTER_RATE_LIMIT_PER_HOUR = "5"
  })
  secrets = local.service_secret_arns["user-service"]

  health_check_command  = ["CMD", "wget", "-qO-", "http://127.0.0.1:3001/health/ready"]
  wait_for_steady_state = true

  execution_role_arn = aws_iam_role.execution["user-service"].arn
  log_group_name     = aws_cloudwatch_log_group.service["user-service"].name
  region             = var.region
  cluster_arn        = local.service_common.cluster_arn
  namespace_arn      = local.service_common.namespace_arn
  subnet_ids         = local.service_common.subnet_ids
  security_group_ids = local.service_common.security_group_ids
}

module "supplier_service" {
  source     = "../modules/ecs-service"
  count      = var.services_enabled ? 1 : 0
  depends_on = [module.user_service]

  name  = "supplier-service"
  image = local.image["supplier-service"]
  port  = 3002

  environment = merge(local.node_common_env, {
    PORT             = "3002"
    USER_SERVICE_URL = "http://user-service:3001"
    SEED_CSV_PATH    = "/app/data/csv/supplier-seed-data.csv" # baked into the image (Phase 2.3)
    IMAGES_DIR       = "/app/data/images"
  })
  secrets = local.service_secret_arns["supplier-service"]

  health_check_command  = ["CMD", "wget", "-qO-", "http://127.0.0.1:3002/health/ready"]
  wait_for_steady_state = true # order-service calls it

  execution_role_arn = aws_iam_role.execution["supplier-service"].arn
  log_group_name     = aws_cloudwatch_log_group.service["supplier-service"].name
  region             = var.region
  cluster_arn        = local.service_common.cluster_arn
  namespace_arn      = local.service_common.namespace_arn
  subnet_ids         = local.service_common.subnet_ids
  security_group_ids = local.service_common.security_group_ids
}

module "credit_service" {
  source     = "../modules/ecs-service"
  count      = var.services_enabled ? 1 : 0
  depends_on = [module.user_service]

  name  = "credit-service"
  image = local.image["credit-service"]
  port  = 3003

  environment = merge(local.node_common_env, local.trust_proxy, {
    PORT                   = "3003"
    USER_SERVICE_URL       = "http://user-service:3001"
    INITIAL_CREDIT_BALANCE = "100"
  })
  secrets = local.service_secret_arns["credit-service"]

  health_check_command = ["CMD", "wget", "-qO-", "http://127.0.0.1:3003/health/ready"]

  execution_role_arn = aws_iam_role.execution["credit-service"].arn
  log_group_name     = aws_cloudwatch_log_group.service["credit-service"].name
  region             = var.region
  cluster_arn        = local.service_common.cluster_arn
  namespace_arn      = local.service_common.namespace_arn
  subnet_ids         = local.service_common.subnet_ids
  security_group_ids = local.service_common.security_group_ids
}

module "order_service" {
  source     = "../modules/ecs-service"
  count      = var.services_enabled ? 1 : 0
  depends_on = [module.user_service, module.supplier_service]

  name  = "order-service"
  image = local.image["order-service"]
  port  = 3004

  environment = merge(local.node_common_env, local.trust_proxy, {
    PORT                 = "3004"
    USER_SERVICE_URL     = "http://user-service:3001"
    SUPPLIER_SERVICE_URL = "http://supplier-service:3002"
  })
  secrets = local.service_secret_arns["order-service"]

  health_check_command = ["CMD", "wget", "-qO-", "http://127.0.0.1:3004/health/ready"]

  execution_role_arn = aws_iam_role.execution["order-service"].arn
  log_group_name     = aws_cloudwatch_log_group.service["order-service"].name
  region             = var.region
  cluster_arn        = local.service_common.cluster_arn
  namespace_arn      = local.service_common.namespace_arn
  subnet_ids         = local.service_common.subnet_ids
  security_group_ids = local.service_common.security_group_ids
}

module "frontend" {
  source = "../modules/ecs-service"
  count  = var.services_enabled ? 1 : 0

  name  = "frontend"
  image = local.image["frontend"] # built with VITE_KEYCLOAK_URL=<public url>/auth (scripts/push-images.ps1)
  port  = 80

  health_check_command = ["CMD", "wget", "-qO-", "http://127.0.0.1/healthz"]

  execution_role_arn = aws_iam_role.execution["frontend"].arn
  log_group_name     = aws_cloudwatch_log_group.service["frontend"].name
  region             = var.region
  cluster_arn        = local.service_common.cluster_arn
  namespace_arn      = local.service_common.namespace_arn
  subnet_ids         = local.service_common.subnet_ids
  security_group_ids = local.service_common.security_group_ids
}

module "gateway" {
  source     = "../modules/ecs-service"
  count      = var.services_enabled ? 1 : 0
  depends_on = [module.frontend, module.user_service, module.supplier_service, module.credit_service, module.order_service]

  name  = "gateway"
  image = local.image["gateway"]
  port  = 80

  health_check_command   = ["CMD", "wget", "-qO-", "http://127.0.0.1/healthz"]
  service_connect_server = false # nobody calls the gateway by name; the ALB sends it the traffic
  target_group_arn       = aws_lb_target_group.gateway.arn

  execution_role_arn = aws_iam_role.execution["gateway"].arn
  log_group_name     = aws_cloudwatch_log_group.service["gateway"].name
  region             = var.region
  cluster_arn        = local.service_common.cluster_arn
  namespace_arn      = local.service_common.namespace_arn
  subnet_ids         = local.service_common.subnet_ids
  security_group_ids = local.service_common.security_group_ids
}
