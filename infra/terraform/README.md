# Terraform: AWS demo environment

Design: `aws-infra-plan.txt`. Order of work: `implementation-plan.txt` (Phases 4-10).
Only the infra owner runs `terraform apply`, from a laptop, on an up-to-date `main`.

| Folder | What it is |
|---|---|
| `bootstrap/` | The S3 bucket that holds the demo state. Local state. Applied once (done). |
| `demo/` | Everything else: VPC, NAT instance, ECR, IAM/OIDC, RDS, ECS (7 services + a RabbitMQ container), ALB, CloudFront, alarms, dashboard. |
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
   Note the printed SHA. (After the first start, main.yml does this.)
6. **Services.** `terraform apply -var services_enabled=true -var initial_image_tag=<sha>`.
   Keycloak and RabbitMQ first, then user-service, then the rest; Terraform waits for each, so this
   takes ~10-15 min.
7. Open `terraform output -raw public_url`.

8. **Make it permanent.** In `demo/variables.tf` set the defaults `services_enabled = true` and
   `initial_image_tag = "<sha>"`, and commit. Every later plan (yours and CI's) then keeps the
   services. Without it, a plain `terraform apply` plans to delete all of them. Never change
   `initial_image_tag` again: CI owns the image from now on.

## Checks on pull requests

pr.yml runs `terraform init -backend=false` + `terraform validate` on `demo/` for any PR that
touches `infra/terraform/**` (no AWS access, no state). It catches syntax and type errors; it is
not a plan, so `terraform plan` before every apply is still needed.

## Deploying a new commit

Automatic: merging to `main` runs `.github/workflows/main.yml`, which builds, scans, pushes and
deploys every image the merge changed, then smoke-tests the site. Redeploy by hand from the Actions
tab: Main -> Run workflow -> services `order-service` (or `all`). `DEPLOY_FREEZE=true` (repo
variable) makes deploys wait for approval on the `aws-frozen` environment. `gh` needs
`--repo Y2627S1-CS3219-P19/FOC` here (it otherwise picks the course template repo).

Emergency fallback from the laptop (skips Trivy and the freeze), on an up-to-date, clean `main`
that passed pr.yml:

```powershell
.\infra\terraform\scripts\push-images.ps1 -Only order-service   # build + push the changed images
.\infra\terraform\scripts\deploy.ps1 -Services order-service    # point ECS at them, wait until stable
```

`deploy.ps1` does what main.yml's deploy job does: latest task definition revision + new image
(by digest) -> register -> update the service -> wait. If the new tasks fail, the circuit breaker
rolls back and the script says so. Do not touch `initial_image_tag` for this.
To make a Terraform env/secret change reach a running service: apply, then redeploy that service
(Run workflow with services `<svc>`, or `deploy.ps1 -Services <svc> -Tag <running sha>`).

**Rollback.** The circuit breaker only rolls back tasks that never get healthy. If a new version is
healthy but wrong, go back by hand: main.yml's run Summary (and `deploy.ps1`'s output) shows each
service's revision from before the deploy, with the `aws ecs update-service ... --task-definition
<that revision>` command to run. That brings back the old image and the old task definition's env
and secret names; secret values are read from SSM at start, so they stay current. ECR keeps the last
10 images per repo, so only recent builds can be rolled back to. Then fix forward with a normal PR.

## Adding a service to the running stack

The two-phase start above only covers the initial batch: `initial_image_tag` pins every task
definition to one shared SHA, and services can only be created healthy when their image, secrets
and database already exist. A service added later (like faq-service in PR #46) needs this order —
infra code merges in a PR, but it only takes effect at the apply, never at the merge:

1. Merge the PR (infra + service code). CI's first push **will 403** — the ECR repo and CI push
   role exist only after the next step.
2. `terraform apply` from clean `main`. This creates the ECR repo, extends the `foc-deploy` push
   role, and registers the task definitions.
3. Write the service's SSM secrets (`put-secrets.ps1`) and run the `foc-admin` task if the service
   needs a new database (its SQL is in the task definition).
4. Re-run the failed `main.yml` run (or Run workflow): push the image, register a revision from
   it, deploy, and the service goes healthy.

Notes: the ECS service module sets `wait_for_steady_state = false` for a service whose first boot
depends on post-apply steps (see `demo/chroma.tf`, faq-service) — don't flip it back on. New
services also need their own entries in `local.images` (providers.tf), `ssm.tf` (env var names —
they must match the service's config), and the service map for secrets. When a task-definition
change (health check, env, memory) has no image to ride along — chroma is the example, it is a
public image with no CI build — apply, then point the service at the new revision by hand:
`aws ecs update-service --cluster foc --service <svc> --task-definition foc-<svc>`.


## Team access (read-only)

IAM users are blocked by the NUS organisation, so teammates use their OWN NUS sandbox account and
switch into the role `foc-team-readonly` (`demo/team-access.tf`). They see ECS, logs, alarms, RDS,
ALB and CloudFront, but cannot change anything, read SSM secret values or read the Terraform state.

1. Each teammate signs in to their own account and runs
   `aws sts get-caller-identity --query Account --output text` (or copies the 12-digit ID from the
   console's top-right menu).
2. The infra owner adds the IDs to `terraform.tfvars` (`team_account_ids = ["111111111111", ...]`),
   then `terraform plan` (expect 3 to add: role, policy attachment, inline policy) and `terraform apply`.
3. Send them `terraform output -raw team_switch_role_url`. They open it while signed in to their own
   account -> "Switch role". Sessions last 1 hour; switch again after that.
   CLI instead: in their `~/.aws/config`
   ```ini
   [profile foc-team]
   role_arn = <terraform output -raw team_role_arn>
   source_profile = <their own SSO profile>
   region = ap-southeast-1
   ```
   then e.g. `aws logs tail /foc/order-service --since 15m --profile foc-team`.

If switching fails with "not authorized to perform sts:AssumeRole", the NUS rules block switching
between sandbox accounts; then only NUS can add teammates to this account.

## Monitoring

CloudWatch > Dashboards > `foc` (`demo/dashboard.tf`) shows alarm states, ALB traffic, 5xx errors and
response time, messaging, CPU and memory per service, RDS, and the latest error logs.
Every alarm emails `alert_email` through SNS (`demo/observability.tf`).

RabbitMQ sends no CloudWatch metrics, so the messaging metrics (namespace `FOC`) come from log lines:

| Metric | From | Alarm |
| ----- | ----- | ----- |
| `DeadLetteredMessages` | `"Message dead-lettered"` in credit-service / order-service logs | `foc-messages-dead-lettered`: any in 5 min |
| `OutboxOldestUnpublishedSeconds`, `OutboxBacklog`, `OrderDlqDepth` | order-service's outbox monitor, every 30s | `foc-outbox-publish-lag`: over 120s for 3 min |

`OrderDlqDepth` covers only order-service's DLQ. A message that fails in credit-service shows up in
`DeadLetteredMessages`. If you rename these log messages or fields, update the filters too.

## Rules

- Any destroy (`-`) or replace (`-/+`) of RDS, ECR or a secret in a plan: stop and ask.
- Redeploying the rabbitmq service loses queued messages (it has no disk). Avoid it during a demo.
- Never `-target`. Never edit these resources in the console (the weekly drift check will fail).
- After an apply that changes a task definition (env, secrets, CPU), redeploy that service (main.yml
  workflow_dispatch). The service ignores Terraform's new revision on purpose: CI owns the image.

## Troubleshooting

- **main.yml fails at configure-aws-credentials** with "Not authorized to perform
  sts:AssumeRoleWithWebIdentity": the role's trusted `sub` does not match the token. Compare
  `github_oidc_sub_prefix` (variables.tf) with
  `gh api repos/Y2627S1-CS3219-P19/FOC/actions/oidc/customization/sub --jq .sub_claim_prefix`.
  Right after changing the trust policy, wait a minute and re-run (IAM takes a moment to update).
- **First apply in a fresh account fails** with "ECS Service Linked Role is not ready" or the NAT
  group's "Authentication Failure": AWS was still creating its service-linked roles. If the NAT
  instance is running anyway (`aws ec2 describe-instances --filters Name=tag:Name,Values=foc-nat`),
  run `terraform untaint 'module.nat.aws_autoscaling_group.main[0]'`, then `terraform apply` again.
- **A service keeps restarting**: `aws logs tail /foc/<service> --since 15m`.
- **Keycloak never gets healthy** (0.5 vCPU / 1 GB): raise to 1024 / 2048 in `services.tf`.
- **"Login failed: Failed to fetch"** after the Keycloak login page: the browser blocked an
  `http://` Keycloak URL on the https site. Check
  `curl.exe -s <public_url>/auth/realms/campuserrand/.well-known/openid-configuration | jq .token_endpoint`
  starts with `https://`. If not, `KC_HOSTNAME_BACKCHANNEL_DYNAMIC` must be `"false"` in
  services.tf; apply, then `deploy.ps1 -Services keycloak -Tag <running sha>`.
