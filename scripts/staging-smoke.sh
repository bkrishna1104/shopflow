#!/usr/bin/env bash
# Run scripts/smoke-test.sh against STAGING through temporary port-forward tunnels.
set -euo pipefail
export MSYS_NO_PATHCONV=1
CONTEXT=${KUBE_CONTEXT:-docker-desktop}
NS=shopflow
declare -A PORTS=([web-ui]=13000 [user-service]=13001 [product-service]=13002 [order-service]=13003 [payment-service]=13004 [notification-service]=13005)
PIDS=()
cleanup() { kill "${PIDS[@]}" 2>/dev/null || true; }
trap cleanup EXIT
for svc in "${!PORTS[@]}"; do
  kubectl --context "$CONTEXT" -n "$NS" port-forward "svc/$svc" "${PORTS[$svc]}:8080" >/dev/null 2>&1 &
  PIDS+=($!)
done
sleep 3
WEB_URL=http://localhost:13000 USER_URL=http://localhost:13001 PRODUCT_URL=http://localhost:13002 \
ORDER_URL=http://localhost:13003 PAYMENT_URL=http://localhost:13004 NOTIFICATION_URL=http://localhost:13005 \
  bash scripts/smoke-test.sh
