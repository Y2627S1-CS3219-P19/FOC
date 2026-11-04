output "public_url" {
  description = "The site. Also the value for VITE_KEYCLOAK_URL (+ /auth) and the GitHub variable PUBLIC_HOST (without https://)."
  value       = local.public_url
}

output "ecr_registry" {
  value = "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "plan_role_arn" {
  value = aws_iam_role.plan.arn
}

output "team_role_arn" {
  description = "Teammates switch into this role (team-access.tf). Null when team_account_ids is empty."
  value       = one(aws_iam_role.team[*].arn)
}

output "team_switch_role_url" {
  description = "Send this link to teammates: they open it while signed in to their own NUS sandbox account."
  value       = length(var.team_account_ids) > 0 ? "https://signin.aws.amazon.com/switchrole?account=${local.account_id}&roleName=foc-team-readonly&displayName=FOC-demo" : null
}

output "rds_address" {
  value = aws_db_instance.main.address
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

# For `aws ecs run-task` of the foc-admin task (README.md).
output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "tasks_security_group_id" {
  value = aws_security_group.tasks.id
}
