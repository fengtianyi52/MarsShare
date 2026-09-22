package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/marsshare/api/internal/model"
)

// ──────────────────────────────────────────────────────
// Dashboard
// ──────────────────────────────────────────────────────

// AdminDashboard returns aggregate counts for the admin dashboard.
func (s *Store) AdminDashboard(ctx context.Context) (*model.AdminDashboard, error) {
	var d model.AdminDashboard
	err := s.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM users),
			(SELECT COUNT(*) FROM posts WHERE status = 'published'),
			(SELECT COUNT(*) FROM objects WHERE status = 'active'),
			(SELECT COALESCE(SUM(size_bytes), 0) FROM objects WHERE status = 'active'),
			(SELECT COUNT(*) FROM reports WHERE status = 'pending')
	`).Scan(&d.UserCount, &d.PostCount, &d.FileCount, &d.TotalStorageBytes, &d.PendingReports)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// ──────────────────────────────────────────────────────
// Admin user management
// ──────────────────────────────────────────────────────

// AdminListUsers returns users with optional search query and cursor pagination.
func (s *Store) AdminListUsers(ctx context.Context, query string, params model.PageParams) (*model.PageResult[model.User], error) {
	limit := defaultPageLimit(params.Limit)
	args := make([]any, 0, 4)
	where := "WHERE 1=1"

	if query != "" {
		args = append(args, query)
		where += fmt.Sprintf(` AND (u.username ILIKE '%%' || $%d || '%%' OR u.email ILIKE '%%' || $%d || '%%' OR u.display_name ILIKE '%%' || $%d || '%%')`, len(args), len(args), len(args))
	}

	if params.Cursor != "" {
		t, err := time.Parse(time.RFC3339Nano, params.Cursor)
		if err == nil {
			args = append(args, t)
			where += fmt.Sprintf(` AND u.created_at < $%d`, len(args))
		}
	}

	args = append(args, limit+1)
	sql := fmt.Sprintf(`
		SELECT u.id, u.email, u.username, u.display_name, u.bio, u.role, u.avatar_object_id, u.avatar_data_url,
		       u.wallet_balance_cents, u.storage_used_bytes, u.storage_quota_bytes,
		       u.upload_limit_bytes, u.membership_plan_id, u.membership_ends_at,
		       u.is_banned, u.is_muted, u.muted_until, u.created_at, u.updated_at
		FROM users u
		%s
		ORDER BY u.created_at DESC
		LIMIT $%d
	`, where, len(args))

	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.User, 0, limit)
	for rows.Next() {
		var u model.User
		if err := rows.Scan(
			&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.Bio, &u.Role, &u.AvatarObjectID, &u.AvatarDataURL,
			&u.WalletBalanceCents, &u.StorageUsedBytes, &u.StorageQuotaBytes,
			&u.UploadLimitBytes, &u.MembershipPlanID, &u.MembershipEndsAt,
			&u.IsBanned, &u.IsMuted, &u.MutedUntil, &u.CreatedAt, &u.UpdatedAt,
		); err != nil {
			return nil, err
		}
		u.ComputeIsVIP()
		items = append(items, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := &model.PageResult[model.User]{Items: items}
	if len(items) > limit {
		result.Items = items[:limit]
		result.NextCursor = items[limit-1].CreatedAt.Format(time.RFC3339Nano)
	}
	return result, nil
}

// AdminSetBan sets or clears the banned flag for a user.
// When banning, all active sessions are deleted so the user is logged out immediately.
func (s *Store) AdminSetBan(ctx context.Context, userID string, banned bool) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET is_banned = $2, updated_at = NOW() WHERE id = $1`, userID, banned)
	if err != nil {
		return err
	}
	if banned {
		_ = s.DeleteAllSessionsByUserID(ctx, userID)
	}
	return nil
}

