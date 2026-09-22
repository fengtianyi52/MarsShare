package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/marsshare/api/internal/model"
)

// PostImagesFolderName is the display name of the per-user system folder
// that stores inline post/comment images. The folder is created on demand
// via EnsurePostImagesFolder and protected by ErrSystemNode-style guards.
const PostImagesFolderName = "帖子图片"

// ErrSystemNodeProtected is returned when the caller attempts to rename,
// move, copy, share or delete a node that is itself a system folder, or
// any file/folder living inside one. The HTTP layer maps it to 403.
var ErrSystemNodeProtected = errors.New("system folder is protected")

// ──────────────────────────────────────────────────────
// Drive tree
// ──────────────────────────────────────────────────────

// GetDriveTree returns all non-trashed drive nodes for a user, assembled as a tree.
func (s *Store) GetDriveTree(ctx context.Context, userID string) ([]model.DriveNode, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, parent_id, object_id, kind, name, size_bytes, mime_type, is_trashed, trashed_at, is_system, created_at, updated_at
		FROM drive_nodes
		WHERE user_id = $1 AND is_trashed = FALSE
		ORDER BY is_system DESC, kind DESC, created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	nodes := make([]model.DriveNode, 0)
	for rows.Next() {
		n, err := scanDriveNode(rows)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return buildDriveTree(nodes), nil
}

// EnsurePostImagesFolder returns the per-user system folder used to store
// inline post images, creating it if it does not yet exist. The function is
// idempotent and safe to call from any handler that needs the folder id.
func (s *Store) EnsurePostImagesFolder(ctx context.Context, userID string) (*model.DriveNode, error) {
	// Fast path: most calls will find an existing system folder.
	var n model.DriveNode
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, parent_id, object_id, kind, name, size_bytes, mime_type, is_trashed, trashed_at, is_system, created_at, updated_at
		FROM drive_nodes
		WHERE user_id = $1 AND is_system = TRUE AND is_trashed = FALSE
		LIMIT 1
	`, userID).Scan(
		&n.ID, &n.UserID, &n.ParentID, &n.ObjectID, &n.Kind, &n.Name,
		&n.SizeBytes, &n.MimeType, &n.IsTrashed, &n.TrashedAt, &n.IsSystem, &n.CreatedAt, &n.UpdatedAt,
	)
	if err == nil {
		return &n, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	// Slow path: insert the folder. The unique partial index defends against
	// races where two requests try to create the folder concurrently — the
	// loser will hit ON CONFLICT and re-fetch the existing row.
	err = s.pool.QueryRow(ctx, `
		INSERT INTO drive_nodes (user_id, parent_id, kind, name, is_system)
		VALUES ($1, NULL, 'folder', $2, TRUE)
		RETURNING id, user_id, parent_id, object_id, kind, name, size_bytes, mime_type, is_trashed, trashed_at, is_system, created_at, updated_at
	`, userID, PostImagesFolderName).Scan(
		&n.ID, &n.UserID, &n.ParentID, &n.ObjectID, &n.Kind, &n.Name,
		&n.SizeBytes, &n.MimeType, &n.IsTrashed, &n.TrashedAt, &n.IsSystem, &n.CreatedAt, &n.UpdatedAt,
	)
	if err == nil {
		return &n, nil
	}
	// Race lost — another caller inserted the folder. Re-read it.
	if strings.Contains(err.Error(), "uniq_drive_nodes_user_system") || strings.Contains(err.Error(), "duplicate key") {
		return s.EnsurePostImagesFolder(ctx, userID)
	}
	return nil, err
}

// IsNodeProtected reports whether the given node should be treated as
// system-protected (i.e. cannot be renamed/moved/copied/shared/deleted).
// A node is protected if it is itself a system node, OR if any ancestor up
// to the root is a system node. The walk is bounded to defend against
// pathological data.
func (s *Store) IsNodeProtected(ctx context.Context, nodeID, userID string) (bool, error) {
	cur := nodeID
	for i := 0; i < 1024; i++ {
		var (
			parent   sql.NullString
			isSystem bool
		)
		err := s.pool.QueryRow(ctx, `
			SELECT parent_id, is_system
			FROM drive_nodes
			WHERE id = $1 AND user_id = $2
		`, cur, userID).Scan(&parent, &isSystem)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return false, nil
			}
			return false, err
		}
		if isSystem {
			return true, nil
		}
		if !parent.Valid {
			return false, nil
		}
		cur = parent.String
	}
	return false, nil
}

// IsSystemFolder reports whether the given node id refers to a top-level
// system folder. Used by handlers that need to special-case writes targeting
// the system folder (e.g. uploadFile choosing whether to skip quota).
func (s *Store) IsSystemFolder(ctx context.Context, nodeID, userID string) (bool, error) {
	if nodeID == "" {
		return false, nil
	}
	var isSystem bool
	err := s.pool.QueryRow(ctx, `
		SELECT is_system FROM drive_nodes WHERE id = $1 AND user_id = $2
	`, nodeID, userID).Scan(&isSystem)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return isSystem, nil
}

// CreateFolder creates a folder node. Refuses to create a folder underneath
// a system-protected node (the user can't add subfolders to "帖子图片").
func (s *Store) CreateFolder(ctx context.Context, userID, name string, parentID *string) (*model.DriveNode, error) {
	if parentID != nil {
		protected, err := s.IsNodeProtected(ctx, *parentID, userID)
		if err != nil {
			return nil, err
		}
		if protected {
			return nil, ErrSystemNodeProtected
		}
	}
	var n model.DriveNode
	err := s.pool.QueryRow(ctx, `
		INSERT INTO drive_nodes (user_id, parent_id, kind, name)
		VALUES ($1, $2, 'folder', $3)
		RETURNING id, user_id, parent_id, object_id, kind, name, size_bytes, mime_type, is_trashed, trashed_at, is_system, created_at, updated_at
	`, userID, parentID, strings.TrimSpace(name)).Scan(
		&n.ID, &n.UserID, &n.ParentID, &n.ObjectID, &n.Kind, &n.Name,
		&n.SizeBytes, &n.MimeType, &n.IsTrashed, &n.TrashedAt, &n.IsSystem, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// CreateFileNode creates a file node linked to an object. This is the
// low-level primitive — handlers are responsible for deciding whether the
// caller is allowed to write underneath the chosen parent. The upload
// handler uses IsNodeProtected to gate user-driven uploads, and uses
// EnsurePostImagesFolder when the upload is on the post-image fast path.
func (s *Store) CreateFileNode(ctx context.Context, userID, name string, parentID *string, objectID string, sizeBytes int64, mimeType string) (*model.DriveNode, error) {
	var n model.DriveNode
	err := s.pool.QueryRow(ctx, `
		INSERT INTO drive_nodes (user_id, parent_id, object_id, kind, name, size_bytes, mime_type)
		VALUES ($1, $2, $3, 'file', $4, $5, $6)
		RETURNING id, user_id, parent_id, object_id, kind, name, size_bytes, mime_type, is_trashed, trashed_at, is_system, created_at, updated_at
	`, userID, parentID, objectID, strings.TrimSpace(name), sizeBytes, mimeType).Scan(
		&n.ID, &n.UserID, &n.ParentID, &n.ObjectID, &n.Kind, &n.Name,
		&n.SizeBytes, &n.MimeType, &n.IsTrashed, &n.TrashedAt, &n.IsSystem, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// UpdateDriveNode renames and/or moves a drive node.
//
// Deprecated: prefer RenameDriveNode / MoveDriveNode which can each express
// "do not change this field" cleanly. Kept for backwards compatibility — note
// that a nil parentID is interpreted as "do not change", NOT "move to root".
func (s *Store) UpdateDriveNode(ctx context.Context, nodeID, userID string, name *string, parentID *string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE drive_nodes
		SET name = COALESCE($3, name),
		    parent_id = COALESCE($4, parent_id),
		    updated_at = NOW()
		WHERE id = $1 AND user_id = $2
	`, nodeID, userID, name, parentID)
	return err
}

