# Phase 1 & 2 — Build the 5 microservices and run them in Docker

> **Where:** your Windows desktop (Docker Desktop).  **Cost:** ₹0.
> **Goal of this phase:** the whole system runs locally with one command and
> passes an end-to-end smoke test. Everything later (Jenkins, Kubernetes, canary)
> builds on exactly these images, so it is worth understanding them well.

---

## Step 1 — Install the tools (Windows)

Open **PowerShell** and run:

```powershell
winget install --id Git.Git -e            # Git + "Git Bash" (we use it to run .sh scripts)
winget install --id OpenJS.NodeJS.LTS -e  # Node.js 24 LTS (to run unit tests locally)
winget install --id Microsoft.VisualStudioCode -e
```

Close and reopen PowerShell, then verify:

```powershell
git --version          # 2.4x+
node -v                # v24.x
npm -v
docker version         # both Client AND Server sections must show (Docker Desktop running)
docker compose version # v2.x
```

**Why each tool**

| Tool | Why |
|---|---|
| Git | Version control; Jenkins will pull from GitHub in Phase 4 |
| Node.js | Run unit tests locally *before* pushing (fast feedback, no CI wait) |
| Docker Desktop | Build images, run Postgres + all services together |
| Git Bash | Our scripts are bash, because Jenkins/Kubernetes are Linux. Git Bash lets you run them on Windows unchanged |

**Docker Desktop settings** (Settings → Resources): make sure the WSL 2 backend is
on. 32 GB RAM is plenty; Docker will use what it needs.

> ⚠️ **Windows gotcha:** in PowerShell 5, `curl` is an alias for `Invoke-WebRequest`.
> Use `curl.exe` in PowerShell, or just use Git Bash where `curl` is real curl.

---

## Step 2 — Put the code in place

Unzip `shopflow.zip` to a short path **outside OneDrive**, e.g. `C:\projects\shopflow`.

**Why not OneDrive/Desktop?** OneDrive sync locks files while Docker reads them
and `node_modules` (thousands of files) makes it crawl.

Open it in VS Code: `code C:\projects\shopflow`

### The structure, and why it looks like this

```
shopflow/
├── services/
│   ├── user-service/
│   │   ├── src/
│   │   │   ├── server.js        ← entry point: reads env vars, wires real DB, starts HTTP
│   │   │   ├── app.js           ← builds the Express app from injected dependencies
│   │   │   ├── routes.js        ← HTTP layer: validation + status codes
│   │   │   ├── repository.js    ← the ONLY file with SQL
│   │   │   └── lib/             ← shared library (identical in all 5 services)
│   │   ├── db/migration/        ← Flyway SQL files: V1__..., V2__...
│   │   ├── test/                ← unit tests (no database needed)
│   │   ├── Dockerfile
│   │   ├── package.json / package-lock.json
│   │   └── .dockerignore
│   ├── product-service/  order-service/  payment-service/  notification-service/
├── infra/postgres/init-db.sh    ← creates 5 databases + 5 users (first start only)
├── scripts/smoke-test.sh        ← end-to-end test of the whole system
├── docker-compose.yml
├── .env.example                 ← template; real .env is git-ignored
├── .gitignore / .gitattributes
└── docs/
```

**Why is `lib/` copied into every service instead of shared?**
Each service must build *independently*: its own Docker build context, its own
pipeline, its own release. A shared folder outside the service would couple all
five builds together. Real companies publish shared code as a versioned npm
package. For 8 small files, copying is the honest, simple choice.

**Why `server.js` and `app.js` are separate:** `app.js` receives everything it
needs (DB, repository, other-service clients) as parameters. This is *dependency
injection*. Tests pass fakes; `server.js` passes the real Postgres pool. That's
why 79 tests run in about 2 seconds without any database.

---

## Step 3 — Understand what each service does

### user-service (`/users`)
| Request | Result |
|---|---|
| `POST /users {name, email}` | 201 · 400 invalid · **409 duplicate email** |
| `GET /users/:id` | 200 · 404 |
| `GET /users?limit=&offset=` | list (max 100 per page) |

*Design point:* duplicate emails are rejected by the **database** (`UNIQUE`
constraint → Postgres error `23505` → HTTP 409), not by "SELECT first, then INSERT".
Two simultaneous sign-ups would both pass a SELECT check.

