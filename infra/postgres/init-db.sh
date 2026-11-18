#!/bin/bash
# ---------------------------------------------------------------------------
# Runs ONCE, the first time the Postgres container starts with an empty volume
# (anything in /docker-entrypoint-initdb.d/ is executed by the official image).
#
# Creates one DATABASE + one LOGIN USER per microservice. Each user OWNS only
# its own database, and CONNECT is revoked from everyone else, so e.g.
# order-service physically cannot read payments_db. That is database-per-service
# enforced by Postgres, while we still pay for only ONE server.
#
# NOTE: to re-run this script, delete the volume:  docker compose down -v
# ---------------------------------------------------------------------------
set -euo pipefail

create_service_db() {
  local db="$1" user="$2" password="$3"
  echo "Creating database '$db' owned by '$user'"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
       -v db="$db" -v usr="$user" -v pwd="$password" <<'EOSQL'
CREATE ROLE :"usr" WITH LOGIN PASSWORD :'pwd';
CREATE DATABASE :"db" OWNER :"usr";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
EOSQL
}

create_service_db users_db         users_svc         "$USERS_DB_PASSWORD"
create_service_db products_db      products_svc      "$PRODUCTS_DB_PASSWORD"
create_service_db orders_db        orders_svc        "$ORDERS_DB_PASSWORD"
create_service_db payments_db      payments_svc      "$PAYMENTS_DB_PASSWORD"
create_service_db notifications_db notifications_svc "$NOTIFICATIONS_DB_PASSWORD"
