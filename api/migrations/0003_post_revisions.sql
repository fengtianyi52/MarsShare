-- +goose Up

-- ============================================================
-- 1. Track when a post was last edited by its author/admin
-- ============================================================
ALTER TABLE posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- ============================================================
-- 2. Post edit history
-- ----------------------------------------------------------------
-- Each row stores a snapshot of the post *before* an edit, plus
-- who made the edit and when. Attachments are stored as JSON so we
-- don't need a separate child table — they're rarely queried.
-- ============================================================
CREATE TABLE IF NOT EXISTS post_revisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    editor_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    visibility      TEXT NOT NULL DEFAULT 'public',
    -- Snapshot of post_attachments at the moment of the edit. Each item:
    --   { "object_id", "drive_node_id", "name", "mime_type", "size_bytes" }
    attachments     JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_post_revisions_post ON post_revisions(post_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS post_revisions;
ALTER TABLE posts DROP COLUMN IF EXISTS edited_at;
