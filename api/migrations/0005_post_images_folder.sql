-- +goose Up

-- ============================================================
-- 1. drive_nodes.is_system flag
-- ----------------------------------------------------------------
-- Marks system-managed drive nodes that the user cannot rename, move,
-- copy, share, or delete. Currently only used for the per-user
-- "帖子图片" folder that holds inline post/comment images.
-- ============================================================
ALTER TABLE drive_nodes
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

-- One system folder per user. Partial unique index keeps regular
-- folders unconstrained while ensuring we never end up with two
-- system folders for the same user (which would make the "ensure"
-- logic ambiguous).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_drive_nodes_user_system
    ON drive_nodes (user_id)
    WHERE is_system = TRUE AND is_trashed = FALSE;

-- ============================================================
-- 2. Backfill: create the "帖子图片" system folder for every
-- existing user that doesn't already have one.
-- ============================================================
INSERT INTO drive_nodes (user_id, parent_id, kind, name, is_system)
SELECT u.id, NULL, 'folder', '帖子图片', TRUE
FROM users u
WHERE NOT EXISTS (
    SELECT 1
    FROM drive_nodes dn
    WHERE dn.user_id = u.id
      AND dn.is_system = TRUE
      AND dn.is_trashed = FALSE
);

-- +goose Down

DROP INDEX IF EXISTS uniq_drive_nodes_user_system;
ALTER TABLE drive_nodes DROP COLUMN IF EXISTS is_system;
