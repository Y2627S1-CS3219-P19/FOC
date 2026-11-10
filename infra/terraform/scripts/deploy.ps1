<#
Deploys already-pushed images to ECS. Stand-in for main.yml's deploy job (cicd-plan.txt section 2)
until main.yml exists. Same steps: take the family's LATEST task definition revision (so env changes
from a terraform apply are included), swap in the image by digest, register it, update the service,
wait until stable. A failing deploy is rolled back by the ECS circuit breaker.

    .\infra\terraform\scripts\push-images.ps1 -Only order-service      # build + push first
    .\infra\terraform\scripts\deploy.ps1 -Services order-service       # then deploy that SHA
    .\infra\terraform\scripts\deploy.ps1 -Services all                 # every app service

-Tag defaults to the current commit (what push-images.ps1 just pushed).
Never changes Terraform's initial_image_tag, and never touches rabbitmq.
Needs jq (installed per implementation-plan 0.4).
#>
param(
  [Parameter(Mandatory)][string[]]$Services,
  [string]$Tag
)

$env:AWS_PROFILE = 'nus'
$cluster = 'foc'
$appServices = @('user-service', 'supplier-service', 'credit-service', 'order-service', 'faq-service', 'frontend', 'gateway', 'keycloak')

if (-not $Tag) { $Tag = (git -C $PSScriptRoot rev-parse HEAD).Trim() }
if ($Services -contains 'all') { $Services = $appServices }
foreach ($s in $Services) {
  if ($appServices -notcontains $s) { throw "Unknown service '$s'. Use one of: $($appServices -join ', '), all" }
}

$registry = terraform -chdir="$(Join-Path $PSScriptRoot '..\demo')" output -raw ecr_registry
if (-not $registry) { throw 'Could not read terraform outputs. Run from a checkout where demo/ is initialised.' }

# Check every image first, so a missing one does not leave a half-done deploy.
$digests = @{}
foreach ($svc in $Services) {
  $found = aws ecr list-images --repository-name "foc/$svc" --filter tagStatus=TAGGED --query "imageIds[?imageTag=='$Tag'].imageDigest" --output text
  if ($LASTEXITCODE -ne 0) { throw 'aws ecr failed. Logged in? Run: aws sso login --profile nus' }
  if (-not $found) { throw "foc/${svc}:$Tag is not in ECR. Run push-images.ps1 first." }
  $digests[$svc] = $found.Trim()
}

foreach ($svc in $Services) {
  $image = "$registry/foc/$svc@$($digests[$svc])"
  Write-Host "== $svc -> $image"

  # The revision running now = the target for a manual rollback if the new version is healthy but wrong.
  $current = aws ecs describe-services --cluster $cluster --services $svc --query 'services[0].taskDefinition' --output text
  if ($LASTEXITCODE -ne 0 -or -not $current) { throw "Could not read the running revision of $svc" }
  Write-Host "   running now: $current"
  Write-Host "   roll back:   aws ecs update-service --cluster $cluster --service $svc --task-definition $current --profile nus"

  # Latest revision of the family, minus the read-only fields register-task-definition rejects.
  $json = aws ecs describe-task-definition --task-definition "foc-$svc" --query taskDefinition --output json |
    jq --arg img $image '.containerDefinitions[0].image = $img | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)'
  if ($LASTEXITCODE -ne 0 -or -not $json) { throw "Could not read the task definition foc-$svc" }

  $file = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($file, ($json -join "`n")) # UTF-8 without BOM; the AWS CLI rejects a BOM
  try {
    $arn = aws ecs register-task-definition --cli-input-json "file://$file" --query taskDefinition.taskDefinitionArn --output text
    if ($LASTEXITCODE -ne 0) { throw "register-task-definition failed for $svc" }
  } finally {
    Remove-Item $file -ErrorAction SilentlyContinue
  }
  Write-Host "   registered $arn"

  aws ecs update-service --cluster $cluster --service $svc --task-definition $arn --query service.serviceName --output text | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "update-service failed for $svc" }

  # Watch the deployment itself (not `aws ecs wait services-stable`, which gives up after 10 min - a
  # keycloak rolling deploy takes longer). If the circuit breaker rolls back, the PRIMARY deployment
  # becomes the old revision again.
  Write-Host '   waiting for the rollout (up to 20 min; keycloak takes ~10)...'
  $deadline = (Get-Date).AddMinutes(20)
  while ($true) {
    $primary = aws ecs describe-services --cluster $cluster --services $svc --query "services[0].deployments[?status=='PRIMARY'] | [0].[taskDefinition, rolloutState]" --output text
    if ($primary -match 'FAILED' -or $primary -notmatch [regex]::Escape($arn)) {
      throw "$svc did not deploy (now: $primary). The circuit breaker rolled back. Check: aws logs tail /foc/$svc --since 15m"
    }
    if ($primary -match 'COMPLETED') { break }
    if ((Get-Date) -gt $deadline) {
      throw "$svc still rolling out after 20 min ($primary). Check: aws ecs describe-services --cluster foc --services $svc --query services[0].events[0:5].message"
    }
    Start-Sleep -Seconds 15
  }
  Write-Host "   OK"
}

Write-Host ''
Write-Host "Deployed $Tag to: $($Services -join ', ')"
