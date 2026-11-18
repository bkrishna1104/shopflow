-- user_id / product_id / payment_id reference data in OTHER services' databases,
-- so they are plain integers (no foreign keys across service boundaries).
CREATE TABLE orders (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER      NOT NULL,
    product_id   INTEGER      NOT NULL,
    quantity     INTEGER      NOT NULL CHECK (quantity > 0),
    total_paise  INTEGER      NOT NULL CHECK (total_paise > 0),
    status       VARCHAR(30)  NOT NULL CHECK (status IN ('PENDING', 'PAID', 'PAYMENT_FAILED')),
    payment_id   INTEGER,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user_id ON orders (user_id);