// RenameDriveNode renames a node. System-protected nodes (and anything
// inside them) cannot be renamed.
func (s *Store) RenameDriveNode(ctx context.Context, nodeID, userID, newName string) error {
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return fmt.Errorf("name cannot be empty")
	}
	protected, err := s.IsNodeProtected(ctx, nodeID, userID)
	if err != nil {
		return err
	}
	if protected {
		return ErrSystemNodeProtected
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE drive_nodes SET name = $3, updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND is_system = FALSE
	`, nodeID, userID, newName)
	return err
}

// MoveDriveNode moves a node into a new parent. A nil targetParentID means
// move to the root. For folders, it rejects moves into self or descendants.
// Refuses to move system nodes themselves, files inside system folders, or
// to move anything *into* a system folder.
func (s *Store) MoveDriveNode(ctx context.Context, nodeID, userID string, targetParentID *string) error {
	src, err := s.GetDriveNode(ctx, nodeID, userID)
	if err != nil {
		return err
	}
	srcProtected, err := s.IsNodeProtected(ctx, nodeID, userID)
	if err != nil {
		return err
	}
	if srcProtected {
		return ErrSystemNodeProtected
	}
	if targetParentID != nil {
		if *targetParentID == nodeID {
			return fmt.Errorf("cannot move a node into itself")
		}
		dstProtected, err := s.IsNodeProtected(ctx, *targetParentID, userID)
		if err != nil {
			return err
		}
		if dstProtected {
			return ErrSystemNodeProtected
		}
		if src.Kind == "folder" {
			isDesc, err := s.isDescendant(ctx, *targetParentID, nodeID, userID)
			if err != nil {
				return err
			}
			if isDesc {
				return fmt.Errorf("cannot move a folder into its descendant")
			}
		}
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE drive_nodes SET parent_id = $3, updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND is_system = FALSE
	`, nodeID, userID, targetParentID)
	return err
}

// ErrQuotaExceededOnRestore is returned by RestoreDriveNode when bringing
// the subtree back online would push the user over their storage quota.
// The HTTP layer maps it to 403 with a "storage_exceeded" code so the UI can
// show a helpful message.
var ErrQuotaExceededOnRestore = errors.New("restore would exceed storage quota")

// ErrNodeNotTrashed is returned by PurgeDriveNode when called on a node that
// is not currently in the recycle bin. The handler maps it to 400.
var ErrNodeNotTrashed = errors.New("node is not in trash")

