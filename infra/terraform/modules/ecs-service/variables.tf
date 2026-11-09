variable "name" {
  description = "Service name = container name = Service Connect DNS name (same as in compose.yaml)."
  type        = string
}

variable "image" {
  description = "Image for the FIRST task definition only. CI deploys later images (ignore_changes in main.tf)."
  type        = string
}

variable "cpu" {
  type    = number
  default = 256 # 0.25 vCPU, the Fargate minimum
}

variable "memory" {
  type    = number
  default = 512
}

variable "port" {
  description = "Container port; also the Service Connect port."
  type        = number
}

variable "extra_port_mappings" {
  type = list(object({
    name          = string
    containerPort = number
    protocol      = string
  }))
  default = []
}

variable "environment" {
  description = "Plain (non-secret) env vars."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Env var name => SSM parameter ARN. ECS reads the value when the task starts."
  type        = map(string)
  default     = {}
}

variable "health_check_command" {
  description = "Container health check command. null = no health check (the task counts healthy once running)."
  type        = list(string)
  default     = null
}

variable "health_check_start_period" {
  description = "Seconds after start in which failed health checks do not count (max 300)."
  type        = number
  default     = 60
}

variable "service_connect_server" {
  description = "true = other services can call this one by name. false = client only (the gateway)."
  type        = bool
  default     = true
}

variable "target_group_arn" {
  description = "ALB target group to register the tasks in (gateway, keycloak); null for internal services."
  type        = string
  default     = null
}

variable "health_check_grace_period" {
  description = "Seconds the ALB health check is ignored after a task starts (only with a target group)."
  type        = number
  default     = 60
}

variable "capacity_provider" {
  description = "FARGATE_SPOT (~70% cheaper, can be stopped with 2 min notice) or FARGATE."
  type        = string
  default     = "FARGATE_SPOT"
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "wait_for_steady_state" {
  description = "Make terraform apply wait until the service is healthy (used so dependants start after it)."
  type        = bool
  default     = false
}

variable "cluster_arn" {
  type = string
}

variable "namespace_arn" {
  type = string
}

variable "execution_role_arn" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "log_group_name" {
  type = string
}

variable "region" {
  type = string
}

variable "volumes" {
  description = "Extra task-definition volumes (EFS). Each needs a matching mount_points entry."
  type = list(object({
    name = string
    efs = optional(object({
      file_system_id  = string
      access_point_id = string
    }))
  }))
  default = []
}

variable "mount_points" {
  description = "container_path = where the volume appears inside the container; source_volume = volumes[].name."
  type = list(object({
    container_path = string
    source_volume  = string
  }))
  default = []
}
