-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 5.1 Users & Auth
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    username        TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL DEFAULT '',
    bio             TEXT NOT NULL DEFAULT '',
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user',
    avatar_object_id UUID,
    wallet_balance_cents BIGINT NOT NULL DEFAULT 0,
    storage_used_bytes   BIGINT NOT NULL DEFAULT 0,
    storage_quota_bytes  BIGINT NOT NULL DEFAULT 1073741824,
    upload_limit_bytes   BIGINT NOT NULL DEFAULT 52428800,
    membership_plan_id   UUID,
    membership_ends_at   TIMESTAMPTZ,
    is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  TEXT NOT NULL,
    user_agent          TEXT NOT NULL DEFAULT '',
    ip_address          TEXT NOT NULL DEFAULT '',
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

-- ============================================================
-- 5.2 Social
-- ============================================================
CREATE TABLE posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    visibility      TEXT NOT NULL DEFAULT 'public',
    status          TEXT NOT NULL DEFAULT 'published',
    repost_of_id    UUID REFERENCES posts(id),
    like_count      INT NOT NULL DEFAULT 0,
    comment_count   INT NOT NULL DEFAULT 0,
    repost_count    INT NOT NULL DEFAULT 0,
    search_vector   TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_posts_author ON posts(author_id, created_at DESC);
CREATE INDEX idx_posts_created ON posts(created_at DESC) WHERE status = 'published';
CREATE INDEX idx_posts_search ON posts USING GIN(search_vector);

