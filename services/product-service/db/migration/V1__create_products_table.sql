CREATE TABLE products (
    id           SERIAL PRIMARY KEY,
    sku          VARCHAR(50)  NOT NULL UNIQUE,
    name         VARCHAR(200) NOT NULL,
    price_paise  INTEGER      NOT NULL CHECK (price_paise > 0),
    -- CHECK constraint = last line of defence: stock can never go negative,
    -- even if application code has a bug.
    stock        INTEGER      NOT NULL DEFAULT 0 CHECK (stock >= 0),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