// AdminSetMute sets or clears the muted flag for a user.
// mutedUntil is optional; when nil the mute has no expiry.
func (s *Store) AdminSetMute(ctx context.Context, userID string, muted bool, mutedUntil *time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET is_muted = $2, muted_until = $3, updated_at = NOW() WHERE id = $1
	`, userID, muted, mutedUntil)
	return err
}

// ──────────────────────────────────────────────────────
// Admin post management
// ──────────────────────────────────────────────────────

// AdminListPosts returns posts filtered by status with cursor pagination.
func (s *Store) AdminListPosts(ctx context.Context, status string, params model.PageParams) (*model.PageResult[model.Post], error) {
	limit := defaultPageLimit(params.Limit)
	args := make([]any, 0, 3)
	where := "WHERE 1=1"

	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(` AND p.status = $%d`, len(args))
	}

	if params.Cursor != "" {
		t, err := time.Parse(time.RFC3339Nano, params.Cursor)
		if err == nil {
			args = append(args, t)
			where += fmt.Sprintf(` AND p.created_at < $%d`, len(args))
		}
	}

	args = append(args, limit+1)
	sql := fmt.Sprintf(`
		SELECT p.id, p.author_id, p.content, p.visibility, p.status, p.repost_of_id,
		       p.like_count, p.comment_count, p.repost_count, p.created_at, p.updated_at,
		       u.id, u.username, u.display_name, u.bio, u.role, u.avatar_object_id, u.avatar_data_url,
		       u.membership_ends_at, u.is_banned, u.created_at, u.updated_at
		FROM posts p
		JOIN users u ON u.id = p.author_id
		%s
		ORDER BY p.created_at DESC
		LIMIT $%d
	`, where, len(args))

	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.Post, 0, limit)
	for rows.Next() {
		var p model.Post
		var author model.User
		if err := rows.Scan(
			&p.ID, &p.AuthorID, &p.Content, &p.Visibility, &p.Status, &p.RepostOfID,
			&p.LikeCount, &p.CommentCount, &p.RepostCount, &p.CreatedAt, &p.UpdatedAt,
			&author.ID, &author.Username, &author.DisplayName, &author.Bio, &author.Role,
			&author.AvatarObjectID, &author.AvatarDataURL, &author.MembershipEndsAt, &author.IsBanned,
			&author.CreatedAt, &author.UpdatedAt,
		); err != nil {
			return nil, err
		}
		author.ComputeIsVIP()
		p.Author = &author
		items = append(items, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := &model.PageResult[model.Post]{Items: items}
	if len(items) > limit {
		result.Items = items[:limit]
		result.NextCursor = items[limit-1].CreatedAt.Format(time.RFC3339Nano)
	}
	return result, nil
}

// AdminSetPostStatus sets a post's status (e.g., published, deleted, hidden)
// and synchronises the visibility of its post-image drive nodes:
//   - → "deleted": hide post-image nodes (is_trashed = true)
//   - "deleted" → other: unhide post-image nodes (is_trashed = false)
func (s *Store) AdminSetPostStatus(ctx context.Context, postID, status string) error {
	var oldStatus string
	_ = s.pool.QueryRow(ctx, `SELECT status FROM posts WHERE id = $1`, postID).Scan(&oldStatus)

	if _, err := s.pool.Exec(ctx, `UPDATE posts SET status = $2, updated_at = NOW() WHERE id = $1`, postID, status); err != nil {
		return err
	}

	if status == "deleted" {
		_ = s.setPostImageNodesTrash(ctx, postID, true)
	} else if oldStatus == "deleted" {
		_ = s.setPostImageNodesTrash(ctx, postID, false)
	}
	return nil
}

// DeletedObjectInfo carries the storage-level information needed to physically
// remove a file from the storage backend after the DB records are gone.
type DeletedObjectInfo struct {
	PolicyID  string
	ObjectKey string
}

// AdminHardDeletePost permanently deletes a post and all associated records.
// It also deletes the drive_nodes that were attached to the post and, for
// objects that are no longer referenced by any other drive node, removes them
// from the objects table and decrements the owner's storage quota.
// The returned []DeletedObjectInfo must be used by the caller to physically
// remove the files from the storage backend.
func (s *Store) AdminHardDeletePost(ctx context.Context, postID string) ([]DeletedObjectInfo, error) {
	type nodeInfo struct {
		nodeID    string
		objectID  string
		policyID  string
		objectKey string
		sizeBytes int64
		ownerID   string
	}

	var toDelete []DeletedObjectInfo

	err := s.withTx(ctx, func(tx pgx.Tx) error {
		// 1. Collect drive_nodes (and their objects) that belong to this post.
		rows, err := tx.Query(ctx, `
			SELECT dn.id, o.id, o.policy_id, o.object_key, o.size_bytes, o.owner_id
			FROM post_attachments pa
			JOIN drive_nodes dn ON dn.id = pa.drive_node_id
			JOIN objects o ON o.id = dn.object_id
			WHERE pa.post_id = $1
			  AND pa.drive_node_id IS NOT NULL
		`, postID)
		if err != nil {
			return err
		}
		var nodes []nodeInfo
		for rows.Next() {
			var n nodeInfo
			if err := rows.Scan(&n.nodeID, &n.objectID, &n.policyID, &n.objectKey, &n.sizeBytes, &n.ownerID); err != nil {
				rows.Close()
				return err
			}
			nodes = append(nodes, n)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		// 2. Delete the post. ON DELETE CASCADE removes post_attachments,
		//    post_topics, post_views, trending_scores, reposts, likes, etc.
		if _, err := tx.Exec(ctx, `DELETE FROM posts WHERE id = $1`, postID); err != nil {
			return err
		}

		// 3. Delete drive_nodes (FK reference from post_attachments is gone).
		for _, n := range nodes {
			if _, err := tx.Exec(ctx, `DELETE FROM drive_nodes WHERE id = $1`, n.nodeID); err != nil {
				return err
			}
		}

		// 4. Delete objects that are now orphaned (no other drive_node references).
		for _, n := range nodes {
			var refs int
			if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM drive_nodes WHERE object_id = $1`, n.objectID).Scan(&refs); err != nil {
				return err
			}
			if refs == 0 {
				if _, err := tx.Exec(ctx, `DELETE FROM objects WHERE id = $1`, n.objectID); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `
					UPDATE users SET storage_used_bytes = GREATEST(storage_used_bytes - $1, 0)
					WHERE id = $2
				`, n.sizeBytes, n.ownerID); err != nil {
					return err
				}
				toDelete = append(toDelete, DeletedObjectInfo{PolicyID: n.policyID, ObjectKey: n.objectKey})
			}
		}
		return nil
	})

	return toDelete, err
}

