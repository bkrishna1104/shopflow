#!/usr/bin/env bash
# Deploy / update STAGING on Docker Desktop Kubernetes (kind mode, cluster "desktop").
# Safe to re-run. Usage:
#   ./scripts/staging-up.sh                                  build current commit + deploy
#   SKIP_BUILD=1 TAG=local-abc1234 ./scripts/staging-up.sh   redeploy already-loaded images
set -euo pipefail
export MSYS_NO_PATHCONV=1      # stop Git Bash rewriting "/paths" into Windows paths

# ALWAYS name the target cluster explicitly. Once EKS is in your kubeconfig
# (Phase 7), relying on the "current context" is how people deploy to prod by accident.
CONTEXT=${KUBE_CONTEXT:-docker-desktop}
KIND_CLUSTER=${KIND_CLUSTER:-desktop}
NS=shopflow
TAG=${TAG:-local-$(git rev-parse --short=7 HEAD)}
APP_SERVICES=(user-service product-service notification-service payment-service order-service web-ui)
DB_SERVICES=(user-service product-service notification-service payment-service order-service)

k()    { kubectl --context "$CONTEXT" "$@"; }
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "0. Pre-flight checks"
for tool in docker kind kubectl helm; do
  command -v "$tool" >/dev/null || { echo "❌ '$tool' not found (winget install it)"; exit 1; }
done
[ -f .env ] || { echo "❌ .env not found in $(pwd) — run from the repo root"; exit 1; }
set -a; . ./.env; set +a
kind get clusters | grep -qx "$KIND_CLUSTER" || { echo "❌ kind cluster '$KIND_CLUSTER' not found"; exit 1; }
echo "Target: context=$CONTEXT  namespace=$NS  image tag=$TAG"

step "1. Cluster"
k get nodes

step "2. metrics-server (needed by HPA autoscaling and 'kubectl top')"
if k -n kube-system get deploy metrics-server >/dev/null 2>&1; then
  echo "already installed"
else
  k apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml >/dev/null
fi
if ! k -n kube-system get deploy metrics-server -o jsonpath='{.spec.template.spec.containers[0].args}' | grep -q kubelet-insecure-tls; then
  k -n kube-system patch deployment metrics-server --type=json \
    -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
fi

step "3. Namespace '$NS' + secrets (from .env, never stored in Git)"
k create namespace "$NS" --dry-run=client -o yaml | k apply -f -
k -n "$NS" create secret generic postgres-passwords \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=USERS_DB_PASSWORD="$USERS_DB_PASSWORD" \
  --from-literal=PRODUCTS_DB_PASSWORD="$PRODUCTS_DB_PASSWORD" \
  --from-literal=ORDERS_DB_PASSWORD="$ORDERS_DB_PASSWORD" \
  --from-literal=PAYMENTS_DB_PASSWORD="$PAYMENTS_DB_PASSWORD" \
  --from-literal=NOTIFICATIONS_DB_PASSWORD="$NOTIFICATIONS_DB_PASSWORD" \
  --dry-run=client -o yaml | k apply -f -
declare -A DB_PASS=(
  [user-service]="$USERS_DB_PASSWORD"       [product-service]="$PRODUCTS_DB_PASSWORD"
  [order-service]="$ORDERS_DB_PASSWORD"     [payment-service]="$PAYMENTS_DB_PASSWORD"
  [notification-service]="$NOTIFICATIONS_DB_PASSWORD"
)
for svc in "${DB_SERVICES[@]}"; do
  k -n "$NS" create secret generic "$svc-db" --from-literal=DB_PASSWORD="${DB_PASS[$svc]}" \
    --dry-run=client -o yaml | k apply -f -
done

step "4. PostgreSQL (5 databases)"
k -n "$NS" create configmap postgres-init-script --from-file=init-db.sh=infra/postgres/init-db.sh \
  --dry-run=client -o yaml | k apply -f -
k -n "$NS" apply -f k8s/staging/postgres.yaml
k -n "$NS" rollout status statefulset/postgres --timeout=180s

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  step "5. Build images ($TAG)"
  for svc in "${APP_SERVICES[@]}"; do
    docker build -q --build-arg APP_VERSION="$TAG" -t "shopflow/$svc:$TAG" "services/$svc"
  done
  for svc in "${DB_SERVICES[@]}"; do
    docker build -q -t "shopflow/$svc-migrations:$TAG" "services/$svc/db"
  done

  step "6. Load images into the cluster nodes (no registry needed)"
  IMAGES=()
  for svc in "${APP_SERVICES[@]}"; do IMAGES+=("shopflow/$svc:$TAG"); done
  for svc in "${DB_SERVICES[@]}"; do IMAGES+=("shopflow/$svc-migrations:$TAG"); done
  kind load docker-image --name "$KIND_CLUSTER" "${IMAGES[@]}"
fi

step "7. Helm releases (one per service: migrate -> roll out -> wait until ready)"
for svc in "${APP_SERVICES[@]}"; do
  echo "--- $svc"
  helm upgrade --install "$svc" helm/microservice \
    --kube-context "$CONTEXT" --namespace "$NS" \
    -f "helm/values/staging/$svc.yaml" \
    --set image.tag="$TAG" --set migrations.image.tag="$TAG" \
    --wait --timeout 5m
done

step "Done"
k -n "$NS" get pods -o wide
echo
echo "🛒 Open the shop:  ./scripts/staging-open.sh   → http://localhost:8088"
echo "🧪 Smoke test:     ./scripts/staging-smoke.sh"