### product-service (`/products`)
| Request | Result |
|---|---|
| `GET /products`, `GET /products/:id`, `POST /products` | catalog |
| `POST /products/:id/reserve {quantity}` | 200 · **409 insufficient stock** · 404 |
| `POST /products/:id/release {quantity}` | puts stock back (used for compensation) |

*Design points:*
- **Money is an integer in paise** (`price_paise: 349900` = ₹3,499.00). Floats can't
  represent money exactly (`0.1 + 0.2 ≠ 0.3`).
- **Atomic reservation:** one SQL statement,
  `UPDATE … SET stock = stock - $2 WHERE id = $1 AND stock >= $2`.
  Postgres locks the row, so it is **impossible to oversell**. We tested it: 15
  parallel orders for the last 10 monitors → exactly 10 succeeded, 5 got 409, and stock ended at 0.
- `CHECK (stock >= 0)` in the table = a safety net even if code has a bug.

### payment-service (`/payments`) ⭐ our canary target
| Request | Result |
|---|---|
| `POST /payments {order_id, user_id, amount_paise}` | 201 `SUCCESS`/`FAILED` · **200 if already paid (idempotent)** |
| `GET /payments/:id`, `GET /payments?order_id=` | lookups |

*Design points:*
- **Idempotency:** `UNIQUE(order_id)`. If order-service retries after a timeout,
  the customer is **never charged twice**. The second call returns the first payment.
- A declined payment is **`201` with `status: FAILED`**, *not* a 5xx. A decline is a
  normal business outcome; 5xx means "our code is broken". This distinction is
  exactly what the canary analysis in Phase 9 measures separately.
- After success, it calls notification-service **best-effort**. If notifications
  are down, the payment still succeeds and only a warning is logged.
- **Chaos knobs** (env vars, default off) for the final demo:

  | Env var | Effect | Breaks which SLO (diagram box ⑧) |
  |---|---|---|
  | `CHAOS_LATENCY_MS=800` | adds delay | P95 ≤ 500 ms |
  | `CHAOS_ERROR_RATE=0.2` | 20% HTTP 500 | 5xx ≤ 1% |
  | `CHAOS_DECLINE_RATE=0.1` | 10% declined | payment failures ≤ 0.5% |

### notification-service (`/notifications`)
Stores a "sent" notification (simulated email/SMS). `GET /notifications?user_id=`
shows a customer's receipts.

### order-service (`/orders`): the orchestrator, using the **Saga pattern**

```
POST /orders {user_id, product_id, quantity}
 1. GET  user-service    /users/:id             → 422 if user doesn't exist
 2. GET  product-service /products/:id          → price (422 if missing)
 3. POST product-service /products/:id/reserve  → 409 if out of stock
 4. INSERT order (PENDING) in orders_db
 5. POST payment-service /payments
 6a. SUCCESS → order PAID                       → 201
 6b. FAILED  → release stock (COMPENSATION)     → 402 declined / 502 error / 503 down
             → order PAYMENT_FAILED
```

**Why a saga?** In a monolith, steps 3–6 would be one database transaction. With
**database-per-service** there's no transaction across databases, so if step 5
fails we must *actively undo* step 3. We tested it: a payment version that
declines everything → order `PAYMENT_FAILED`, stock back to exactly where it was.

### What all 5 services have in common (`src/lib/`)

| File | What it does | Why it matters later |
|---|---|---|
| `health.js` | `/health/live` (process alive) and `/health/ready` (DB reachable, not shutting down) | K8s liveness/readiness probes (Phase 5). **Liveness does NOT check the DB**, otherwise a DB blip restarts every pod |
| `metrics.js` | `http_requests_total`, `http_request_duration_seconds` (by route *template*, status), plus default CPU/memory | Prometheus + Argo Rollouts analysis (Phases 6, 9) |
| `server.js` | **Graceful shutdown**: on SIGTERM → readiness 503 → wait `SHUTDOWN_DELAY_MS` → finish requests → close DB | Without this, every rollout drops requests → 5xx spike → false rollback |
| `logger.js` | JSON logs with `service` + `version` on every line | Filter logs by canary version |
| `errors.js` | Consistent JSON errors; hides internal error messages on 500 | Security + consistent API |
| `http-client.js` | Service-to-service calls with a **3 s timeout** | One slow service must not hang the whole chain |
| `validate.js` | Input validation → 400 | Bad input must be a 400, not a DB crash (500) that pollutes canary metrics |

