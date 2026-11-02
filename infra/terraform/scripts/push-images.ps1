<#
Builds the 7 images from the CURRENT commit on this laptop and pushes them to ECR, tagged with the
full git SHA. Stand-in for the first main.yml run (implementation-plan.txt 9.5) so the demo can go up
before main.yml exists. Use it on an up-to-date, clean main that passed pr.yml.

    .\infra\terraform\scripts\push-images.ps1                  # all 7
    .\infra\terraform\scripts\push-images.ps1 -Only frontend   # just some

Images already in ECR under this SHA are skipped (tags are immutable).
Prints the SHA to use as initial_image_tag.
#>
param([string[]]$Only)

$env:AWS_PROFILE = 'nus'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$demo = Join-Path $root 'infra\terraform\demo'

Push-Location $root
try {
  if (git status --porcelain --untracked-files=no) { throw 'Uncommitted changes: an image must match a commit. Commit or stash first.' }
  $sha = (git rev-parse HEAD).Trim()

  $registry = terraform -chdir="$demo" output -raw ecr_registry
  $publicUrl = terraform -chdir="$demo" output -raw public_url
  if (-not $registry -or -not $publicUrl) { throw 'Could not read terraform outputs. Has demo/ been applied?' }

  aws ecr get-login-password | docker login --username AWS --password-stdin $registry
  if ($LASTEXITCODE -ne 0) { throw 'ECR login failed. Logged in? Run: aws sso login --profile nus' }

  # docker build arguments per image (same contexts as compose.yaml / pr.yml).
  $builds = [ordered]@{
    'user-service'     = @('-f', 'user-service/Dockerfile', '.')
    'supplier-service' = @('-f', 'supplier-service/Dockerfile', '.')
    'credit-service'   = @('-f', 'credit-service/Dockerfile', '.')
    'order-service'    = @('-f', 'order-service/Dockerfile', '.')
    # Vite bakes this into the JS. No VITE_MAILPIT_URL, so the dev Mailpit hint stays hidden.
    'frontend'         = @('-f', 'frontend/Dockerfile', '--build-arg', "VITE_KEYCLOAK_URL=$publicUrl/auth", '.')
    'gateway'          = @('gateway')
    'keycloak'         = @('infra/keycloak')
  }

  foreach ($name in $builds.Keys) {
    if ($Only -and ($Only -notcontains $name)) { continue }
    $ref = "$registry/foc/${name}:$sha"

    $existing = aws ecr list-images --repository-name "foc/$name" --filter tagStatus=TAGGED --query "imageIds[?imageTag=='$sha'].imageTag" --output text
    if ($existing) { Write-Host "skip   $ref (already in ECR)"; continue }

    Write-Host "build  $ref"
    docker build --platform linux/amd64 -t $ref $builds[$name]
    if ($LASTEXITCODE -ne 0) { throw "docker build failed: $name" }
    docker push $ref
    if ($LASTEXITCODE -ne 0) { throw "docker push failed: $name" }
  }

  Write-Host ''
  Write-Host "initial_image_tag = $sha"
} finally {
  Pop-Location
}
