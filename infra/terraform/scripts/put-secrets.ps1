<#
Writes every app secret to SSM Parameter Store as SecureString (implementation-plan.txt 7.1 / 7.2).
Run once after the first `terraform apply` of demo/:

    .\infra\terraform\scripts\put-secrets.ps1

- Passwords are generated here (random hex, so they never need URL escaping) and go straight to SSM:
  never to disk, never to Terraform state.
- A parameter that already exists is KEPT. Re-running is safe and never changes a password that a
  database already uses. To really rotate one, delete the parameter first, then re-run this script
  and the foc-admin task, then redeploy the services.
- It asks for 6 things it cannot generate: the Gmail address + Gmail app password Keycloak sends
  mail with (Google Account > Security > 2-Step Verification on > App passwords), and the first two
  FoC admins' emails + temporary passwords. (Not SES: the NUS organisation blocks IAM users, which
  SES SMTP credentials need.)
#>
$env:AWS_PROFILE = 'nus'
$demo = Join-Path $PSScriptRoot '..\demo'

function New-Secret {
  $bytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Read-Required([string]$Prompt, [switch]$Hidden) {
  if ($Hidden) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $value = [System.Net.NetworkCredential]::new('', $secure).Password
  } else {
    $value = Read-Host -Prompt $Prompt
  }
  if (-not $value) { throw "$Prompt : a value is required" }
  return $value
}

# $MakeValue runs only when the parameter is missing, so nothing is generated or asked for needlessly.
function Set-Secret([string]$Name, [scriptblock]$MakeValue) {
  # get-parameters (plural) reports a missing name in InvalidParameters instead of failing.
  $found = aws ssm get-parameters --names $Name --query 'Parameters[].Name' --output text
  if ($LASTEXITCODE -ne 0) { throw 'aws ssm failed. Logged in? Run: aws sso login --profile nus' }
  if ($found) { Write-Host "keep    $Name"; return }

  $value = & $MakeValue
  aws ssm put-parameter --name $Name --type SecureString --value $value | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "put-parameter failed for $Name" }
  Write-Host "created $Name"
}

$rds = terraform -chdir="$demo" output -raw rds_address
if (-not $rds) { throw 'Could not read terraform outputs. Has demo/ been applied?' }

# node-postgres (user/credit/order): encrypted, CA not checked (Node does not ship the RDS CA).
# postgres.js (supplier): sslmode=require means the same there.
Set-Secret '/foc/user-service/DATABASE_URL'     { "postgres://users:$(New-Secret)@${rds}:5432/users_db?sslmode=no-verify" }
Set-Secret '/foc/supplier-service/DATABASE_URL' { "postgres://suppliers:$(New-Secret)@${rds}:5432/suppliers_db?sslmode=require" }
Set-Secret '/foc/credit-service/DATABASE_URL'   { "postgres://credits:$(New-Secret)@${rds}:5432/credits_db?sslmode=no-verify" }
Set-Secret '/foc/order-service/DATABASE_URL'    { "postgres://orders:$(New-Secret)@${rds}:5432/orders_db?sslmode=no-verify" }
Set-Secret '/foc/faq-service/DATABASE_URL'      { "postgres://faq:$(New-Secret)@${rds}:5432/faq_db?sslmode=no-verify" }
Set-Secret '/foc/keycloak/KC_DB_PASSWORD'       { New-Secret }

# RabbitMQ container (Service Connect name rabbitmq:5672): user "foc", one password in two parameters.
# Plain AMQP: the traffic never leaves the private subnets.
$haveUrl = [bool](aws ssm get-parameters --names '/foc/shared/AMQP_URL' --query 'Parameters[].Name' --output text)
$havePass = [bool](aws ssm get-parameters --names '/foc/rabbitmq/RABBITMQ_DEFAULT_PASS' --query 'Parameters[].Name' --output text)
if ($haveUrl -ne $havePass) { throw 'Only one of /foc/shared/AMQP_URL and /foc/rabbitmq/RABBITMQ_DEFAULT_PASS exists. Delete it and re-run.' }
$mqPassword = New-Secret
Set-Secret '/foc/rabbitmq/RABBITMQ_DEFAULT_PASS' { $mqPassword }
Set-Secret '/foc/shared/AMQP_URL'                { "amqp://foc:${mqPassword}@rabbitmq:5672" }
Set-Secret '/foc/shared/INTERNAL_AUTH_SECRET'    { New-Secret }

# Keycloak. The client secret is shared by the realm import and user-service, like in .env.
Set-Secret '/foc/keycloak/KC_USER_SERVICE_CLIENT_SECRET' { New-Secret }
Set-Secret '/foc/keycloak/KC_BOOTSTRAP_ADMIN_USERNAME'   { 'kc-admin' }
Set-Secret '/foc/keycloak/KC_BOOTSTRAP_ADMIN_PASSWORD'   { New-Secret }
# Gmail SMTP login. Google shows the app password as 4 groups of 4; the spaces are removed here.
Set-Secret '/foc/keycloak/SMTP_USER'     { Read-Required 'Gmail address Keycloak sends from (same as email_from_address)' }
Set-Secret '/foc/keycloak/SMTP_PASSWORD' { (Read-Required 'Gmail app password (16 letters)' -Hidden) -replace '\s', '' }

# FAQ RAG service (F28). The model API keys are entered by whoever runs the script —
# never generated, never printed.
Set-Secret '/foc/faq-service/GEMINI_API_KEY'     { Read-Required 'Gemini API key (aistudio.google.com/apikey)' -Hidden }
Set-Secret '/foc/faq-service/OPENROUTER_API_KEY' { Read-Required 'OpenRouter API key (openrouter.ai/keys)' -Hidden }

# First two FoC admins (F29.3), created by user-service on its first start.
Set-Secret '/foc/user-service/BOOTSTRAP_ADMIN_EMAIL'         { Read-Required 'First FoC admin email (@u.nus.edu)' }
Set-Secret '/foc/user-service/BOOTSTRAP_ADMIN_USERNAME'      { 'admin' }
Set-Secret '/foc/user-service/BOOTSTRAP_ADMIN_TEMP_PASSWORD' { Read-Required 'Its temporary password (8+ chars, upper, lower, digit)' -Hidden }
Set-Secret '/foc/user-service/BOOTSTRAP_ADMIN_2_EMAIL'         { Read-Required 'Second FoC admin email (@u.nus.edu)' }
Set-Secret '/foc/user-service/BOOTSTRAP_ADMIN_2_USERNAME'      { 'admin2' }
Set-Secret '/foc/user-service/BOOTSTRAP_ADMIN_2_TEMP_PASSWORD' { Read-Required 'Its temporary password (8+ chars, upper, lower, digit)' -Hidden }

Write-Host ''
Write-Host 'Done. Check (names only, no values):  aws ssm get-parameters-by-path --path /foc --recursive --query "Parameters[].Name"'
