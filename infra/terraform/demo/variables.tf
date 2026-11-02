variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "github_repo" {
  description = "owner/name of the GitHub repo whose workflows may assume the deploy and plan roles."
  type        = string
  default     = "Y2627S1-CS3219-P19/FOC"
}

# ---- Two-phase start -------------------------------------------------------------------------

variable "services_enabled" {
  description = "false = infrastructure only (ECR is still empty). true = create the 7 ECS services."
  type        = bool
  default     = false
}

variable "initial_image_tag" {
  description = "Git SHA the first images were pushed under. Only used when the services are created; CI owns the image after that."
  type        = string
  default     = ""

  validation {
    condition     = !var.services_enabled || length(var.initial_image_tag) > 0
    error_message = "Set initial_image_tag (the git SHA of the pushed images) when services_enabled = true."
  }
}

# ---- Email and alerts ------------------------------------------------------------------------
# Keycloak sends verification / reset emails through Gmail SMTP, not SES: the NUS organisation blocks
# iam:CreateUser, and SES SMTP credentials can only be made from an IAM user (2026-11-02).
# The SMTP username + app password are secrets (SSM, put-secrets.ps1), not variables.

variable "email_from_address" {
  description = "Sender of Keycloak's emails. With Gmail SMTP this must be the Gmail account that owns the app password."
  type        = string
}

variable "smtp_host" {
  type    = string
  default = "smtp.gmail.com"
}

variable "smtp_port" {
  description = "587 = STARTTLS."
  type        = string
  default     = "587"
}

variable "alert_email" {
  description = "Gets the alarm emails (confirm the SNS subscription email once)."
  type        = string
}

variable "admin_contact_email" {
  description = "Shown to suspended users (user-service ADMIN_CONTACT_EMAIL)."
  type        = string
  default     = "foc-admin@u.nus.edu"
}
