# ShopFlow — Microservices with Progressive Delivery (Canary) & Automated Rollback

A learning project that takes 5 small Node.js microservices (plus a web UI) from code all the way
to **canary releases with automatic rollback on Kubernetes (EKS, later AKS)**.

```
Customer ──POST /orders──► order-service ──► user-service          (users_db)
                              │         └──► product-service       (products_db)
                              │         └──► payment-service ──► notification-service
                              ▼                 (payments_db)        (notifications_db)
                          orders_db
```

| Service | Host port (compose) | Database | Purpose |
|---|---|---|---|
| user-service | 3001 | users_db | Customers |
| product-service | 3002 | products_db | Catalog + atomic stock reservation |
| order-service | 3003 | orders_db | Orchestrates the order **saga** |
| payment-service | 3004 | payments_db | Idempotent payments + **chaos knobs** for canary demos |
| notification-service | 3005 | notifications_db | Simulated email/SMS receipts |
| **web-ui** | **3000** | — | Shop page + BFF API (`/api/*`). **Open http://localhost:3000** |

Every service exposes: `/health/live`, `/health/ready`, `/metrics` and returns an `X-App-Version` header.

## Quick start (Docker Desktop)

```bash
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
docker compose up -d --build
docker compose ps               # wait until services are "healthy"
./scripts/smoke-test.sh         # Git Bash / WSL
```

## Run unit tests

```bash
cd services/order-service
npm ci
npm test                        # also writes coverage/lcov.info for SonarCloud
```

## Project roadmap

| Phase | Topic | Status |
|---|---|---|
| 1 | 5 microservices + database per service + Flyway | ✅ |
| 2 | Docker images + Docker Compose | ✅ |
| 3 | GitHub repo + branching strategy | ⏭️ next |
| 4 | Jenkins (Proxmox) + SonarCloud + Trivy | |
| 5 | kind staging cluster + Helm + probes + HPA | |
| 6 | Argo Rollouts canary + Prometheus (staging) | |
| 7 | AWS ECR + EKS | |
| 8 | Pipeline: staging → EKS production | |
| 9 | Automated analysis, auto-rollback, alerting | |
| 10 | Expand → Migrate → Contract DB migration | |
| 11 | Final demo: bad release rolls back automatically | |

Step-by-step guide with the *why* behind every decision: [`docs/01-phase-1-2-microservices-and-docker.md`](docs/01-phase-1-2-microservices-and-docker.md)