CREATE TABLE comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   UUID REFERENCES comments(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_post ON comments(post_id, created_at);

CREATE TABLE reactions (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

CREATE TABLE reposts (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

CREATE TABLE follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_follows_followee ON follows(followee_id);

CREATE TABLE topics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    post_count  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE post_topics (
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    topic_id    UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, topic_id)
);

CREATE TABLE trending_scores (
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    score_24h   DOUBLE PRECISION NOT NULL DEFAULT 0,
    score_7d    DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id)
);

CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type     TEXT NOT NULL,
    target_id       UUID NOT NULL,
    reason          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    resolved_by     UUID REFERENCES users(id),
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_status ON reports(status, created_at DESC);

-- ============================================================
-- 5.3 Storage & Drive
-- ============================================================
CREATE TABLE storage_policies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    type                TEXT NOT NULL DEFAULT 'local',
    is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,
    endpoint            TEXT NOT NULL DEFAULT '',
    bucket              TEXT NOT NULL DEFAULT '',
    region              TEXT NOT NULL DEFAULT '',
    access_key          TEXT NOT NULL DEFAULT '',
    secret_key          TEXT NOT NULL DEFAULT '',
    local_path          TEXT NOT NULL DEFAULT '/data/storage',
    dir_naming_rule     TEXT NOT NULL DEFAULT '{uid}/{date}',
    file_naming_rule    TEXT NOT NULL DEFAULT '{random}{ext}',
    max_file_size_bytes BIGINT NOT NULL DEFAULT 52428800,
    allowed_mime_types  TEXT NOT NULL DEFAULT '*',
    is_private          BOOLEAN NOT NULL DEFAULT TRUE,
    proxy_download      BOOLEAN NOT NULL DEFAULT FALSE,
    base_url            TEXT NOT NULL DEFAULT '',
    url_expire_seconds  INT NOT NULL DEFAULT 3600,
    settings            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE objects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    policy_id       UUID NOT NULL REFERENCES storage_policies(id),
    object_key      TEXT NOT NULL,
    sha256          TEXT NOT NULL,
    mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active',
    preview_status  TEXT NOT NULL DEFAULT 'none',
    preview_object_key TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_objects_sha256_policy ON objects(sha256, policy_id);

CREATE TABLE drive_nodes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   UUID REFERENCES drive_nodes(id) ON DELETE CASCADE,
    object_id   UUID REFERENCES objects(id),
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    size_bytes  BIGINT NOT NULL DEFAULT 0,
    mime_type   TEXT NOT NULL DEFAULT '',
    is_trashed  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_drive_nodes_user_parent ON drive_nodes(user_id, parent_id);
CREATE INDEX idx_drive_nodes_trashed ON drive_nodes(user_id, is_trashed);

CREATE TABLE post_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    object_id       UUID NOT NULL REFERENCES objects(id),
    drive_node_id   UUID REFERENCES drive_nodes(id),
    name            TEXT NOT NULL,
    mime_type       TEXT NOT NULL DEFAULT '',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_post_attachments_post ON post_attachments(post_id, sort_order);

CREATE TABLE share_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drive_node_id   UUID NOT NULL REFERENCES drive_nodes(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,
    password_hash   TEXT,
    expires_at      TIMESTAMPTZ,
    download_count  INT NOT NULL DEFAULT 0,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_share_links_token ON share_links(token);

-- ============================================================
-- 5.4 Billing & Membership
-- ============================================================
CREATE TABLE membership_plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    slug                TEXT NOT NULL UNIQUE,
    price_cents         BIGINT NOT NULL,
    duration_days       INT NOT NULL,
    storage_policy_id   UUID REFERENCES storage_policies(id),
    storage_quota_bytes BIGINT NOT NULL,
    upload_limit_bytes  BIGINT NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order          INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id     UUID NOT NULL REFERENCES membership_plans(id),
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at     TIMESTAMPTZ NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'wallet',
    source_id   TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memberships_user ON memberships(user_id, ends_at DESC);

CREATE TABLE wallet_ledgers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    amount_cents    BIGINT NOT NULL,
    balance_after   BIGINT NOT NULL,
    reference_type  TEXT NOT NULL DEFAULT '',
    reference_id    TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wallet_ledgers_user ON wallet_ledgers(user_id, created_at DESC);

CREATE TABLE redeem_batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    amount_cents    BIGINT NOT NULL,
    total_count     INT NOT NULL,
    redeemed_count  INT NOT NULL DEFAULT 0,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE redeem_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id    UUID NOT NULL REFERENCES redeem_batches(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    amount_cents BIGINT NOT NULL,
    redeemed_by UUID REFERENCES users(id),
    redeemed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_redeem_codes_code ON redeem_codes(code);

-- ============================================================
-- 5.5 Notifications & System
-- ============================================================
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    post_id     UUID REFERENCES posts(id) ON DELETE CASCADE,
    message     TEXT NOT NULL DEFAULT '',
    payload     JSONB,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

CREATE TABLE system_settings (
    key             TEXT PRIMARY KEY,
    value_encrypted TEXT NOT NULL,
    is_secret       BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID NOT NULL REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id   TEXT NOT NULL DEFAULT '',
    payload     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- ============================================================
-- Deferred foreign keys (users -> objects, users -> membership_plans)
-- ============================================================
ALTER TABLE users ADD CONSTRAINT fk_users_avatar FOREIGN KEY (avatar_object_id) REFERENCES objects(id);
ALTER TABLE users ADD CONSTRAINT fk_users_membership_plan FOREIGN KEY (membership_plan_id) REFERENCES membership_plans(id);

-- ============================================================
-- Additional useful indexes
-- ============================================================
CREATE INDEX idx_users_username_trgm ON users USING GIN(username gin_trgm_ops);
CREATE INDEX idx_users_display_name_trgm ON users USING GIN(display_name gin_trgm_ops);

-- Insert default local storage policy
INSERT INTO storage_policies (name, type, is_enabled, is_default, local_path)
VALUES ('本地存储', 'local', TRUE, TRUE, '/data/storage');

-- +goose Down
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_avatar;
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_membership_plan;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS redeem_codes;
DROP TABLE IF EXISTS redeem_batches;
DROP TABLE IF EXISTS wallet_ledgers;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS membership_plans;
DROP TABLE IF EXISTS share_links;
DROP TABLE IF EXISTS post_attachments;
DROP TABLE IF EXISTS drive_nodes;
DROP TABLE IF EXISTS objects;
DROP TABLE IF EXISTS storage_policies;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS trending_scores;
DROP TABLE IF EXISTS post_topics;
DROP TABLE IF EXISTS topics;
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS reposts;
DROP TABLE IF EXISTS reactions;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS pgcrypto;
