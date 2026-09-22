-- +goose Up

-- Allow admins to ban topics (hidden from discovery) without hard-deleting them.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down

ALTER TABLE topics DROP COLUMN IF EXISTS is_banned;
