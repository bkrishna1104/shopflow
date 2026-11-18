CREATE TABLE payments (
    id              SERIAL PRIMARY KEY,
    -- UNIQUE(order_id) is our idempotency guarantee: one payment per order, enforced
    -- by the database even if two requests arrive at the same millisecond.
    order_id        INTEGER      NOT NULL UNIQUE,
    user_id         INTEGER      NOT NULL,
    amount_paise    INTEGER      NOT NULL CHECK (amount_paise > 0),
    status          VARCHAR(20)  NOT NULL CHECK (status IN ('SUCCESS', 'FAILED')),
    failure_reason  VARCHAR(200),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
