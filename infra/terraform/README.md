# Terraform: AWS demo environment

Design: `aws-infra-plan.txt`. Order of work: `implementation-plan.txt` (Phases 4-10).
Only the infra owner runs `terraform apply`, from a laptop, on an up-to-date `main`.

| Folder | What it is |
|---|---|
| `bootstrap/` | The S3 bucket that holds the demo state. Local state. Applied once (done). |
| `demo/` | Everything else: VPC, NAT instance, ECR, IAM/OIDC, RDS, ECS (7 services + a RabbitMQ container), ALB, CloudFront, alarms. |
| `modules/ecs-service/` | One ECS service (task definition + service + Service Connect). Used 7 times by `demo/services.tf`. |
| `scripts/` | `put-secrets.ps1`, `push-images.ps1`, `deploy.ps1` (laptop); `admin-task.sh` + `create-databases.sql` (run inside the foc-admin ECS task). |

## Every session

```powershell
aws sso login --profile nus
$env:AWS_PROFILE = "nus"
cd infra/terraform/demo
```

## First start (two phases)

ECS cannot start a service without an image, and ECR starts empty. So:

1. **Infrastructure.** `cp terraform.tfvars.example terraform.tfvars`, fill it in, then
   `terraform init`, `terraform plan`, `terraform apply`. About 10-15 min (RDS and CloudFront are slow).
   Then click the SNS subscription link that AWS emails to alert_email.
2. **Gmail app password** (Keycloak's email login). On the Gmail account in `email_from_address`:
   Google Account > Security > turn on 2-Step Verification > App passwords > name it
   `foc-keycloak` > copy the 16 letters. (Not SES SMTP: the NUS organisation blocks creating IAM
   users, which SES SMTP credentials need.)
3. **Secrets.** From the repo root: `.\infra\terraform\scripts\put-secrets.ps1`.
4. **Databases.** Run the foc-admin task once (from `demo/`):
   ```powershell
   $subnets = (terraform output -json private_subnet_ids | ConvertFrom-Json) -join ','
   $sg = terraform output -raw tasks_security_group_id
   aws ecs run-task --cluster foc --task-definition foc-admin --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=DISABLED}" --query "tasks[0].taskArn" --output text
   aws logs tail /foc/admin --follow
   ```
   Done when the log ends with `ALL DONE`. Safe to run again.
5. **Images.** From the repo root on a clean, up-to-date `main`: `.\infra\terraform\scripts\push-images.ps1`.
   Note the printed SHA. (Later, main.yml does this.)
6. **Services.** `terraform apply -var services_enabled=true -var initial_image_tag=<sha>`.
   Keycloak and RabbitMQ first, then user-service, then the rest; Terraform waits for each, so this
   takes ~10-15 min.
7. Open `terraform output -raw public_url`.

8. **Make it permanent.** In `demo/variables.tf` set the defaults `services_enabled = true` and
   `initial_image_tag = "<sha>"`, and commit. Every later plan (yours and CI's) then keeps the
   services. Without it, a plain `terraform apply` plans to delete all of them. Never change
   `initial_image_tag` again: CI owns the image from now on.

## Deploying a new commit (until main.yml exists)

From the repo root, on an up-to-date, clean `main` that passed pr.yml:

```powershell
.\infra\terraform\scripts\push-images.ps1 -Only order-service   # build + push the changed images
.\infra\terraform\scripts\deploy.ps1 -Services order-service    # point ECS at them, wait until stable
```

`deploy.ps1` does what main.yml's deploy job will do: latest task definition revision + new image
(by digest) -> register -> update the service -> wait. If the new tasks fail, the circuit breaker
rolls back and the script says so. Do not touch `initial_image_tag` for this.
Also the way to apply a Terraform env/secret change to a running service: apply, then
`deploy.ps1 -Services <svc>` with the commit that is already running.

## Rules

- Any destroy (`-`) or replace (`-/+`) of RDS, ECR or a secret in a plan: stop and ask.
- Redeploying the rabbitmq service loses queued messages (it has no disk). Avoid it during a demo.
- Never `-target`. Never edit these resources in the console (the weekly drift check will fail).
- After an apply that changes a task definition (env, secrets, CPU), redeploy that service (main.yml
  workflow_dispatch). The service ignores Terraform's new revision on purpose: CI owns the image.

## Troubleshooting

- **First apply in a fresh account fails** with "ECS Service Linked Role is not ready" or the NAT
  group's "Authentication Failure": AWS was still creating its service-linked roles. If the NAT
  instance is running anyway (`aws ec2 describe-instances --filters Name=tag:Name,Values=foc-nat`),
  run `terraform untaint 'module.nat.aws_autoscaling_group.main[0]'`, then `terraform apply` again.
- **A service keeps restarting**: `aws logs tail /foc/<service> --since 15m`.
- **Keycloak never gets healthy** (0.5 vCPU / 1 GB): raise to 1024 / 2048 in `services.tf`.
- **Login loops or "Cookie not found"** on Keycloak: Keycloak is not treating requests as HTTPS.
  Check `KC_HOSTNAME` in the keycloak task definition is `https://<public host>/auth`.
- **Emails do not arrive**: check Junk first. Then `aws logs tail /foc/keycloak --since 15m` for
  SMTP errors. "535 Username and Password not accepted" = wrong Gmail address or app password
  (or 2-Step Verification was turned off, which revokes app passwords): delete
  `/foc/keycloak/SMTP_USER` and `SMTP_PASSWORD`, re-run put-secrets.ps1, then
  `deploy.ps1 -Services keycloak -Tag <running sha>`. Gmail allows ~500 emails a day.
