# Read-only access for teammates. The NUS organisation blocks IAM users (iam:CreateUser), and only NUS
# decides who can sign in to this sandbox account through Identity Center. So teammates sign in to
# THEIR OWN NUS sandbox account as usual, then "switch role" into this one.
#
#   Console:  https://signin.aws.amazon.com/switchrole?account=<this account>&roleName=foc-team-readonly
#   CLI:      a profile with role_arn = <team_role_arn output> and source_profile = <their own SSO profile>
#
# They can look at everything (ECS, CloudWatch logs and alarms, RDS, ALB, CloudFront), but cannot
# change anything, read secret values or read the Terraform state. Only the infra owner applies.
# Created only when var.team_account_ids is not empty.

data "aws_iam_policy_document" "team_trust" {
  count = length(var.team_account_ids) > 0 ? 1 : 0

  statement {
    actions = ["sts:AssumeRole", "sts:SetSourceIdentity"]
    principals {
      type        = "AWS"
      identifiers = [for id in var.team_account_ids : "arn:aws:iam::${id}:root"]
    }
    # Only the people who sign in to those accounts through NUS Identity Center (their SSO roles),
    # not any other role or machine in those accounts.
    condition {
      test     = "ArnLike"
      variable = "aws:PrincipalArn"
      values   = [for id in var.team_account_ids : "arn:aws:iam::${id}:role/aws-reserved/sso.amazonaws.com/*"]
    }
  }
}

resource "aws_iam_role" "team" {
  count = length(var.team_account_ids) > 0 ? 1 : 0

  name                 = "foc-team-readonly"
  description          = "Teammates' read-only view of the FOC demo stack (switch role from their own NUS sandbox account)."
  assume_role_policy   = data.aws_iam_policy_document.team_trust[0].json
  max_session_duration = 3600 # switching from an SSO session is limited to 1 hour anyway
}

resource "aws_iam_role_policy_attachment" "team_read_only" {
  count = length(var.team_account_ids) > 0 ? 1 : 0

  role       = aws_iam_role.team[0].name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "team" {
  count = length(var.team_account_ids) > 0 ? 1 : 0

  name = "no-secrets-no-state"
  role = aws_iam_role.team[0].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "NoSecretValues" # ReadOnlyAccess would otherwise allow reading the SSM SecureStrings
        Effect = "Deny"
        Action = [
          "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory",
        ]
        Resource = "${local.ssm_arn_prefix}/foc/*"
      },
      {
        Sid      = "NoSecretsManager" # RDS keeps its master password here
        Effect   = "Deny"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "*"
      },
      {
        Sid      = "NoTerraformState" # the state file can contain sensitive values
        Effect   = "Deny"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "arn:aws:s3:::foc-tfstate-${local.account_id}/*"
      },
    ]
  })
}
