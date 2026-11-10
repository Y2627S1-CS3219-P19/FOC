#!/usr/bin/env bash
# Routing test for gateway/nginx.conf (run by pr.yml). `nginx -t` only proves the config loads; this
# proves every public path reaches the RIGHT service and internal paths stay blocked.
# Each upstream is a stub (the gateway image itself, with its config replaced) that answers
# "<its name> <the path it received>".
#
#   docker build -t foc-ci/gateway gateway && bash gateway/test/routes.sh foc-ci/gateway
#
# Added a new upstream to nginx.conf? Add it to UPSTREAMS, or the gateway will not start here.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: do not rewrite /paths in docker arguments

IMAGE=${1:-foc-ci/gateway}
NET=foc-gw-test
PORT=${GATEWAY_TEST_PORT:-18080}
UPSTREAMS="user-service:3001 supplier-service:3002 credit-service:3003 order-service:3004 faq-service:3005 frontend:80"

containers() { echo gwtest-gateway; for u in $UPSTREAMS; do echo "gwtest-${u%%:*}"; done; }
cleanup() {
  docker rm -f $(containers) >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker network create "$NET" >/dev/null

for u in $UPSTREAMS; do
  name=${u%%:*} port=${u##*:}
  docker run -d --name "gwtest-$name" --network "$NET" --network-alias "$name" \
    -e NAME="$name" -e LISTEN="$port" "$IMAGE" sh -c '
      printf "server { listen %s; location / { default_type text/plain; return 200 \"%s \$request_uri\"; } }\n" \
        "$LISTEN" "$NAME" > /etc/nginx/conf.d/default.conf
      exec nginx -g "daemon off;"' >/dev/null
done

docker run -d --name gwtest-gateway --network "$NET" -p "127.0.0.1:$PORT:80" "$IMAGE" >/dev/null

for i in $(seq 1 30); do
  if [ "$(curl -s --max-time 2 "http://127.0.0.1:$PORT/healthz" || true)" = ok ]; then break; fi
  if [ "$i" = 30 ] || [ "$(docker inspect -f '{{.State.Running}}' gwtest-gateway)" != true ]; then
    echo "Gateway did not start. Its log:"; docker logs gwtest-gateway; exit 1
  fi
  sleep 1
done

fail=0
# check <path> <status> [<exact body>]   (no body = only the status is checked)
check() {
  local path=$1 want_code=$2 want_body=${3-} out code body
  out=$(curl -s --path-as-is --max-time 5 -w '\n%{http_code}' "http://127.0.0.1:$PORT$path")
  code=${out##*$'\n'} body=${out%$'\n'*}
  if [ "$code" = "$want_code" ] && { [ -z "$want_body" ] || [ "$body" = "$want_body" ]; }; then
    echo "OK   $path -> $code ${want_body:+$body}"
  else
    echo "FAIL $path: got $code '${body:0:80}', want $want_code '${want_body}'"
    fail=1
  fi
}

check /healthz                         200 "ok"
check /                                200 "frontend /"
check /orders/new                      200 "frontend /orders/new"

check /v1/auth/register                200 "user-service /v1/auth/register"
check /v1/me                           200 "user-service /v1/me"
check /v1/admin/users                  200 "user-service /v1/admin/users"

check /v1/suppliers                    200 "supplier-service /v1/suppliers"
check "/v1/suppliers?open_now=true"    200 "supplier-service /v1/suppliers?open_now=true"
check /v1/supplier-images/a.jpeg       200 "supplier-service /v1/supplier-images/a.jpeg"

check /v1/credits/me                   200 "credit-service /v1/credits/me"
check /v1/admin/credits/adjust         200 "credit-service /v1/admin/credits/adjust"

check /v1/orders                       200 "order-service /v1/orders"
check /v1/orders/abc/accept            200 "order-service /v1/orders/abc/accept"
check /v1/admin/orders                 200 "order-service /v1/admin/orders"

check /v1/faq/ask                      200 "faq-service /v1/faq/ask"

# Service-to-service routes never leave the gateway, however the path is written (F6.4).
check /v1/internal/users/x             404
check /v1//internal/users/x            404
check /v1/orders/../internal/users/x   404
check /v1/%69nternal/users/x           404

if [ "$fail" != 0 ]; then echo "Gateway log:"; docker logs gwtest-gateway 2>&1 | tail -30; fi
exit "$fail"