// TrashDriveNode soft-deletes a drive node and recursively all its children,
// stamping trashed_at on every node so the recycle bin can sort by deletion
// time. The user's storage_used_bytes is decremented by the total size of
// the (previously non-trashed) file nodes in the subtree, so trashed files
// no longer count against the quota.
//
// System-protected nodes (and anything inside them) cannot be trashed.
func (s *Store) TrashDriveNode(ctx context.Context, nodeID, userID string) error {
	protected, err := s.IsNodeProtected(ctx, nodeID, userID)
	if err != nil {
		return err
	}
	if protected {
		return ErrSystemNodeProtected
	}

	return s.withTx(ctx, func(tx pgx.Tx) error {
		// Sum the bytes of every (non-trashed, non-system) file in the
		// subtree — only those bytes are currently consuming the user's
		// quota and need to be released.
		var bytesToFree int64
		err := tx.QueryRow(ctx, `
			WITH RECURSIVE subtree AS (
				SELECT id, kind, size_bytes, is_trashed, is_system
				FROM drive_nodes
				WHERE id = $1 AND user_id = $2
				UNION ALL
				SELECT dn.id, dn.kind, dn.size_bytes, dn.is_trashed, dn.is_system
				FROM drive_nodes dn
				JOIN subtree st ON dn.parent_id = st.id
				WHERE dn.user_id = $2
			)
			SELECT COALESCE(SUM(size_bytes), 0)
			FROM subtree
			WHERE kind = 'file' AND is_trashed = FALSE AND is_system = FALSE
		`, nodeID, userID).Scan(&bytesToFree)
		if err != nil {
			return err
		}

		// Mark the entire subtree as trashed in one statement. trashed_at
		// is only set on rows that weren't already trashed so we don't
		// reset the deletion timestamp of items the user trashed earlier.
		// We also propagate the deletion to any post/comment_attachments
		// that reference one of the now-trashed drive_nodes — the post
		// rendering layer reads pa.source_deleted to show a 已删除 badge.
		_, err = tx.Exec(ctx, `
			WITH RECURSIVE subtree AS (
				SELECT id FROM drive_nodes
				WHERE id = $1 AND user_id = $2 AND is_system = FALSE
				UNION ALL
				SELECT dn.id FROM drive_nodes dn
				JOIN subtree st ON dn.parent_id = st.id
				WHERE dn.user_id = $2 AND dn.is_system = FALSE
			), trashed AS (
				UPDATE drive_nodes
				SET is_trashed = TRUE,
				    trashed_at = COALESCE(trashed_at, NOW()),
				    updated_at = NOW()
				WHERE id IN (SELECT id FROM subtree)
				RETURNING id
			), pa_update AS (
				UPDATE post_attachments
				SET source_deleted = TRUE
				WHERE drive_node_id IN (SELECT id FROM trashed)
				RETURNING 1
			)
			UPDATE comment_attachments
			SET source_deleted = TRUE
			WHERE drive_node_id IN (SELECT id FROM trashed)
		`, nodeID, userID)
		if err != nil {
			return err
		}

		if bytesToFree > 0 {
			if _, err := tx.Exec(ctx, `
				UPDATE users
				SET storage_used_bytes = GREATEST(storage_used_bytes - $2, 0),
				    updated_at = NOW()
				WHERE id = $1
			`, userID, bytesToFree); err != nil {
				return err
			}
		}
		return nil
	})
}

// RestoreDriveNode restores a trashed drive node and its descendants. Each
// file in the subtree counts back against the user's quota — if doing so
// would exceed the quota the whole restore is aborted with
// ErrQuotaExceededOnRestore.
func (s *Store) RestoreDriveNode(ctx context.Context, nodeID, userID string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		var bytesToReclaim int64
		if err := tx.QueryRow(ctx, `
			WITH RECURSIVE subtree AS (
				SELECT id, kind, size_bytes, is_system
				FROM drive_nodes
				WHERE id = $1 AND user_id = $2 AND is_trashed = TRUE
				UNION ALL
				SELECT dn.id, dn.kind, dn.size_bytes, dn.is_system
				FROM drive_nodes dn
				JOIN subtree st ON dn.parent_id = st.id
				WHERE dn.user_id = $2 AND dn.is_trashed = TRUE
			)
			SELECT COALESCE(SUM(size_bytes), 0)
			FROM subtree
			WHERE kind = 'file' AND is_system = FALSE
		`, nodeID, userID).Scan(&bytesToReclaim); err != nil {
			return err
		}

		// Quota check before mutating anything.
		if bytesToReclaim > 0 {
			var used, quota int64
			if err := tx.QueryRow(ctx, `
				SELECT storage_used_bytes, storage_quota_bytes FROM users WHERE id = $1
			`, userID).Scan(&used, &quota); err != nil {
				return err
			}
			if used+bytesToReclaim > quota {
				return ErrQuotaExceededOnRestore
			}
		}

		if _, err := tx.Exec(ctx, `
			WITH RECURSIVE subtree AS (
				SELECT id FROM drive_nodes
				WHERE id = $1 AND user_id = $2 AND is_trashed = TRUE
				UNION ALL
				SELECT dn.id FROM drive_nodes dn
				JOIN subtree st ON dn.parent_id = st.id
				WHERE dn.user_id = $2 AND dn.is_trashed = TRUE
			), restored AS (
				UPDATE drive_nodes
				SET is_trashed = FALSE,
				    trashed_at = NULL,
				    updated_at = NOW()
				WHERE id IN (SELECT id FROM subtree)
				RETURNING id
			), pa_update AS (
				UPDATE post_attachments
				SET source_deleted = FALSE
				WHERE drive_node_id IN (SELECT id FROM restored)
				RETURNING 1
			)
			UPDATE comment_attachments
			SET source_deleted = FALSE
			WHERE drive_node_id IN (SELECT id FROM restored)
		`, nodeID, userID); err != nil {
			return err
		}

		if bytesToReclaim > 0 {
			if _, err := tx.Exec(ctx, `
				UPDATE users
				SET storage_used_bytes = storage_used_bytes + $2,
				    updated_at = NOW()
				WHERE id = $1
			`, userID, bytesToReclaim); err != nil {
				return err
			}
		}
		return nil
	})
}

