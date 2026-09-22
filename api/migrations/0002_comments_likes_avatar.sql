-- +goose Up

-- ============================================================
-- 1. Add like_count to comments
-- ============================================================
ALTER TABLE comments ADD COLUMN IF NOT EXISTS like_count INT NOT NULL DEFAULT 0;

-- ============================================================
-- 2. Comment reactions (likes on comments)
-- ============================================================
CREATE TABLE IF NOT EXISTS comment_reactions (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id);

-- ============================================================
-- 3. Add avatar_data_url to users (base64-encoded image)
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data_url TEXT NOT NULL DEFAULT '';

-- ============================================================
-- 4. Comment attachments (similar to post_attachments)
-- ============================================================
CREATE TABLE IF NOT EXISTS comment_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id      UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    object_id       UUID NOT NULL REFERENCES objects(id),
    drive_node_id   UUID REFERENCES drive_nodes(id),
    name            TEXT NOT NULL,
    mime_type       TEXT NOT NULL DEFAULT '',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comment_attachments_comment ON comment_attachments(comment_id, sort_order);

-- +goose Down
DROP TABLE IF EXISTS comment_attachments;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_data_url;
DROP TABLE IF EXISTS comment_reactions;
ALTER TABLE comments DROP COLUMN IF EXISTS like_count;
