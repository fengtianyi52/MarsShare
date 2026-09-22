-- +goose Up
-- Recycle bin + admin file management groundwork.
--
-- 1) Let share_links survive their source drive_node being hard-deleted, so
--    public viewers can be shown a "文件已被删除" state instead of a generic
--    404. drive_node_id becomes nullable and the cascade is replaced with
--    SET NULL.
-- 2) Record when a node entered the trash so the recycle bin UI can sort by
--    deletion time and a future worker can auto-purge old entries.

-- 1. share_links FK -------------------------------------------------
ALTER TABLE share_links DROP CONSTRAINT IF EXISTS share_links_drive_node_id_fkey;
ALTER TABLE share_links ALTER COLUMN drive_node_id DROP NOT NULL;
ALTER TABLE share_links
    ADD CONSTRAINT share_links_drive_node_id_fkey
    FOREIGN KEY (drive_node_id) REFERENCES drive_nodes(id) ON DELETE SET NULL;

-- 2. drive_nodes.trashed_at ------------------------------------------
ALTER TABLE drive_nodes ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;

-- Backfill: any row already in the trash gets its updated_at as a best
-- approximation of the deletion timestamp.
UPDATE drive_nodes SET trashed_at = updated_at
WHERE is_trashed = TRUE AND trashed_at IS NULL;

-- Partial index to speed up the trash listing query.
CREATE INDEX IF NOT EXISTS idx_drive_nodes_trashed_at
    ON drive_nodes(user_id, trashed_at)
    WHERE is_trashed = TRUE;

-- 3. Backfill users.storage_used_bytes -------------------------------
-- The previous TrashDriveNode never decremented storage_used_bytes, so
-- already-trashed files have been counting against the quota all along.
-- Going forward, trash decrements and restore re-increments — to keep
-- semantics consistent, subtract every existing trashed file's size from
-- the owner's used counter once. System-folder files are excluded from
-- the quota and so are skipped here.
WITH trashed_totals AS (
    SELECT user_id, COALESCE(SUM(size_bytes), 0) AS bytes
    FROM drive_nodes
    WHERE is_trashed = TRUE
      AND kind = 'file'
      AND is_system = FALSE
    GROUP BY user_id
)
UPDATE users u
SET storage_used_bytes = GREATEST(u.storage_used_bytes - t.bytes, 0)
FROM trashed_totals t
WHERE u.id = t.user_id;

-- Note: objects.status is already TEXT and accepts new values without a
-- schema change. Admin hard-delete writes 'deleted' to mark a globally
-- removed file while leaving the row alive (post_attachments.object_id is
-- NOT NULL FK and must keep a valid target).

-- +goose Down
DROP INDEX IF EXISTS idx_drive_nodes_trashed_at;
ALTER TABLE drive_nodes DROP COLUMN IF EXISTS trashed_at;

-- Restoring CASCADE requires there to be no NULL drive_node_id rows. The
-- caller must clean those up before rolling back.
ALTER TABLE share_links DROP CONSTRAINT IF EXISTS share_links_drive_node_id_fkey;
ALTER TABLE share_links ALTER COLUMN drive_node_id SET NOT NULL;
ALTER TABLE share_links
    ADD CONSTRAINT share_links_drive_node_id_fkey
    FOREIGN KEY (drive_node_id) REFERENCES drive_nodes(id) ON DELETE CASCADE;