Every response carries **`X-App-Version`**. During the canary you'll literally see
90% of responses say `1.0.0` and 10% say `1.1.0`.

---

## Step 4 — Run the unit tests

In PowerShell or Git Bash:

```bash
cd C:/projects/shopflow/services/order-service
npm ci
npm test
```

- **`npm ci` vs `npm install`:** `ci` installs the *exact* versions in
  `package-lock.json` and fails if the lock file is out of date. The result is reproducible:
  your laptop, Jenkins and the Docker build all get identical dependencies.
- **`npm test`** uses Node's built-in test runner (no Jest needed) and writes
  `coverage/lcov.info`. **SonarCloud reads that file** in Phase 4 for the coverage gate.

Expected: `pass 20, fail 0` for order-service. Repeat for the other services
(15 / 14 / 17 / 13 tests). Each test file describes in plain words what it checks.

> Open `services/order-service/test/routes.test.js` and read the
> "declined payment → compensation" test. It's the saga, tested with fakes.

---

## Step 5 — Create your `.env` (secrets)

```powershell
cd C:\projects\shopflow
Copy-Item .env.example .env
notepad .env          # change every "change-me-…" password
```

**Why:** your repo is **public**. Passwords live only in `.env`, which
`.gitignore` excludes. Compose reads it automatically. Later, Jenkins credentials
and Kubernetes Secrets play the same role.

---

## Step 6 — Start everything

```powershell
docker compose up -d --build
```

What happens, in order (enforced by `depends_on` conditions in the compose file):

1. **Build 5 images.** Each Dockerfile is *multi-stage*:
   - `deps` stage: copies only `package.json` + lock → `npm ci --omit=dev`.
     Because this layer only changes when dependencies change, **rebuilds after a
     code change take seconds**.
   - `runtime` stage: a clean `node:24-alpine` + node_modules + `src/`. No tests,
     no npm cache, no devDependencies → smaller image, fewer CVEs for Trivy.
   - Runs as the **non-root `node` user**.
   - `CMD ["node", "src/server.js"]`, not `npm start`, because npm doesn't pass SIGTERM
     to the app, which would break graceful shutdown.
2. **postgres** starts. On the *first* start with an empty volume, it runs
   `infra/postgres/init-db.sh`, which creates 5 databases and 5 users. Each user
   owns one DB, and `REVOKE ALL … FROM PUBLIC` stops users connecting to other databases.
   One server, five isolated databases.
3. Postgres reports **healthy** (`pg_isready`).
4. **5 Flyway containers** (`*-migrate`) run the SQL files in `db/migration/` in
   version order, record them in a `flyway_schema_history` table, and **exit 0**.
5. Services start only after their migration succeeded (`service_completed_successfully`).
   order-service waits for the other services to be **healthy**.

Check:

```powershell
docker compose ps -a
```

Expected:
- `postgres`, the 5 services and `web-ui` → `Up … (healthy)` (7 in total)
- the 5 `*-migrate` containers → `Exited (0)`. **That's correct**: they're one-shot jobs.

---

## Step 7 — Run the end-to-end smoke test

Open **Git Bash** in the project folder:

```bash
./scripts/smoke-test.sh
```

It checks health, creates a user, places an order across all services, verifies
the stock went down, the payment succeeded and a receipt was stored, checks the error paths
(409, 422) and that the metrics are exposed. You should end with
**🎉 SMOKE TEST PASSED**.

**Why we need it:** unit tests prove each piece works alone. The smoke test proves they
work *together* (networking, DB users, migrations, env vars). Jenkins will run
this same script against staging before anything is allowed into EKS.

---

## Step 8 — Use the shop in your browser

Open **http://localhost:3000**.

- **Shopping as**: pick a customer, or create one with **New customer**
- **Buy**: places an order through all five services; a receipt prints on the right
- **Your orders / Messages we sent you**: what order-service and notification-service stored
- **Services** (bottom): every service's health and version, refreshed every 5 s

### How web-ui works: the BFF pattern
The browser never calls the 5 services directly. It calls `web-ui` at `/api/...`,
and web-ui calls the services for it (**B**ackend **F**or **F**rontend).

```
Browser ──► web-ui :3000 ──/api/orders──► order-service ──► user / product / payment ──► notification
```

Why:
- **Security:** in Kubernetes only web-ui is exposed through the Ingress. The 5 APIs
  stay private inside the cluster.
