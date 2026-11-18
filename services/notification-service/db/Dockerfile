# Migration image: Flyway + THIS service's SQL files, versioned and tagged
# together with the app image (user-service:1.2.0 <-> user-service-migrations:1.2.0).
# Kubernetes runs it as a Helm hook Job before each install/upgrade.
FROM flyway/flyway:11
COPY migration /flyway/sql
