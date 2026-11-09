# aws-infra-plan.txt SECRETS & IAM. Secret VALUES never pass through Terraform (they would land in
# state). Terraform only knows the parameter NAMES; ../scripts/put-secrets.ps1 writes the values to
# SSM Parameter Store as SecureString (free standard tier). ECS reads them when a task starts.
#
# Map shape: container env var name => SSM parameter name.

locals {
  ssm_arn_prefix = "arn:aws:ssm:${var.region}:${local.account_id}:parameter"

  app_common_secrets = {
    AMQP_URL             = "/foc/shared/AMQP_URL"
    INTERNAL_AUTH_SECRET = "/foc/shared/INTERNAL_AUTH_SECRET"
  }

  service_secrets = {
    "user-service" = merge(local.app_common_secrets, {
      DATABASE_URL                    = "/foc/user-service/DATABASE_URL"
      KC_USER_SERVICE_CLIENT_SECRET   = "/foc/keycloak/KC_USER_SERVICE_CLIENT_SECRET"
      BOOTSTRAP_ADMIN_EMAIL           = "/foc/user-service/BOOTSTRAP_ADMIN_EMAIL"
      BOOTSTRAP_ADMIN_USERNAME        = "/foc/user-service/BOOTSTRAP_ADMIN_USERNAME"
      BOOTSTRAP_ADMIN_TEMP_PASSWORD   = "/foc/user-service/BOOTSTRAP_ADMIN_TEMP_PASSWORD"
      BOOTSTRAP_ADMIN_2_EMAIL         = "/foc/user-service/BOOTSTRAP_ADMIN_2_EMAIL"
      BOOTSTRAP_ADMIN_2_USERNAME      = "/foc/user-service/BOOTSTRAP_ADMIN_2_USERNAME"
      BOOTSTRAP_ADMIN_2_TEMP_PASSWORD = "/foc/user-service/BOOTSTRAP_ADMIN_2_TEMP_PASSWORD"
    })
    "supplier-service" = merge(local.app_common_secrets, {
      DATABASE_URL = "/foc/supplier-service/DATABASE_URL"
    })
    "credit-service" = merge(local.app_common_secrets, {
      DATABASE_URL = "/foc/credit-service/DATABASE_URL"
    })
    "order-service" = merge(local.app_common_secrets, {
      DATABASE_URL = "/foc/order-service/DATABASE_URL"
    })
    keycloak = {
      KC_DB_PASSWORD                = "/foc/keycloak/KC_DB_PASSWORD"
      KC_BOOTSTRAP_ADMIN_USERNAME   = "/foc/keycloak/KC_BOOTSTRAP_ADMIN_USERNAME"
      KC_BOOTSTRAP_ADMIN_PASSWORD   = "/foc/keycloak/KC_BOOTSTRAP_ADMIN_PASSWORD"
      KC_USER_SERVICE_CLIENT_SECRET = "/foc/keycloak/KC_USER_SERVICE_CLIENT_SECRET"
      KC_SMTP_USER                  = "/foc/keycloak/SMTP_USER"
      KC_SMTP_PASSWORD              = "/foc/keycloak/SMTP_PASSWORD"
    }
    # The broker creates user "foc" with this password on every start. Same password as in AMQP_URL.
    rabbitmq = {
      RABBITMQ_DEFAULT_PASS = "/foc/rabbitmq/RABBITMQ_DEFAULT_PASS"
    }
    faq-service = {
      # Env var name is FAQ_DATABASE_URL (faq's config prefix); the SSM path follows the
      # /foc/<service>/<name> convention shared with put-secrets.ps1.
      FAQ_DATABASE_URL   = "/foc/faq-service/DATABASE_URL"
      GEMINI_API_KEY     = "/foc/faq-service/GEMINI_API_KEY"
      OPENROUTER_API_KEY = "/foc/faq-service/OPENROUTER_API_KEY"
    }
    gateway  = {}
    frontend = {}
  }

  # The one-off foc-admin task (ecs.tf) needs the DB passwords to create the database users.
  admin_secrets = {
    USERS_DATABASE_URL     = "/foc/user-service/DATABASE_URL"
    SUPPLIERS_DATABASE_URL = "/foc/supplier-service/DATABASE_URL"
    CREDITS_DATABASE_URL   = "/foc/credit-service/DATABASE_URL"
    ORDERS_DATABASE_URL    = "/foc/order-service/DATABASE_URL"
    FAQ_DATABASE_URL       = "/foc/faq-service/DATABASE_URL"
    KC_DB_PASSWORD         = "/foc/keycloak/KC_DB_PASSWORD"
  }

  # Same maps with full ARNs, as the task definitions' "secrets" field wants them.
  service_secret_arns = {
    for svc, m in local.service_secrets : svc => { for env, name in m : env => "${local.ssm_arn_prefix}${name}" }
  }
  admin_secret_arns = { for env, name in local.admin_secrets : env => "${local.ssm_arn_prefix}${name}" }
}