- **No CORS problems:** the page and its API share one origin.
- **Least exposure:** web-ui forwards only the fields the UI needs (try sending
  `{"admin": true}` with an order; it's dropped).
- The page is plain HTML/CSS/JS with **no build step**, so its pipeline is identical to
  the other services: `npm ci → npm test → docker build`.

**Watch a failure in the UI:** set `CHAOS_DECLINE_RATE=1` in `.env`, run
`docker compose up -d payment-service`, buy something, and watch a *PAYMENT FAILED*
receipt print. The stock bar doesn't go down, because the saga released it. Set it back to `0` afterwards.

---

## Step 9 — Explore the APIs directly (spend 20 minutes here, it pays off later)

Git Bash:

```bash
# See the version header (you'll watch this split 90/10 during the canary)
curl -i http://localhost:3004/health/live

# Place an order
curl -s -X POST http://localhost:3003/orders -H 'content-type: application/json' \
     -d '{"user_id":1,"product_id":1,"quantity":1}'

# Raw Prometheus metrics — find http_requests_total and payments_total
curl -s http://localhost:3004/metrics | grep -E "^(http_requests_total|payments_total)"

# Structured JSON logs
docker compose logs -f order-service
```

**Look inside the database** with DBeaver or pgAdmin: host `localhost`, port `5432`,
user `orders_svc`, database `orders_db`, password from `.env`.
- Open the `flyway_schema_history` table and see which migrations ran.
- Try connecting as `orders_svc` to `payments_db`. It's **refused**. That's database-per-service, enforced.

### Experiment A — watch the saga compensate
In `.env` set `CHAOS_DECLINE_RATE=1`, then:
```bash
docker compose up -d payment-service      # recreates only that container with the new env
curl -s localhost:3002/products/1 | grep -o '"stock":[0-9]*'
curl -s -X POST localhost:3003/orders -H 'content-type: application/json' -d '{"user_id":1,"product_id":1,"quantity":3}'
curl -s localhost:3002/products/1 | grep -o '"stock":[0-9]*'   # unchanged → stock was released
docker compose logs order-service | grep compensation
```
Set it back to `0` afterwards and run `docker compose up -d payment-service` again.

### Experiment B — a dependency goes down
```bash
docker compose stop payment-service
curl -s -w '\nHTTP %{http_code}\n' -X POST localhost:3003/orders -H 'content-type: application/json' -d '{"user_id":1,"product_id":2}'
# → 503, order PAYMENT_FAILED, stock released. Nothing hangs (3 s timeout).
docker compose start payment-service
```

### Experiment C — graceful shutdown
```bash
docker compose stop user-service && docker compose logs user-service | tail -3
# → "shutdown started" … "shutdown complete"
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `port is already allocated` on 5432 | A Windows-installed Postgres is running. Stop it, or change `"5432:5432"` to `"5433:5432"` |
| `/bin/bash^M: bad interpreter` | CRLF line endings. `.gitattributes` prevents this for git clones; for the zip, open the file in VS Code → bottom-right "CRLF" → switch to "LF" → save |
| Changed a DB password but login fails | `init-db.sh` runs only on an **empty** volume. `docker compose down -v` (⚠ deletes data) then `up` again |
| A `*-migrate` container exited 1 | `docker compose logs product-migrate`. Usually a SQL error or a wrong password |
| Service stuck "unhealthy" | `docker compose logs <service>`. Usually a DB connection error |
| `smoke-test.sh: Permission denied` | `bash scripts/smoke-test.sh` |

Stop everything: `docker compose down` (keeps data) or `docker compose down -v` (wipes data).

---

## ✅ Phase 1–2 checkpoint

- [ ] All 5 services: `npm test` passes
- [ ] `docker compose ps -a`: 7 healthy, 5 migrations `Exited (0)`
- [ ] http://localhost:3000 shows the shop and you placed an order from the browser
- [ ] `./scripts/smoke-test.sh` → SMOKE TEST PASSED
- [ ] You saw compensation happen (Experiment A)
- [ ] You can explain: database-per-service, saga, idempotency, liveness vs readiness, why graceful shutdown matters for canaries

**Next: Phase 3.** Create the GitHub repo, push this code, and set up the branching
strategy (`main`, `develop`, `feature/*`, `hotfix/*`) with branch protection.