// ──────────────────────────────────────────────────────
// Admin topic management
// ──────────────────────────────────────────────────────

// AdminListTopics returns topics with cursor pagination ordered by post_count desc.
func (s *Store) AdminListTopics(ctx context.Context, params model.PageParams) (*model.PageResult[model.Topic], error) {
	limit := defaultPageLimit(params.Limit)
	args := []any{limit + 1}
	where := ""
	if params.Cursor != "" {
		args = append(args, params.Cursor)
		where = fmt.Sprintf(`WHERE t.slug < $%d`, len(args))
	}

	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, slug, title, description, post_count, follower_count, cover_url, is_banned, created_at
		FROM topics t
		%s
		ORDER BY post_count DESC, created_at DESC
		LIMIT $1
	`, where), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	topics, err := scanTopics(rows)
	if err != nil {
		return nil, err
	}
	result := &model.PageResult[model.Topic]{Items: topics}
	if len(topics) > limit {
		result.Items = topics[:limit]
		result.NextCursor = topics[limit-1].Slug
	}
	return result, nil
}

// AdminBanTopic sets or clears the is_banned flag on a topic.
func (s *Store) AdminBanTopic(ctx context.Context, topicID string, banned bool) error {
	_, err := s.pool.Exec(ctx, `UPDATE topics SET is_banned = $2 WHERE id = $1`, topicID, banned)
	return err
}

// AdminGetTopicPostIDs returns the IDs of all posts that belong to a topic.
func (s *Store) AdminGetTopicPostIDs(ctx context.Context, topicID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT post_id FROM post_topics WHERE topic_id = $1`, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// AdminDeleteTopic deletes a topic record. Caller must have already hard-deleted
// all posts in the topic (so post_topics entries are gone via CASCADE). Any
// remaining post_topics rows are removed by the ON DELETE CASCADE on topics.
func (s *Store) AdminDeleteTopic(ctx context.Context, topicID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM topics WHERE id = $1`, topicID)
	return err
}

// ──────────────────────────────────────────────────────
// Admin reports
// ──────────────────────────────────────────────────────

// AdminListReports returns reports filtered by status with cursor pagination.
func (s *Store) AdminListReports(ctx context.Context, status string, params model.PageParams) (*model.PageResult[model.Report], error) {
	limit := defaultPageLimit(params.Limit)
	args := make([]any, 0, 3)
	where := "WHERE 1=1"

	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(` AND r.status = $%d`, len(args))
	}

	if params.Cursor != "" {
		t, err := time.Parse(time.RFC3339Nano, params.Cursor)
		if err == nil {
			args = append(args, t)
			where += fmt.Sprintf(` AND r.created_at < $%d`, len(args))
		}
	}

	args = append(args, limit+1)
	// LEFT JOIN against the three possible target tables so the admin UI can
	// jump straight to the offending content. Each cast guards against UUID
	// parse errors when the target_type doesn't match.
	sql := fmt.Sprintf(`
		SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.status,
		       r.resolved_by, r.resolved_at, r.created_at,
		       u.id, u.username, u.display_name, u.bio, u.role, u.avatar_object_id, u.avatar_data_url,
		       u.membership_ends_at, u.is_banned, u.created_at, u.updated_at,
		       p_target.id AS target_post_id_post,
		       c_target.post_id AS target_post_id_comment,
		       u_target.username AS target_username,
		       CASE
		           WHEN r.target_type = 'post'    AND p_target.id IS NULL THEN TRUE
		           WHEN r.target_type = 'comment' AND c_target.id IS NULL THEN TRUE
		           WHEN r.target_type = 'user'    AND u_target.id IS NULL THEN TRUE
		           ELSE FALSE
		       END AS target_deleted
		FROM reports r
		JOIN users u ON u.id = r.reporter_id
		LEFT JOIN posts    p_target ON r.target_type = 'post'    AND p_target.id = r.target_id
		LEFT JOIN comments c_target ON r.target_type = 'comment' AND c_target.id = r.target_id
		LEFT JOIN users    u_target ON r.target_type = 'user'    AND u_target.id = r.target_id
		%s
		ORDER BY r.created_at DESC
		LIMIT $%d
	`, where, len(args))

	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.Report, 0, limit)
	for rows.Next() {
		var rpt model.Report
		var reporter model.User
		var targetPostIDPost, targetPostIDComment *string
		var targetUsername *string
		var targetDeleted bool
		if err := rows.Scan(
			&rpt.ID, &rpt.ReporterID, &rpt.TargetType, &rpt.TargetID, &rpt.Reason, &rpt.Status,
			&rpt.ResolvedBy, &rpt.ResolvedAt, &rpt.CreatedAt,
			&reporter.ID, &reporter.Username, &reporter.DisplayName, &reporter.Bio, &reporter.Role,
			&reporter.AvatarObjectID, &reporter.AvatarDataURL, &reporter.MembershipEndsAt, &reporter.IsBanned,
			&reporter.CreatedAt, &reporter.UpdatedAt,
			&targetPostIDPost, &targetPostIDComment, &targetUsername, &targetDeleted,
		); err != nil {
			return nil, err
		}
		reporter.ComputeIsVIP()
		rpt.Reporter = &reporter
		switch rpt.TargetType {
		case "post":
			rpt.TargetPostID = targetPostIDPost
		case "comment":
			rpt.TargetPostID = targetPostIDComment
		case "user":
			rpt.TargetUsername = targetUsername
		}
		rpt.TargetDeleted = targetDeleted
		items = append(items, rpt)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := &model.PageResult[model.Report]{Items: items}
	if len(items) > limit {
		result.Items = items[:limit]
		result.NextCursor = items[limit-1].CreatedAt.Format(time.RFC3339Nano)
	}
	return result, nil
}

// AdminResolveReport marks a report as resolved.
func (s *Store) AdminResolveReport(ctx context.Context, reportID, adminID, resolution string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE reports
		SET status = $2, resolved_by = $3, resolved_at = NOW()
		WHERE id = $1
	`, reportID, resolution, adminID)
	return err
}

