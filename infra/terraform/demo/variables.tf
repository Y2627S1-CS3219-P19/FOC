variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "github_repo" {
  description = "owner/name of the GitHub repo whose workflows may assume the deploy and plan roles."
  type        = string
  default     = "Y2627S1-CS3219-P19/FOC"
}

# GitHub signs this repo's OIDC tokens with the "immutable" subject format, which adds the owner and
# repo IDs: repo:<owner>@<owner id>/<repo>@<repo id>:environment:aws. With the old repo:<owner>/<repo>
# format every AWS login failed (2026-11-04, first main.yml run). The IDs also mean a renamed or
# re-created repo with the same name cannot assume the roles. Check the current value with:
#   gh api repos/Y2627S1-CS3219-P19/FOC/actions/oidc/customization/sub --jq .sub_claim_prefix
variable "github_oidc_sub_prefix" {
  description = "The 'sub' claim prefix GitHub puts in this repo's OIDC tokens (see the comment above)."
  type        = string
  default     = "repo:Y2627S1-CS3219-P19@323916185/FOC@1357921616"
}

# ---- Two-phase start -------------------------------------------------------------------------

# Both set 2026-11-02 when the services were first created. Never change initial_image_tag: CI and
# scripts/deploy.ps1 own the running image (aws-infra-plan.txt TASK DEFINITION OWNERSHIP). After a full
# teardown, start again with services_enabled = false.
variable "services_enabled" {
  description = "false = infrastructure only (ECR is still empty). true = create the 8 ECS services."
  type        = bool
  default     = true
}

variable "initial_image_tag" {
  description = "Git SHA the first images were pushed under. Only used when the services are created; CI owns the image after that."
  type        = string
  default     = "b004964384f29f44f9bd331ec19a11347f2f3051"

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

variable "team_account_ids" {
  description = "Teammates' own NUS sandbox account IDs (12 digits). Each may switch into foc-team-readonly (team-access.tf). Empty = no team role."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for id in var.team_account_ids : can(regex("^[0-9]{12}$", id))])
    error_message = "Each team account ID must be exactly 12 digits."
  }
}

variable "admin_contact_email" {
  description = "Shown to suspended users (user-service ADMIN_CONTACT_EMAIL)."
  type        = string
  default     = "foc-admin@u.nus.edu"
}
