-- +goose Up
-- Two related fixes for the recycle-bin / purge flow:
--
-- 1. post_attachments.drive_node_id and comment_attachments.drive_node_id
--    were declared with no ON DELETE action, so a DELETE on the source
--    drive_node row was blocked by FK violation — purge from the recycle
--    bin returned "failed to purge node". Switch both to ON DELETE SET NULL
--    so the cascade from a purged drive_node simply nulls the back-pointer.
--
-- 2. Once drive_node_id is nulled, the rendering layer can no longer tell
--    "this attachment never had a drive_node" (fresh upload) from "the
--    drive_node was purged after the fact". Add a `source_deleted` boolean
--    that the trash/restore code maintains explicitly. The post-rendering
--    layer treats source_deleted = TRUE as 已删除.

-- ── post_attachments ───────────────────────────────────────────────
ALTER TABLE post_attachments DROP CONSTRAINT IF EXISTS post_attachments_drive_node_id_fkey;
ALTER TABLE post_attachments
    ADD CONSTRAINT post_attachments_drive_node_id_fkey
    FOREIGN KEY (drive_node_id) REFERENCES drive_nodes(id) ON DELETE SET NULL;

ALTER TABLE post_attachments
    ADD COLUMN IF NOT EXISTS source_deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: any attachment whose source drive_node is currently trashed
-- should be marked deleted, so existing trashed-but-not-yet-purged content
-- starts displaying the 已删除 badge after the migration runs.
UPDATE post_attachments pa
SET source_deleted = TRUE
WHERE pa.drive_node_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM drive_nodes dn
      WHERE dn.id = pa.drive_node_id AND dn.is_trashed = TRUE
  );

-- ── comment_attachments ────────────────────────────────────────────
ALTER TABLE comment_attachments DROP CONSTRAINT IF EXISTS comment_attachments_drive_node_id_fkey;
ALTER TABLE comment_attachments
    ADD CONSTRAINT comment_attachments_drive_node_id_fkey
    FOREIGN KEY (drive_node_id) REFERENCES drive_nodes(id) ON DELETE SET NULL;

ALTER TABLE comment_attachments
    ADD COLUMN IF NOT EXISTS source_deleted BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE comment_attachments ca
SET source_deleted = TRUE
WHERE ca.drive_node_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM drive_nodes dn
      WHERE dn.id = ca.drive_node_id AND dn.is_trashed = TRUE
  );

-- +goose Down
ALTER TABLE comment_attachments DROP COLUMN IF EXISTS source_deleted;
ALTER TABLE comment_attachments DROP CONSTRAINT IF EXISTS comment_attachments_drive_node_id_fkey;
ALTER TABLE comment_attachments
    ADD CONSTRAINT comment_attachments_drive_node_id_fkey
    FOREIGN KEY (drive_node_id) REFERENCES drive_nodes(id);

ALTER TABLE post_attachments DROP COLUMN IF EXISTS source_deleted;
ALTER TABLE post_attachments DROP CONSTRAINT IF EXISTS post_attachments_drive_node_id_fkey;
ALTER TABLE post_attachments
    ADD CONSTRAINT post_attachments_drive_node_id_fkey
    FOREIGN KEY (drive_node_id) REFERENCES drive_nodes(id);
