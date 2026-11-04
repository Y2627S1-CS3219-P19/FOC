# GitHub Actions log in to AWS with short-lived OIDC tokens instead of stored access keys.
# GitHub signs a token saying "this run is repo X, environment Y"; AWS trusts it only for the roles
# below and only when those claims match. There is NO role that can run terraform apply.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  oidc_sub = "token.actions.githubusercontent.com:sub"
  oidc_aud = "token.actions.githubusercontent.com:aud"
}

# ---- foc-deploy: main.yml (push images, deploy ECS) ------------------------------------------

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = local.oidc_aud
      values   = ["sts.amazonaws.com"]
    }
    # Only jobs that run in the GitHub environments "aws" / "aws-frozen" (both limited to main).
    condition {
      test     = "StringEquals"
      variable = local.oidc_sub
      values = [
        "${var.github_oidc_sub_prefix}:environment:aws",
        "${var.github_oidc_sub_prefix}:environment:aws-frozen",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "foc-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json
}

resource "aws_iam_role_policy" "deploy" {
  name = "push-images-and-deploy"
  role = aws_iam_role.deploy.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
          "ecr:DescribeImages", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload",
          "ecr:PutImage", "ecr:UploadLayerPart",
        ]
        Resource = [for r in aws_ecr_repository.app : r.arn]
      },
      {
        Sid      = "TaskDefinitions" # these two actions do not support resource-level permissions
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
        Resource = "*"
      },
      {
        Sid      = "UpdateServices"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = "arn:aws:ecs:${var.region}:${local.account_id}:service/foc/*"
      },
      {
        Sid      = "PassExecutionRoles" # a new task definition revision names its execution role
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [for k, r in aws_iam_role.execution : r.arn if k != "admin"]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}

# ---- foc-terraform-plan: infra.yml (plan on PRs, weekly drift check) - read only -------------

data "aws_iam_policy_document" "plan_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = local.oidc_aud
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = local.oidc_sub
      values = [
        "${var.github_oidc_sub_prefix}:pull_request",
        "${var.github_oidc_sub_prefix}:ref:refs/heads/main",
      ]
    }
  }
}

resource "aws_iam_role" "plan" {
  name               = "foc-terraform-plan"
  assume_role_policy = data.aws_iam_policy_document.plan_trust.json
}

resource "aws_iam_role_policy_attachment" "plan_read_only" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "plan" {
  name = "state-read-and-no-secrets"
  role = aws_iam_role.plan.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadState" # infra.yml runs plan with -lock=false, so no write is needed
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "arn:aws:s3:::foc-tfstate-${local.account_id}/demo/terraform.tfstate"
      },
      {
        Sid      = "ListStateBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "arn:aws:s3:::foc-tfstate-${local.account_id}"
      },
      {
        Sid    = "NoSecretValues" # ReadOnlyAccess would otherwise allow reading them
        Effect = "Deny"
        Action = [
          "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory",
        ]
        Resource = "${local.ssm_arn_prefix}/foc/*"
      },
      {
        Sid      = "NoSecretsManager"
        Effect   = "Deny"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "*"
      },
    ]
  })
}
