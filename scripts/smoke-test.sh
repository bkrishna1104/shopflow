#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# End-to-end smoke test: proves all 5 services + databases work TOGETHER.
# Run on Windows from Git Bash or WSL:   ./scripts/smoke-test.sh
# Later Jenkins runs the same script against staging before promoting to EKS.
#
# Override URLs for other environments, e.g.
#   BASE_ORDER=http://staging.local/orders ./scripts/smoke-test.sh
# ---------------------------------------------------------------------------
set -euo pipefail

USER_URL=${USER_URL:-http://localhost:3001}
PRODUCT_URL=${PRODUCT_URL:-http://localhost:3002}
ORDER_URL=${ORDER_URL:-http://localhost:3003}
PAYMENT_URL=${PAYMENT_URL:-http://localhost:3004}
NOTIFICATION_URL=${NOTIFICATION_URL:-http://localhost:3005}

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; exit 1; }
json_field() { grep -o "\"$1\":[^,}]*" | head -1 | cut -d: -f2- | tr -d '"'; }

echo "1) Health checks"
for url in "$USER_URL" "$PRODUCT_URL" "$ORDER_URL" "$PAYMENT_URL" "$NOTIFICATION_URL"; do
  curl -fsS "$url/health/ready" >/dev/null && pass "$url ready" || fail "$url not ready"
done

echo "2) Create a customer (user-service)"
EMAIL="smoke-$(date +%s)-$RANDOM@example.com"
USER_JSON=$(curl -fsS -X POST "$USER_URL/users" -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\"}")
USER_ID=$(echo "$USER_JSON" | json_field id)
[ -n "$USER_ID" ] && pass "user id=$USER_ID" || fail "no user id"

echo "3) Check product stock before (product-service)"
STOCK_BEFORE=$(curl -fsS "$PRODUCT_URL/products/2" | json_field stock)
pass "product 2 stock=$STOCK_BEFORE"

echo "4) Place an order (order -> user, product, payment -> notification)"
ORDER_JSON=$(curl -sS -X POST "$ORDER_URL/orders" -H 'content-type: application/json' \
  -d "{\"user_id\":$USER_ID,\"product_id\":2,\"quantity\":2}")
ORDER_ID=$(echo "$ORDER_JSON" | json_field id)
ORDER_STATUS=$(echo "$ORDER_JSON" | json_field status)
echo "     $ORDER_JSON"
[ "$ORDER_STATUS" = "PAID" ] && pass "order $ORDER_ID is PAID" || fail "order status=$ORDER_STATUS"

echo "5) Verify side effects in every service"
STOCK_AFTER=$(curl -fsS "$PRODUCT_URL/products/2" | json_field stock)
[ "$STOCK_AFTER" -eq $((STOCK_BEFORE - 2)) ] && pass "stock $STOCK_BEFORE -> $STOCK_AFTER" || fail "stock is $STOCK_AFTER"
PAY_STATUS=$(curl -fsS "$PAYMENT_URL/payments?order_id=$ORDER_ID" | json_field status)
[ "$PAY_STATUS" = "SUCCESS" ] && pass "payment SUCCESS" || fail "payment status=$PAY_STATUS"
curl -fsS "$NOTIFICATION_URL/notifications?user_id=$USER_ID" | grep -q PAYMENT_RECEIPT \
  && pass "receipt notification stored" || fail "no notification"

echo "6) Error paths"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ORDER_URL/orders" -H 'content-type: application/json' \
  -d "{\"user_id\":$USER_ID,\"product_id\":2,\"quantity\":999999}")
[ "$CODE" = "409" ] && pass "out of stock -> 409" || fail "expected 409, got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ORDER_URL/orders" -H 'content-type: application/json' \
  -d '{"user_id":999999,"product_id":2}')
[ "$CODE" = "422" ] && pass "unknown user -> 422" || fail "expected 422, got $CODE"

echo "7) Metrics exposed for Prometheus"
curl -fsS "$PAYMENT_URL/metrics" | grep -q 'payments_total{status="SUCCESS"' && pass "payments_total present" || fail "metric missing"

echo "8) Web UI (BFF) serves the page and reaches every service"
WEB_URL=${WEB_URL:-http://localhost:3000}
curl -fsS "$WEB_URL/" | grep -q "ShopFlow" && pass "shop page served" || fail "web-ui page missing"
STATUS_JSON=$(curl -fsS "$WEB_URL/api/status")
echo "$STATUS_JSON" | grep -q '"ok":false' && fail "a service is down: $STATUS_JSON" || pass "all 6 services report ok"

echo ""
echo "🎉 SMOKE TEST PASSED"
