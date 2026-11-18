-- Note: user_id / order_id are plain integers, NOT foreign keys. Users and orders
-- live in OTHER databases (database-per-service), so Postgres cannot enforce the
-- relationship; the services enforce it through their APIs.
CREATE TABLE notifications (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL,
    order_id    INTEGER,
    channel     VARCHAR(20)  NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL', 'SMS')),
    type        VARCHAR(50)  NOT NULL,
    message     TEXT         NOT NULL,
    status      VARCHAR(20)  NOT NULL DEFAULT 'SENT',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- "GET /notifications?user_id=" filters on user_id -> index it.
CREATE INDEX idx_notifications_user_id ON notifications (user_id);