// ListTrash returns the top-level trashed nodes for a user — entries whose
// parent is either NULL or itself not trashed. This avoids dumping every
// nested file when the user trashes a whole folder; the UI can lazy-load
// children if it ever needs them.
func (s *Store) ListTrash(ctx context.Context, userID string) ([]model.DriveNode, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, parent_id, object_id, kind, name, size_bytes, mime_type, is_trashed, trashed_at, is_system, created_at, updated_at
		FROM drive_nodes dn
		WHERE dn.user_id = $1 AND dn.is_trashed = TRUE
		  AND (
		    dn.parent_id IS NULL
		    OR NOT EXISTS (
		      SELECT 1 FROM drive_nodes p
		      WHERE p.id = dn.parent_id AND p.is_trashed = TRUE
		    )
		  )
		ORDER BY trashed_at DESC NULLS LAST, updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	nodes := make([]model.DriveNode, 0)
	for rows.Next() {
		n, err := scanDriveNode(rows)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

// PurgeDriveNode permanently removes a trashed drive_node subtree. The node
// must already be in the recycle bin (is_trashed = TRUE) — calling purge on
// a live node returns ErrNodeNotTrashed.
//
// Behaviour:
//   - All descendants are deleted via the parent_id ON DELETE CASCADE.
//   - share_links pointing at any deleted node have drive_node_id set NULL
//     (via the ON DELETE SET NULL added in migration 0012); the share row
//     survives so public viewers see "文件已被删除".
//   - Each unique object_id referenced in the subtree is checked: if no
//     drive_nodes still reference it AND no post_attachments reference it,
//     the object row is deleted and (policy_id, object_key) is returned for
//     storage cleanup. If post_attachments still reference it the object
//     row stays alive (the post needs the FK target).
//   - storage_used_bytes is NOT touched here — bytes were already released
//     when the node was first trashed.
//
// System-protected nodes cannot be purged.
func (s *Store) PurgeDriveNode(ctx context.Context, nodeID, userID string) ([]DeletedObjectInfo, error) {
	protected, err := s.IsNodeProtected(ctx, nodeID, userID)
	if err != nil {
		return nil, err
	}
	if protected {
		return nil, ErrSystemNodeProtected
	}

	var deleted []DeletedObjectInfo
	err = s.withTx(ctx, func(tx pgx.Tx) error {
		var trashed bool
		if err := tx.QueryRow(ctx, `
			SELECT is_trashed FROM drive_nodes WHERE id = $1 AND user_id = $2
		`, nodeID, userID).Scan(&trashed); err != nil {
			return maybeErrNoRows(err)
		}
		if !trashed {
			return ErrNodeNotTrashed
		}

		objs, err := purgeSubtreeTx(ctx, tx, nodeID, userID)
		if err != nil {
			return err
		}
		deleted = objs
		return nil
	})
	if err != nil {
		return nil, err
	}
	return deleted, nil
}

// EmptyTrash purges every trashed node owned by the user.
func (s *Store) EmptyTrash(ctx context.Context, userID string) ([]DeletedObjectInfo, error) {
	var deleted []DeletedObjectInfo
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		// Top-level trashed nodes only — purgeSubtreeTx handles cascade.
		rows, err := tx.Query(ctx, `
			SELECT id FROM drive_nodes dn
			WHERE dn.user_id = $1 AND dn.is_trashed = TRUE
			  AND (
			    dn.parent_id IS NULL
			    OR NOT EXISTS (
			      SELECT 1 FROM drive_nodes p
			      WHERE p.id = dn.parent_id AND p.is_trashed = TRUE
			    )
			  )
		`, userID)
		if err != nil {
			return err
		}
		var rootIDs []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			rootIDs = append(rootIDs, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		for _, id := range rootIDs {
			objs, err := purgeSubtreeTx(ctx, tx, id, userID)
			if err != nil {
				return err
			}
			deleted = append(deleted, objs...)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return deleted, nil
}

// purgeSubtreeTx is the shared inner loop for PurgeDriveNode / EmptyTrash.
// It runs inside a caller-supplied transaction.
func purgeSubtreeTx(ctx context.Context, tx pgx.Tx, rootID, userID string) ([]DeletedObjectInfo, error) {
	// Collect all node ids and their object_ids in the subtree.
	rows, err := tx.Query(ctx, `
		WITH RECURSIVE subtree AS (
			SELECT id, object_id FROM drive_nodes
			WHERE id = $1 AND user_id = $2
			UNION ALL
			SELECT dn.id, dn.object_id FROM drive_nodes dn
			JOIN subtree st ON dn.parent_id = st.id
			WHERE dn.user_id = $2
		)
		SELECT id, object_id FROM subtree
	`, rootID, userID)
	if err != nil {
		return nil, err
	}
	var nodeIDs []string
	objectIDSet := make(map[string]struct{})
	for rows.Next() {
		var id string
		var objID sql.NullString
		if err := rows.Scan(&id, &objID); err != nil {
			rows.Close()
			return nil, err
		}
		nodeIDs = append(nodeIDs, id)
		if objID.Valid {
			objectIDSet[objID.String] = struct{}{}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(nodeIDs) == 0 {
		return nil, nil
	}

	// Delete the root — descendants cascade via parent_id ON DELETE CASCADE.
	// share_links pointing at any of the deleted ids will have their
	// drive_node_id SET NULL by the migration-0012 FK action.
	if _, err := tx.Exec(ctx, `DELETE FROM drive_nodes WHERE id = $1 AND user_id = $2`, rootID, userID); err != nil {
		return nil, err
	}

	// For each object that was referenced by something in the subtree,
	// check whether any other table still needs it. We count every known
	// FK that targets objects(id) — drive_nodes, post_attachments,
	// comment_attachments and users.avatar_object_id — and only delete
	// the object row when all are zero. Missing one of these would cause
	// the DELETE to fail with a FK violation and abort the whole purge.
	var deleted []DeletedObjectInfo
	for objectID := range objectIDSet {
		var refs int
		if err := tx.QueryRow(ctx, `
			SELECT
			  (SELECT COUNT(*) FROM drive_nodes WHERE object_id = $1) +
			  (SELECT COUNT(*) FROM post_attachments WHERE object_id = $1) +
			  (SELECT COUNT(*) FROM comment_attachments WHERE object_id = $1) +
			  (SELECT COUNT(*) FROM users WHERE avatar_object_id = $1)
		`, objectID).Scan(&refs); err != nil {
			return nil, err
		}
		if refs > 0 {
			continue
		}

		var policyID, objectKey string
		if err := tx.QueryRow(ctx, `
			SELECT policy_id, object_key FROM objects WHERE id = $1
		`, objectID).Scan(&policyID, &objectKey); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return nil, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM objects WHERE id = $1`, objectID); err != nil {
			return nil, err
		}
		deleted = append(deleted, DeletedObjectInfo{PolicyID: policyID, ObjectKey: objectKey})
	}
	return deleted, nil
}

// CopyDriveNode copies a node into a new parent. For a file it just creates
// a new drive_nodes row pointing at the same object_id (storage is shared via
// the object — only the user's storage_used_bytes counter is incremented).
// For a folder it recursively copies the entire subtree depth-first.
//
// Returns the size in bytes that should be added to the user's storage usage,
// and the root copied node.
//
// System-protected nodes cannot be copied (the user shouldn't be able to
// duplicate post images out of the system folder), and nothing can be
// copied *into* a system folder.
func (s *Store) CopyDriveNode(
	ctx context.Context,
	nodeID, userID string,
	targetParentID *string,
) (*model.DriveNode, int64, error) {
	// Verify ownership and load the source node.
	src, err := s.GetDriveNode(ctx, nodeID, userID)
	if err != nil {
		return nil, 0, err
	}
	if src.IsTrashed {
		return nil, 0, fmt.Errorf("cannot copy a trashed node")
	}

	srcProtected, err := s.IsNodeProtected(ctx, nodeID, userID)
	if err != nil {
		return nil, 0, err
	}
	if srcProtected {
		return nil, 0, ErrSystemNodeProtected
	}
	if targetParentID != nil {
		dstProtected, err := s.IsNodeProtected(ctx, *targetParentID, userID)
		if err != nil {
			return nil, 0, err
		}
		if dstProtected {
			return nil, 0, ErrSystemNodeProtected
		}
	}

	// Prevent copying a folder into itself or its descendants.
	if src.Kind == "folder" && targetParentID != nil {
		isDesc, err := s.isDescendant(ctx, *targetParentID, nodeID, userID)
		if err != nil {
			return nil, 0, err
		}
		if *targetParentID == nodeID || isDesc {
			return nil, 0, fmt.Errorf("cannot copy a folder into itself")
		}
	}

	var (
		root      *model.DriveNode
		sizeDelta int64
	)
	err = s.withTx(ctx, func(tx pgx.Tx) error {
		r, delta, copyErr := copyNodeTx(ctx, tx, src, userID, targetParentID)
		if copyErr != nil {
			return copyErr
		}
		root = r
		sizeDelta = delta
		return nil
	})
	if err != nil {
		return nil, 0, err
	}

	if sizeDelta > 0 {
		_ = s.UpdateUserStorageUsed(ctx, userID, sizeDelta)
	}
	return root, sizeDelta, nil
}

// copyNodeTx performs the recursive copy inside a transaction. The caller is
// responsible for updating the user's storage usage based on the returned delta.
func copyNodeTx(
	ctx context.Context,
	tx pgx.Tx,
	src *model.DriveNode,
	userID string,
	targetParentID *string,
) (*model.DriveNode, int64, error) {
	var (
		newID     string
		createdAt time.Time
		updatedAt time.Time
	)
	err := tx.QueryRow(ctx, `
		INSERT INTO drive_nodes (user_id, parent_id, object_id, kind, name, size_bytes, mime_type)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at
	`,
		userID, targetParentID, src.ObjectID, src.Kind, src.Name, src.SizeBytes, src.MimeType,
	).Scan(&newID, &createdAt, &updatedAt)
	if err != nil {
		return nil, 0, err
	}

	copied := &model.DriveNode{
		ID:        newID,
		UserID:    userID,
		ParentID:  targetParentID,
		ObjectID:  src.ObjectID,
		Kind:      src.Kind,
		Name:      src.Name,
		SizeBytes: src.SizeBytes,
		MimeType:  src.MimeType,
		IsTrashed: false,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}

	delta := src.SizeBytes
	if src.Kind != "folder" {
		return copied, delta, nil
	}

	// Recursively copy children.
	rows, err := tx.Query(ctx, `
		SELECT id, user_id, parent_id, object_id, kind, name, size_bytes, mime_type, is_trashed, trashed_at, is_system, created_at, updated_at
		FROM drive_nodes
		WHERE user_id = $1 AND parent_id = $2 AND is_trashed = FALSE
		ORDER BY kind DESC, created_at ASC
	`, userID, src.ID)
	if err != nil {
		return nil, 0, err
	}
	children := make([]model.DriveNode, 0)
	for rows.Next() {
		n, scanErr := scanDriveNode(rows)
		if scanErr != nil {
			rows.Close()
			return nil, 0, scanErr
		}
		children = append(children, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	for i := range children {
		_, childDelta, childErr := copyNodeTx(ctx, tx, &children[i], userID, &newID)
		if childErr != nil {
			return nil, 0, childErr
		}
		delta += childDelta
	}
	return copied, delta, nil
}

// isDescendant returns true if candidateID is the same as or a descendant of ancestorID.
func (s *Store) isDescendant(ctx context.Context, candidateID, ancestorID, userID string) (bool, error) {
	if candidateID == ancestorID {
		return true, nil
	}
	cur := candidateID
	// Walk up the parent chain. Bound the loop to avoid pathological cycles.
	for i := 0; i < 1024; i++ {
		var parent sql.NullString
		err := s.pool.QueryRow(ctx, `
			SELECT parent_id FROM drive_nodes WHERE id = $1 AND user_id = $2
		`, cur, userID).Scan(&parent)
		if err != nil {
			return false, maybeErrNoRows(err)
		}
		if !parent.Valid {
			return false, nil
		}
		if parent.String == ancestorID {
			return true, nil
		}
		cur = parent.String
	}
	return false, nil
}

// GetDriveNode returns a single drive node owned by the given user.
func (s *Store) GetDriveNode(ctx context.Context, nodeID, userID string) (*model.DriveNode, error) {
	var n model.DriveNode
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, parent_id, object_id, kind, name, size_bytes, mime_type, is_trashed, trashed_at, is_system, created_at, updated_at
		FROM drive_nodes
		WHERE id = $1 AND user_id = $2
	`, nodeID, userID).Scan(
		&n.ID, &n.UserID, &n.ParentID, &n.ObjectID, &n.Kind, &n.Name,
		&n.SizeBytes, &n.MimeType, &n.IsTrashed, &n.TrashedAt, &n.IsSystem, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	return &n, nil
}

// ──────────────────────────────────────────────────────
// Objects
// ──────────────────────────────────────────────────────

// CreateObject creates a storage object record.
func (s *Store) CreateObject(ctx context.Context, ownerID, policyID, objectKey, sha256Hash, mimeType string, sizeBytes int64) (*model.Object, error) {
	var o model.Object
	err := s.pool.QueryRow(ctx, `
		INSERT INTO objects (owner_id, policy_id, object_key, sha256, mime_type, size_bytes)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, owner_id, policy_id, object_key, sha256, mime_type, size_bytes,
		          status, preview_status, preview_object_key, created_at
	`, ownerID, policyID, objectKey, sha256Hash, mimeType, sizeBytes).Scan(
		&o.ID, &o.OwnerID, &o.PolicyID, &o.ObjectKey, &o.SHA256, &o.MimeType, &o.SizeBytes,
		&o.Status, &o.PreviewStatus, &o.PreviewObjectKey, &o.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// GetObjectByID returns an object by ID.
func (s *Store) GetObjectByID(ctx context.Context, objectID string) (*model.Object, error) {
	var o model.Object
	err := s.pool.QueryRow(ctx, `
		SELECT id, owner_id, policy_id, object_key, sha256, mime_type, size_bytes,
		       status, preview_status, preview_object_key, created_at
		FROM objects
		WHERE id = $1
	`, objectID).Scan(
		&o.ID, &o.OwnerID, &o.PolicyID, &o.ObjectKey, &o.SHA256, &o.MimeType, &o.SizeBytes,
		&o.Status, &o.PreviewStatus, &o.PreviewObjectKey, &o.CreatedAt,
	)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	return &o, nil
}

// FindObjectBySHA256 finds an existing object by sha256 hash within a storage policy.
func (s *Store) FindObjectBySHA256(ctx context.Context, policyID, sha256Hash string) (*model.Object, error) {
	var o model.Object
	err := s.pool.QueryRow(ctx, `
		SELECT id, owner_id, policy_id, object_key, sha256, mime_type, size_bytes,
		       status, preview_status, preview_object_key, created_at
		FROM objects
		WHERE policy_id = $1 AND sha256 = $2 AND status = 'active'
		LIMIT 1
	`, policyID, sha256Hash).Scan(
		&o.ID, &o.OwnerID, &o.PolicyID, &o.ObjectKey, &o.SHA256, &o.MimeType, &o.SizeBytes,
		&o.Status, &o.PreviewStatus, &o.PreviewObjectKey, &o.CreatedAt,
	)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	return &o, nil
}

// UpdateUserStorageUsed atomically increments or decrements a user's storage_used_bytes.
func (s *Store) UpdateUserStorageUsed(ctx context.Context, userID string, delta int64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users
		SET storage_used_bytes = GREATEST(storage_used_bytes + $2, 0),
		    updated_at = NOW()
		WHERE id = $1
	`, userID, delta)
	return err
}

// ──────────────────────────────────────────────────────
// Storage policies
// ──────────────────────────────────────────────────────

// GetDefaultStoragePolicy returns the default enabled storage policy.
func (s *Store) GetDefaultStoragePolicy(ctx context.Context) (*model.StoragePolicy, error) {
	return s.scanStoragePolicy(s.pool.QueryRow(ctx, storagePolicySelectSQL+`
		WHERE sp.is_default = TRUE AND sp.is_enabled = TRUE
		ORDER BY sp.created_at ASC, sp.id ASC
		LIMIT 1
	`))
}

// GetStoragePolicyByID returns a storage policy by ID.
func (s *Store) GetStoragePolicyByID(ctx context.Context, policyID string) (*model.StoragePolicy, error) {
	return s.scanStoragePolicy(s.pool.QueryRow(ctx, storagePolicySelectSQL+` WHERE sp.id = $1`, policyID))
}

// ──────────────────────────────────────────────────────
// Share links
// ──────────────────────────────────────────────────────

// CreateShareLink creates a new share link for a drive node.
func (s *Store) CreateShareLink(ctx context.Context, ownerID, driveNodeID, token string, passwordHash *string, expiresAt *time.Time) (*model.ShareLink, error) {
	var sl model.ShareLink
	err := s.pool.QueryRow(ctx, `
		INSERT INTO share_links (owner_id, drive_node_id, token, password_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, owner_id, drive_node_id, token, expires_at, download_count, revoked_at, created_at,
		          (password_hash IS NOT NULL AND password_hash <> '') AS has_password
	`, ownerID, driveNodeID, token, passwordHash, expiresAt).Scan(
		&sl.ID, &sl.OwnerID, &sl.DriveNodeID, &sl.Token, &sl.ExpiresAt,
		&sl.DownloadCount, &sl.RevokedAt, &sl.CreatedAt, &sl.HasPassword,
	)
	if err != nil {
		return nil, err
	}
	return &sl, nil
}

// GetShareByToken returns a share link by token, provided it is not revoked
// or expired. Uses a LEFT JOIN against drive_nodes so that share rows whose
// source file has been hard-deleted (drive_node_id IS NULL after the
// migration's ON DELETE SET NULL) still come back. Callers must check
// sl.Node == nil or sl.Node.IsTrashed to detect a "file deleted" state.
func (s *Store) GetShareByToken(ctx context.Context, token string) (*model.ShareLink, error) {
	var sl model.ShareLink
	var (
		nID        sql.NullString
		nUserID    sql.NullString
		nParentID  sql.NullString
		nObjectID  sql.NullString
		nKind      sql.NullString
		nName      sql.NullString
		nSize      sql.NullInt64
		nMime      sql.NullString
		nIsTrashed sql.NullBool
		nTrashedAt sql.NullTime
		nIsSystem  sql.NullBool
		nCreated   sql.NullTime
		nUpdated   sql.NullTime
	)
	err := s.pool.QueryRow(ctx, `
		SELECT sl.id, sl.owner_id, sl.drive_node_id, sl.token, sl.expires_at,
		       sl.download_count, sl.revoked_at, sl.created_at,
		       (sl.password_hash IS NOT NULL AND sl.password_hash <> '') AS has_password,
		       dn.id, dn.user_id, dn.parent_id, dn.object_id, dn.kind, dn.name,
		       dn.size_bytes, dn.mime_type, dn.is_trashed, dn.trashed_at, dn.is_system,
		       dn.created_at, dn.updated_at
		FROM share_links sl
		LEFT JOIN drive_nodes dn ON dn.id = sl.drive_node_id
		WHERE sl.token = $1 AND sl.revoked_at IS NULL
		  AND (sl.expires_at IS NULL OR sl.expires_at > NOW())
	`, token).Scan(
		&sl.ID, &sl.OwnerID, &sl.DriveNodeID, &sl.Token, &sl.ExpiresAt,
		&sl.DownloadCount, &sl.RevokedAt, &sl.CreatedAt, &sl.HasPassword,
		&nID, &nUserID, &nParentID, &nObjectID, &nKind, &nName,
		&nSize, &nMime, &nIsTrashed, &nTrashedAt, &nIsSystem,
		&nCreated, &nUpdated,
	)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	if nID.Valid {
		n := model.DriveNode{
			ID:        nID.String,
			UserID:    nUserID.String,
			Kind:      nKind.String,
			Name:      nName.String,
			SizeBytes: nSize.Int64,
			MimeType:  nMime.String,
			IsTrashed: nIsTrashed.Bool,
			IsSystem:  nIsSystem.Bool,
			CreatedAt: nCreated.Time,
			UpdatedAt: nUpdated.Time,
		}
		if nParentID.Valid {
			s := nParentID.String
			n.ParentID = &s
		}
		if nObjectID.Valid {
			s := nObjectID.String
			n.ObjectID = &s
		}
		if nTrashedAt.Valid {
			t := nTrashedAt.Time
			n.TrashedAt = &t
		}
		sl.Node = &n
	}
	sl.NodeDeleted = sl.Node == nil || sl.Node.IsTrashed
	return &sl, nil
}

// ListUserShares returns all active share links for a user, joined with the
// underlying drive_node so the my-shares UI can show a "已删除" badge when
// the source file has been trashed or hard-purged. We pull enough drive_node
// fields for the listing to render an icon + name + size without an extra
// round-trip; the JOIN is left so a hard-purged drive_node yields NULLs and
// the share row still comes back.
func (s *Store) ListUserShares(ctx context.Context, userID string) ([]model.ShareLink, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT sl.id, sl.owner_id, sl.drive_node_id, sl.token, sl.expires_at,
		       sl.download_count, sl.revoked_at, sl.created_at,
		       (sl.password_hash IS NOT NULL AND sl.password_hash <> '') AS has_password,
		       dn.id, dn.kind, dn.name, dn.size_bytes, dn.mime_type, dn.is_trashed
		FROM share_links sl
		LEFT JOIN drive_nodes dn ON dn.id = sl.drive_node_id
		WHERE sl.owner_id = $1 AND sl.revoked_at IS NULL
		ORDER BY sl.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.ShareLink, 0)
	for rows.Next() {
		var sl model.ShareLink
		var (
			nID      sql.NullString
			nKind    sql.NullString
			nName    sql.NullString
			nSize    sql.NullInt64
			nMime    sql.NullString
			nTrashed sql.NullBool
		)
		if err := rows.Scan(
			&sl.ID, &sl.OwnerID, &sl.DriveNodeID, &sl.Token, &sl.ExpiresAt,
			&sl.DownloadCount, &sl.RevokedAt, &sl.CreatedAt, &sl.HasPassword,
			&nID, &nKind, &nName, &nSize, &nMime, &nTrashed,
		); err != nil {
			return nil, err
		}
		// Compute deleted state from the join: drive_node row missing
		// (purged) or trashed by the owner.
		sl.NodeDeleted = !nID.Valid || nTrashed.Bool
		if nID.Valid {
			sl.Node = &model.DriveNode{
				ID:        nID.String,
				Kind:      nKind.String,
				Name:      nName.String,
				SizeBytes: nSize.Int64,
				MimeType:  nMime.String,
				IsTrashed: nTrashed.Bool,
			}
		}
		items = append(items, sl)
	}
	return items, rows.Err()
}

// RevokeShare marks a share link as revoked.
func (s *Store) RevokeShare(ctx context.Context, shareID, ownerID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE share_links SET revoked_at = NOW() WHERE id = $1 AND owner_id = $2
	`, shareID, ownerID)
	return err
}

// IncrementShareDownloads increments the download counter for a share link.
func (s *Store) IncrementShareDownloads(ctx context.Context, shareID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE share_links SET download_count = download_count + 1 WHERE id = $1
	`, shareID)
	return err
}

// ──────────────────────────────────────────────────────
// Post attachments
// ──────────────────────────────────────────────────────

// BuildAttachmentURL joins a storage policy's base_url with the object key
// into a final, browser-loadable URL. Returns an empty string when the
// policy has no base_url configured — callers must then fall back to the
// authenticated /api/files/{object_id}/preview endpoint.
//
// Slash handling matches what users expect: trailing slashes on baseURL
// and leading slashes on key are deduped, so any reasonable combination
// resolves correctly.
func BuildAttachmentURL(baseURL, objectKey string) string {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" || objectKey == "" {
		return ""
	}
	return strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(objectKey, "/")
}

// postAttachmentSelectSQL is the canonical SELECT for post_attachments rows
// that need their resolved CDN URL. It LEFT JOINs through objects to the
// owning storage_policies row so we can compute the direct URL in a single
// query (no N+1 lookups when listing many attachments).
//
// pa.source_deleted is maintained by the trash/restore code paths whenever
// the source drive_node is trashed/restored/purged — the renderer treats it
// (along with objects.status='deleted' for admin-side global removals) as
// "show a 已删除 placeholder instead of the download button".
const postAttachmentSelectSQL = `
	SELECT pa.id, pa.post_id, pa.object_id, pa.drive_node_id,
	       pa.name, pa.mime_type, pa.size_bytes, pa.sort_order,
	       o.object_key,
	       COALESCE(sp.base_url, '') AS base_url,
	       COALESCE(o.status, 'active') AS object_status,
	       pa.source_deleted
	FROM post_attachments pa
	LEFT JOIN objects o ON o.id = pa.object_id
	LEFT JOIN storage_policies sp ON sp.id = o.policy_id
`

// scanPostAttachment scans a row matching postAttachmentSelectSQL and
// computes attachment.URL from the joined base_url + object_key. It also
// derives IsDeleted from source_deleted / object status so the rendering
// layer can show a 已删除 placeholder.
func scanPostAttachment(scanner interface{ Scan(...any) error }) (model.PostAttachment, error) {
	var (
		att           model.PostAttachment
		objectKey     sql.NullString
		baseURL       sql.NullString
		objectStatus  string
		sourceDeleted bool
	)
	if err := scanner.Scan(
		&att.ID, &att.PostID, &att.ObjectID, &att.DriveNodeID,
		&att.Name, &att.MimeType, &att.SizeBytes, &att.SortOrder,
		&objectKey, &baseURL,
		&objectStatus, &sourceDeleted,
	); err != nil {
		return att, err
	}
	if baseURL.Valid && objectKey.Valid {
		att.URL = BuildAttachmentURL(baseURL.String, objectKey.String)
	}
	// Two independent ways the source file becomes unavailable:
	//   1. The owning user trashed/purged their drive_node — store maintained
	//      pa.source_deleted via the trash/restore/purge code paths.
	//   2. An admin hard-deleted the underlying object globally
	//      (objects.status = 'deleted').
	if sourceDeleted || objectStatus == "deleted" {
		att.IsDeleted = true
		att.URL = ""
	}
	return att, nil
}

// GetPostAttachmentByID returns a single post attachment by its primary key.
func (s *Store) GetPostAttachmentByID(ctx context.Context, attachmentID string) (*model.PostAttachment, error) {
	row := s.pool.QueryRow(ctx, postAttachmentSelectSQL+` WHERE pa.id = $1`, attachmentID)
	att, err := scanPostAttachment(row)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	return &att, nil
}

// ListPostAttachments returns attachments for a post.
func (s *Store) ListPostAttachments(ctx context.Context, postID string) ([]model.PostAttachment, error) {
	rows, err := s.pool.Query(ctx, postAttachmentSelectSQL+`
		WHERE pa.post_id = $1
		ORDER BY pa.sort_order ASC, pa.created_at ASC
	`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.PostAttachment, 0)
	for rows.Next() {
		att, scanErr := scanPostAttachment(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, att)
	}
	return items, rows.Err()
}

// CreatePostAttachment inserts a new post attachment.
func (s *Store) CreatePostAttachment(ctx context.Context, postID, objectID string, driveNodeID *string, name, mimeType string, sizeBytes int64, sortOrder int) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO post_attachments (post_id, object_id, drive_node_id, name, mime_type, size_bytes, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, postID, objectID, driveNodeID, name, mimeType, sizeBytes, sortOrder)
	return err
}

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

func scanDriveNode(row pgx.Rows) (model.DriveNode, error) {
	var n model.DriveNode
	err := row.Scan(
		&n.ID, &n.UserID, &n.ParentID, &n.ObjectID, &n.Kind, &n.Name,
		&n.SizeBytes, &n.MimeType, &n.IsTrashed, &n.TrashedAt, &n.IsSystem, &n.CreatedAt, &n.UpdatedAt,
	)
	return n, err
}

func buildDriveTree(nodes []model.DriveNode) []model.DriveNode {
	childMap := make(map[string][]model.DriveNode)
	roots := make([]model.DriveNode, 0)
	for _, n := range nodes {
		if n.ParentID == nil || *n.ParentID == "" {
			roots = append(roots, n)
		} else {
			childMap[*n.ParentID] = append(childMap[*n.ParentID], n)
		}
	}
	for i := range roots {
		roots[i] = attachChildren(roots[i], childMap)
	}
	return roots
}

func attachChildren(node model.DriveNode, childMap map[string][]model.DriveNode) model.DriveNode {
	children := childMap[node.ID]
	if len(children) == 0 {
		node.Children = []model.DriveNode{}
		return node
	}
	node.Children = make([]model.DriveNode, len(children))
	for i, child := range children {
		node.Children[i] = attachChildren(child, childMap)
	}
	return node
}

const storagePolicySelectSQL = `
	SELECT sp.id, sp.name, sp.type, sp.is_enabled, sp.is_default,
	       sp.endpoint, sp.bucket, sp.region, sp.access_key, sp.secret_key,
	       sp.local_path, sp.dir_naming_rule, sp.file_naming_rule,
	       sp.max_file_size_bytes, sp.allowed_mime_types, sp.is_private,
	       sp.proxy_download, sp.base_url, sp.url_expire_seconds,
	       sp.created_at, sp.updated_at
	FROM storage_policies sp
`

func (s *Store) scanStoragePolicy(row interface{ Scan(...any) error }) (*model.StoragePolicy, error) {
	var sp model.StoragePolicy
	err := row.Scan(
		&sp.ID, &sp.Name, &sp.Type, &sp.IsEnabled, &sp.IsDefault,
		&sp.Endpoint, &sp.Bucket, &sp.Region, &sp.AccessKey, &sp.SecretKey,
		&sp.LocalPath, &sp.DirNamingRule, &sp.FileNamingRule,
		&sp.MaxFileSizeBytes, &sp.AllowedMimeTypes, &sp.IsPrivate,
		&sp.ProxyDownload, &sp.BaseURL, &sp.URLExpireSeconds,
		&sp.CreatedAt, &sp.UpdatedAt,
	)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	return &sp, nil
}

// EnsureQuota verifies that the user has enough storage quota for an incoming file.
func (s *Store) EnsureQuota(ctx context.Context, userID string, incomingSize int64) error {
	user, err := s.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if incomingSize > user.UploadLimitBytes {
		return fmt.Errorf("file exceeds upload limit")
	}
	if user.StorageUsedBytes+incomingSize > user.StorageQuotaBytes {
		return fmt.Errorf("storage quota exceeded")
	}
	return nil
}

// GetSharePasswordHash returns the password hash for a share link (for verification).
func (s *Store) GetSharePasswordHash(ctx context.Context, token string) (string, error) {
	var hash sql.NullString
	err := s.pool.QueryRow(ctx, `
		SELECT password_hash FROM share_links WHERE token = $1
	`, token).Scan(&hash)
	if err != nil {
		return "", maybeErrNoRows(err)
	}
	if hash.Valid {
		return hash.String, nil
	}
	return "", nil
}
