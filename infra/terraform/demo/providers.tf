# Demo stack: everything the app needs in AWS (aws-infra-plan.txt). State lives in the bucket made by
# ../bootstrap (see backend.tf). Run with AWS_PROFILE=nus, from an up-to-date main checkout.
#
# Two-phase start (implementation-plan.txt Phase 5 / 10), because ECS needs images and ECR starts empty:
#   1. terraform apply                                   -> network, ECR, IAM, RDS, MQ, cluster, ALB, CloudFront
#   2. put secrets, create databases, push images        (infra/terraform/scripts)
#   3. terraform apply -var services_enabled=true -var initial_image_tag=<git sha>   -> the 7 ECS services

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  # Refuse to run against any other account (e.g. the unrelated default CLI profile).
  allowed_account_ids = ["698766074984"]

  default_tags {
    tags = {
      project    = "foc"
      managed-by = "terraform"
      stack      = "demo"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  account_id = data.aws_caller_identity.current.account_id

  # The 7 container images; each gets an ECR repo foc/<name>, a log group and an ECS service.
  images = ["user-service", "supplier-service", "credit-service", "order-service", "faq-service", "frontend", "gateway", "keycloak"]
}