// ──────────────────────────────────────────────────────
// Audit Log
// ──────────────────────────────────────────────────────

// CreateAuditLog records an admin action in the audit log.
func (s *Store) CreateAuditLog(ctx context.Context, actorID, action, targetType, targetID string, payload any) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO audit_logs (actor_id, action, target_type, target_id, payload)
		VALUES ($1, $2, $3, $4, $5)
	`, actorID, action, targetType, targetID, jsonRaw(payload))
	return err
}

// ──────────────────────────────────────────────────────
// Admin file management
// ──────────────────────────────────────────────────────

// AdminListObjectsParams narrows the global file listing in the admin UI.
type AdminListObjectsParams struct {
	Query      string // matches sha256 / object_key / owner.username / owner.email
	MimePrefix string // e.g. "image/" — server-side filter
	Status     string // active | orphaned | deleted | "" (any)
	model.PageParams
}

// AdminListObjects returns a paginated list of every object in the system,
// joined with its owner and storage policy plus reference counts. The page
// is ordered by created_at DESC, with cursor pagination matching
// AdminListUsers / AdminListPosts.
func (s *Store) AdminListObjects(ctx context.Context, params AdminListObjectsParams) (*model.PageResult[model.AdminObjectListItem], error) {
	limit := defaultPageLimit(params.Limit)
	args := make([]any, 0, 6)
	where := "WHERE 1=1"

	if params.Query != "" {
		args = append(args, params.Query)
		where += fmt.Sprintf(`
			AND (
				o.sha256 ILIKE '%%' || $%[1]d || '%%'
				OR o.object_key ILIKE '%%' || $%[1]d || '%%'
				OR u.username ILIKE '%%' || $%[1]d || '%%'
				OR u.email ILIKE '%%' || $%[1]d || '%%'
			)`, len(args))
	}
	if params.MimePrefix != "" {
		args = append(args, params.MimePrefix+"%")
		where += fmt.Sprintf(` AND o.mime_type ILIKE $%d`, len(args))
	}
	if params.Status != "" {
		args = append(args, params.Status)
		where += fmt.Sprintf(` AND o.status = $%d`, len(args))
	}
	if params.Cursor != "" {
		t, err := time.Parse(time.RFC3339Nano, params.Cursor)
		if err == nil {
			args = append(args, t)
			where += fmt.Sprintf(` AND o.created_at < $%d`, len(args))
		}
	}

	args = append(args, limit+1)
	sql := fmt.Sprintf(`
		SELECT o.id, o.owner_id, o.policy_id, o.object_key, o.sha256, o.mime_type,
		       o.size_bytes, o.status, o.preview_status, o.preview_object_key, o.created_at,
		       u.username, COALESCE(u.display_name, ''),
		       COALESCE(sp.name, ''),
		       (SELECT COUNT(*) FROM drive_nodes dn WHERE dn.object_id = o.id) AS drive_refs,
		       (SELECT COUNT(*) FROM post_attachments pa WHERE pa.object_id = o.id) AS post_refs
		FROM objects o
		LEFT JOIN users u ON u.id = o.owner_id
		LEFT JOIN storage_policies sp ON sp.id = o.policy_id
		%s
		ORDER BY o.created_at DESC
		LIMIT $%d
	`, where, len(args))

	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.AdminObjectListItem, 0, limit)
	for rows.Next() {
		var it model.AdminObjectListItem
		if err := rows.Scan(
			&it.ID, &it.OwnerID, &it.PolicyID, &it.ObjectKey, &it.SHA256, &it.MimeType,
			&it.SizeBytes, &it.Status, &it.PreviewStatus, &it.PreviewObjectKey, &it.CreatedAt,
			&it.OwnerUsername, &it.OwnerDisplayName, &it.PolicyName,
			&it.DriveRefCount, &it.PostRefCount,
		); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := &model.PageResult[model.AdminObjectListItem]{Items: items}
	if len(items) > limit {
		result.Items = items[:limit]
		result.NextCursor = items[limit-1].CreatedAt.Format(time.RFC3339Nano)
	}
	return result, nil
}

// AdminGetObjectByID is a thin wrapper used by the admin file detail view.
// Returns the same shape as AdminListObjects.
func (s *Store) AdminGetObjectByID(ctx context.Context, objectID string) (*model.AdminObjectListItem, error) {
	var it model.AdminObjectListItem
	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.owner_id, o.policy_id, o.object_key, o.sha256, o.mime_type,
		       o.size_bytes, o.status, o.preview_status, o.preview_object_key, o.created_at,
		       u.username, COALESCE(u.display_name, ''),
		       COALESCE(sp.name, ''),
		       (SELECT COUNT(*) FROM drive_nodes dn WHERE dn.object_id = o.id) AS drive_refs,
		       (SELECT COUNT(*) FROM post_attachments pa WHERE pa.object_id = o.id) AS post_refs
		FROM objects o
		LEFT JOIN users u ON u.id = o.owner_id
		LEFT JOIN storage_policies sp ON sp.id = o.policy_id
		WHERE o.id = $1
	`, objectID).Scan(
		&it.ID, &it.OwnerID, &it.PolicyID, &it.ObjectKey, &it.SHA256, &it.MimeType,
		&it.SizeBytes, &it.Status, &it.PreviewStatus, &it.PreviewObjectKey, &it.CreatedAt,
		&it.OwnerUsername, &it.OwnerDisplayName, &it.PolicyName,
		&it.DriveRefCount, &it.PostRefCount,
	)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	return &it, nil
}

