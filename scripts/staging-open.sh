#!/usr/bin/env bash
# Open the staging shop at http://localhost:8088 (Ctrl+C to stop).
set -euo pipefail
CONTEXT=${KUBE_CONTEXT:-docker-desktop}
echo "🛒 http://localhost:8088   (Ctrl+C to stop)"
kubectl --context "$CONTEXT" -n shopflow port-forward svc/web-ui 8088:8080
