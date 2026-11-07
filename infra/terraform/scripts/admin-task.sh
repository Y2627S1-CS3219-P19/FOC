#!/bin/sh
# Runs INSIDE the one-off foc-admin ECS task (postgres:16-alpine, private subnet), never on a laptop.
# Terraform copies this file and create-databases.sql into the task definition (demo/ecs.tf).
# Env: PG* (RDS master login), *_DATABASE_URL and KC_DB_PASSWORD (from SSM), SQL_B64.
# Idempotent: running it again only re-syncs passwords to the SSM values.
set -eu

# Password part of postgres://user:password@host... (put-secrets.ps1 makes hex passwords: no escaping).
password_of() { echo "$1" | sed -E 's#^[a-z]+://[^:]+:([^@]+)@.*#\1#'; }

echo "== Postgres: 6 users + 6 databases on $PGHOST"
echo "$SQL_B64" | base64 -d | tr -d '\r' > /tmp/create-databases.sql
psql -v ON_ERROR_STOP=1 \
  -v users_pw="$(password_of "$USERS_DATABASE_URL")" \
  -v suppliers_pw="$(password_of "$SUPPLIERS_DATABASE_URL")" \
  -v credits_pw="$(password_of "$CREDITS_DATABASE_URL")" \
  -v orders_pw="$(password_of "$ORDERS_DATABASE_URL")" \
  -v faq_pw="$(password_of "$FAQ_DATABASE_URL")" \
  -v keycloak_pw="$KC_DB_PASSWORD" \
  -f /tmp/create-databases.sql

echo "ALL DONE"