// AdminHardDeleteObject globally removes a file:
//   - every drive_node referencing the object is deleted, and the live
//     (non-trashed, non-system) bytes are removed from each owner's quota.
//   - share_links pointing at any of those drive_nodes have drive_node_id
//     set NULL via the migration-0012 ON DELETE SET NULL constraint, so
//     public viewers see "文件已被删除".
//   - the object row stays alive but its status is flipped to 'deleted'
//     because post_attachments.object_id is NOT NULL FK; the rendering
//     layer in attachmentsForPosts treats status='deleted' as "已删除".
//
// Returns the (policy_id, object_key) tuple needed for the storage backend
// best-effort byte cleanup.
func (s *Store) AdminHardDeleteObject(ctx context.Context, objectID string) (DeletedObjectInfo, error) {
	var info DeletedObjectInfo
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		// Pull the object's policy / key while it still exists.
		var status string
		if err := tx.QueryRow(ctx, `
			SELECT policy_id, object_key, status FROM objects WHERE id = $1
		`, objectID).Scan(&info.PolicyID, &info.ObjectKey, &status); err != nil {
			return maybeErrNoRows(err)
		}

		// Find every drive_node referencing this object together with its
		// owner and "is this counted against the quota right now?" flag.
		// Trashed and system files are NOT counted (their bytes have
		// already been released by TrashDriveNode, or never counted to
		// begin with).
		rows, err := tx.Query(ctx, `
			SELECT id, user_id, size_bytes,
			       (is_trashed = FALSE AND is_system = FALSE) AS counted
			FROM drive_nodes
			WHERE object_id = $1
		`, objectID)
		if err != nil {
			return err
		}
		type driveRef struct {
			id      string
			ownerID string
			size    int64
			counted bool
		}
		var refs []driveRef
		for rows.Next() {
			var r driveRef
			if err := rows.Scan(&r.id, &r.ownerID, &r.size, &r.counted); err != nil {
				rows.Close()
				return err
			}
			refs = append(refs, r)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		// Sum quota releases by owner.
		releases := make(map[string]int64)
		for _, r := range refs {
			if r.counted {
				releases[r.ownerID] += r.size
			}
		}

		// Delete the drive_nodes (cascading their share_links to NULL via
		// the FK). We delete by id rather than by object_id so we can
		// guarantee we touched the same set we summed above.
		for _, r := range refs {
			if _, err := tx.Exec(ctx, `DELETE FROM drive_nodes WHERE id = $1`, r.id); err != nil {
				return err
			}
		}

		// Apply quota releases.
		for owner, bytes := range releases {
			if bytes <= 0 {
				continue
			}
			if _, err := tx.Exec(ctx, `
				UPDATE users
				SET storage_used_bytes = GREATEST(storage_used_bytes - $2, 0),
				    updated_at = NOW()
				WHERE id = $1
			`, owner, bytes); err != nil {
				return err
			}
		}

		// Mark the object as deleted. We can't drop the row because
		// post_attachments.object_id is a NOT NULL FK; flipping status
		// is enough for the rendering layer.
		if _, err := tx.Exec(ctx, `
			UPDATE objects SET status = 'deleted' WHERE id = $1
		`, objectID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return DeletedObjectInfo{}, err
	}
	return info, nil
}

// ──────────────────────────────────────────────────────
// Worker: Orphaned Objects Cleanup
// ──────────────────────────────────────────────────────

// CleanupOrphanedObjects marks objects as 'orphaned' if they have no referencing
// drive_nodes or post_attachments. These can later be physically deleted.
func (s *Store) CleanupOrphanedObjects(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE objects
		SET status = 'orphaned'
		WHERE status = 'active'
		  AND id NOT IN (SELECT DISTINCT object_id FROM drive_nodes WHERE object_id IS NOT NULL)
		  AND id NOT IN (SELECT DISTINCT object_id FROM post_attachments)
	`)
	return err
}