- **Login loops or "Cookie not found"** on Keycloak: Keycloak is not treating requests as HTTPS.
  Check `KC_HOSTNAME` in the keycloak task definition is `https://<public host>/auth`.
- **deploy.ps1 seems slow on keycloak**: a Keycloak rolling deploy takes ~10-12 min (new task
  boots, health checks, old task drains). The script waits up to 20 min.
- **Emails do not arrive**: check Junk first. Then `aws logs tail /foc/keycloak --since 15m` for
  SMTP errors. "535 Username and Password not accepted" = wrong Gmail address or app password
  (or 2-Step Verification was turned off, which revokes app passwords). Make a new app password,
  then fix it in BOTH places: (1) SSM - `aws ssm delete-parameters --names /foc/keycloak/SMTP_USER
  /foc/keycloak/SMTP_PASSWORD`, re-run put-secrets.ps1; (2) Keycloak itself - `/auth/admin` as
  kc-admin -> realm campuserrand -> Realm settings -> Email -> Username/Password -> Save.
  Keycloak copied the SMTP login into its database at the first start, so (1) alone changes
  nothing until a full re-create. Gmail allows ~500 emails a day.
- **A user never got the verification email** (registered while email was broken): they log
  in and click "re-send", or in `/auth/admin` -> campuserrand -> Users -> the user ->
  Credentials -> Credential reset -> Verify Email -> Send email (or set "Email verified" on).
