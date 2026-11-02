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

# ---- Email (SES) and alerts ------------------------------------------------------------------

variable "ses_from_address" {
  description = "Sender of Keycloak's verification / reset emails. Terraform asks SES to verify it (click the link AWS emails you)."
  type        = string
}

variable "ses_recipient_addresses" {
  description = "SES sandbox only delivers to verified addresses: every inbox that must receive mail (each gets a verification email)."
  type        = list(string)
  default     = []
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
