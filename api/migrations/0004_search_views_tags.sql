-- +goose Up

-- ============================================================
-- 1. Post view counts
-- ----------------------------------------------------------------
-- Track view counts on posts and use a small log table to dedupe
-- repeated views from the same viewer within a 24-hour window. The
-- worker periodically prunes rows older than 24h.
-- ============================================================
ALTER TABLE posts ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS post_views (
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    viewer_key TEXT NOT NULL,
    viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, viewer_key)
);
CREATE INDEX IF NOT EXISTS idx_post_views_viewed_at ON post_views(viewed_at);

-- ============================================================
-- 2. Topic metadata + user follows
-- ----------------------------------------------------------------
-- Topics already exist (slug/title/post_count). Add a cover image
-- and a follower count, plus a join table tracking which users
-- follow which topics.
-- ============================================================
ALTER TABLE topics ADD COLUMN IF NOT EXISTS cover_url TEXT NOT NULL DEFAULT '';
ALTER TABLE topics ADD COLUMN IF NOT EXISTS follower_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_topic_follows (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id   UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_user_topic_follows_user ON user_topic_follows(user_id);

-- ============================================================
-- 3. Hot search board
-- ----------------------------------------------------------------
-- Manageable hot search list. The worker recomputes auto rows on
-- a schedule from topic activity, while admins can pin/hide/insert
-- manual entries that survive recomputes.
-- ============================================================
CREATE TABLE IF NOT EXISTS hot_searches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword     TEXT NOT NULL,
    link_type   TEXT NOT NULL DEFAULT 'topic',
    link_value  TEXT NOT NULL DEFAULT '',
    score       DOUBLE PRECISION NOT NULL DEFAULT 0,
    pinned_rank INT,
    hidden      BOOLEAN NOT NULL DEFAULT FALSE,
    source      TEXT NOT NULL DEFAULT 'auto',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hot_searches_active
    ON hot_searches(hidden, pinned_rank, score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_searches_auto_link
    ON hot_searches(link_type, link_value) WHERE source = 'auto';

-- +goose Down
DROP TABLE IF EXISTS hot_searches;
DROP TABLE IF EXISTS user_topic_follows;
ALTER TABLE topics DROP COLUMN IF EXISTS follower_count;
ALTER TABLE topics DROP COLUMN IF EXISTS cover_url;
DROP TABLE IF EXISTS post_views;
ALTER TABLE posts DROP COLUMN IF EXISTS view_count;
