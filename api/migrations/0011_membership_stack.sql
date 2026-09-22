-- +goose Up
-- Stackable memberships with priority consumption.
--
-- Each membership row now carries `duration_days` (granted at purchase) and
-- `consumed_days` (incremented daily by the worker, in tier order). The
-- user's effective state (`users.membership_plan_id`, `membership_ends_at`)
-- is recomputed from the highest-tier row with remaining days.
ALTER TABLE memberships
    ADD COLUMN IF NOT EXISTS duration_days INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS consumed_days INT NOT NULL DEFAULT 0;

-- Backfill: derive duration_days / consumed_days from the legacy started_at
-- and ends_at columns. ceil() so a partial day still counts.
UPDATE memberships
SET duration_days = GREATEST(0, CEIL(EXTRACT(EPOCH FROM (ends_at - started_at)) / 86400.0)::int),
    consumed_days = GREATEST(0, LEAST(
        CEIL(EXTRACT(EPOCH FROM (now() - started_at)) / 86400.0)::int,
        CEIL(EXTRACT(EPOCH FROM (ends_at - started_at)) / 86400.0)::int
    ))
WHERE duration_days = 0;

CREATE INDEX IF NOT EXISTS idx_memberships_user_active
    ON memberships(user_id)
    WHERE consumed_days < duration_days;

-- +goose Down
DROP INDEX IF EXISTS idx_memberships_user_active;
ALTER TABLE memberships
    DROP COLUMN IF EXISTS duration_days,
    DROP COLUMN IF EXISTS consumed_days;
