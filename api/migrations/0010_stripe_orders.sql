-- +goose Up
-- Stripe orders: tracks Stripe Checkout Sessions for wallet recharge and
-- direct membership purchases. The webhook handler updates `status` after
-- payment_intent.succeeded; idempotency is enforced via the unique session_id.
CREATE TABLE stripe_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id      TEXT NOT NULL UNIQUE,
    payment_intent  TEXT NOT NULL DEFAULT '',
    kind            TEXT NOT NULL,                       -- 'recharge' | 'membership'
    plan_id         UUID REFERENCES membership_plans(id),
    amount_cents    BIGINT NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'usd',
    status          TEXT NOT NULL DEFAULT 'pending',     -- pending | paid | failed | canceled
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stripe_orders_user ON stripe_orders(user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS stripe_orders;
