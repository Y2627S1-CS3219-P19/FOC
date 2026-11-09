# FAQ service (F28) + its Chroma vector database. See plans/faq-rag-bedrock.md.
#
# Chroma is NOT built (official image, like rabbitmq) and has no ECR repo. Its data MUST survive
# deploys (the knowledge base is ingested once), so the container gets an EFS volume - Fargate
# disks are ephemeral. The mount targets reuse the tasks security group, whose tasks-from-tasks
# rule already allows 2049.
#
# faq-service reads its model keys from SSM (see ssm.tf + put-secrets.ps1). The GEMINI/OPENROUTER
# keys are subscription values - never pass through Terraform.

resource "aws_efs_file_system" "chroma" {
  count            = var.services_enabled ? 1 : 0
  creation_token   = "foc-chroma"
  encrypted        = true
  performance_mode = "generalPurpose"

  tags = { Name = "foc-chroma" }
}

resource "aws_efs_mount_target" "chroma" {
  count           = var.services_enabled ? length(aws_subnet.private) : 0
  file_system_id  = aws_efs_file_system.chroma[0].id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.tasks.id]
}

resource "aws_efs_access_point" "chroma" {
  count          = var.services_enabled ? 1 : 0
  file_system_id = aws_efs_file_system.chroma[0].id

  root_directory {
    path = "/chroma"
    creation_info {
      owner_gid   = 0
      owner_uid   = 0
      permissions = "755"
    }
  }

  tags = { Name = "foc-chroma" }
}

module "chroma" {
  source = "../modules/ecs-service"
  count  = var.services_enabled ? 1 : 0

  name  = "chroma"
  image = "chromadb/chroma:1.5.9"
  port  = 8000
  cpu   = 512
  # 512 CPU is only valid with >= 1 GB on Fargate; a full GB for the KB database.
  memory = 1024
  # Regular FARGATE, not Spot: like rabbitmq, the data (ingested knowledge base) must survive,
  # and Spot reclaims would drop the EFS mount mid-write.
  capacity_provider     = "FARGATE"
  wait_for_steady_state = true

  environment = {
    IS_PERSISTENT = "TRUE"
    PERSIST_DIR   = "/chroma"
  }

  # The chroma image has no wget/curl/python on PATH (compose.yaml documents this), so the ECS
  # health check uses bash's /dev/tcp — same pattern as the keycloak service in services.tf.
  # The chroma image has no wget/curl/python on PATH (compose.yaml documents this) and /bin/sh is
  # dash (no /dev/tcp), so the health check invokes /bin/bash explicitly — same /dev/tcp HTTP probe
  # as the keycloak service. Verified verbatim inside chromadb/chroma:1.5.9 (HTTP 200, exit 0).
  health_check_command      = ["CMD-SHELL", "/bin/bash -c 'exec 3<>/dev/tcp/127.0.0.1/8000 && printf \"GET /api/v2/heartbeat HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n\" >&3 && head -1 <&3 | grep -q 200'"]
  health_check_start_period = 120

  volumes = [{
    name = "chroma-data"
    efs = {
      file_system_id  = aws_efs_file_system.chroma[0].id
      access_point_id = aws_efs_access_point.chroma[0].id
    }
  }]
  mount_points = [{ container_path = "/chroma", source_volume = "chroma-data" }]

  execution_role_arn = aws_iam_role.execution["chroma"].arn
  log_group_name     = aws_cloudwatch_log_group.service["chroma"].name
  region             = var.region
  cluster_arn        = local.service_common.cluster_arn
  namespace_arn      = local.service_common.namespace_arn
  subnet_ids         = local.service_common.subnet_ids
  security_group_ids = local.service_common.security_group_ids
}

module "faq_service" {
  source     = "../modules/ecs-service"
  count      = var.services_enabled ? 1 : 0
  depends_on = [module.keycloak, module.chroma]

  name  = "faq-service"
  image = local.image["faq-service"]
  port  = 3005

  environment = merge(local.node_common_env, local.trust_proxy, {
    PORT              = "3005"
    CHROMA_URL        = "http://chroma:8000"
    FAQ_COLLECTION    = "foc_faq"
    FAQ_SUPPORT_EMAIL = var.admin_contact_email
  })

  secrets = local.service_secret_arns["faq-service"]

  # wget exists in the node:22-alpine image (same check as compose.yaml).
  health_check_command      = ["CMD", "wget", "-qO-", "http://127.0.0.1:3005/health/ready"]
  health_check_start_period = 120

  execution_role_arn = aws_iam_role.execution["faq-service"].arn
  log_group_name     = aws_cloudwatch_log_group.service["faq-service"].name
  region             = var.region
  cluster_arn        = local.service_common.cluster_arn
  namespace_arn      = local.service_common.namespace_arn
  subnet_ids         = local.service_common.subnet_ids
  security_group_ids = local.service_common.security_group_ids

  # First boot needs the SSM secrets (put-secrets.ps1) and faq_db (the foc-admin one-off task),
  # both of which happen after this apply — steady state is CI's job from the first deploy on.
  wait_for_steady_state = false
}
