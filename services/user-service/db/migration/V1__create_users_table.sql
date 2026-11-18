-- Flyway migration V1. Flyway runs files in version order exactly once and records
-- them in the flyway_schema_history table. NEVER edit a migration after it has run;
-- add a new V2, V3... instead (Flyway checksums would fail otherwise).
CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    email       VARCHAR(320) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
