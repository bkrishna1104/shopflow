#!/usr/bin/env bash
# Remove ShopFlow staging (the 'shopflow' namespace only). The cluster stays.
set -euo pipefail
CONTEXT=${KUBE_CONTEXT:-docker-desktop}
for svc in web-ui order-service payment-service notification-service product-service user-service; do
  helm uninstall "$svc" --kube-context "$CONTEXT" -n shopflow 2>/dev/null || true
done
kubectl --context "$CONTEXT" delete namespace shopflow --ignore-not-found
