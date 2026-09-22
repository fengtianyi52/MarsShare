package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	appdb "github.com/marsshare/api/internal/db"
	"github.com/marsshare/api/internal/model"
)

// ──────────────────────────────────────────────────────
// Posts
// ──────────────────────────────────────────────────────

// CreatePost creates a new post and returns it with the author populated.
func (s *Store) CreatePost(ctx context.Context, authorID, content, visibility string, repostOfID *string) (*model.Post, error) {
	if visibility == "" {
		visibility = "public"
	}
	var p model.Post
	err := s.pool.QueryRow(ctx, `
		INSERT INTO posts (author_id, content, visibility, repost_of_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id, author_id, content, visibility, status, repost_of_id,
		          like_count, comment_count, repost_count, created_at, updated_at, edited_at
	`, authorID, strings.TrimSpace(content), visibility, repostOfID).Scan(
		&p.ID, &p.AuthorID, &p.Content, &p.Visibility, &p.Status, &p.RepostOfID,
		&p.LikeCount, &p.CommentCount, &p.RepostCount, &p.CreatedAt, &p.UpdatedAt, &p.EditedAt,
	)
	if err != nil {
		return nil, err
	}

	if visibility == "public" {
		insertTrendingSQL := `
			INSERT INTO trending_scores (post_id, score_24h, score_7d, updated_at)
			VALUES ($1, 0, 0, NOW())
			ON CONFLICT (post_id) DO NOTHING
		`
		if s.pool.Dialect() == appdb.DialectSQLite {
			insertTrendingSQL = `
				INSERT OR IGNORE INTO trending_scores (post_id, score_24h, score_7d, updated_at)
				VALUES ($1, 0, 0, CURRENT_TIMESTAMP)
			`
		}
		_, _ = s.pool.Exec(ctx, insertTrendingSQL, p.ID)
	}

	author, err := s.GetUserByID(ctx, authorID)
	if err != nil {
		return nil, err
	}
	p.Author = author
	return &p, nil
}

// GetPostByID returns a post with viewer-aware reaction flags and its repost reference hydrated.
func (s *Store) GetPostByID(ctx context.Context, postID string, viewerID *string) (*model.Post, error) {
	posts, err := s.loadPostsByIDs(ctx, []string{postID}, viewerID, 2)
	if err != nil {
		return nil, err
	}

	post, ok := posts[postID]
	if !ok {
		return nil, sql.ErrNoRows
	}

	return post, nil
}

// DeletePost soft-deletes a post by setting status='deleted'. Verifies ownership.
func (s *Store) DeletePost(ctx context.Context, postID, authorID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE posts SET status = 'deleted', updated_at = NOW()
		WHERE id = $1 AND author_id = $2 AND status = 'published'
	`, postID, authorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("post not found or not owned")
	}
	// Hide post-image drive nodes so deleted-post images disappear from drive.
	// Best-effort — failure doesn't roll back the soft-delete.
	_ = s.setPostImageNodesTrash(ctx, postID, true)
	return nil
}

// setPostImageNodesTrash marks (or unmarks) as trashed the drive_nodes that
// were uploaded specifically for this post (i.e. their parent is the user's
// system "帖子图片" folder). Regular drive-file attachments are left untouched.
func (s *Store) setPostImageNodesTrash(ctx context.Context, postID string, trashed bool) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE drive_nodes
		SET is_trashed = $2, updated_at = NOW()
		WHERE id IN (
			SELECT pa.drive_node_id
			FROM post_attachments pa
			JOIN drive_nodes dn ON dn.id = pa.drive_node_id
			JOIN drive_nodes parent ON parent.id = dn.parent_id AND parent.is_system = TRUE
			WHERE pa.post_id = $1
			  AND pa.drive_node_id IS NOT NULL
		)
	`, postID, trashed)
	return err
}

// UpdatePostInput is the editable shape passed to UpdatePost.
type UpdatePostInput struct {
	Content       string
	Visibility    string
	AttachmentIDs []string // drive node IDs (in display order)
}

// UpdatePost edits a post. Permission must be checked by the caller (author
// or admin). Stores the *previous* state into post_revisions, replaces the
// post_attachments rows with the new set, and updates the post itself.
//
// The attachment IDs are validated against the editor's drive nodes — for
// admin edits the validation walks the *post author's* drive instead so admins
// can't accidentally inject their own private files.
func (s *Store) UpdatePost(ctx context.Context, postID, editorID string, isAdmin bool, in UpdatePostInput) (*model.Post, error) {
	// Load current state for the snapshot.
	current, err := s.GetPostByID(ctx, postID, &editorID)
	if err != nil {
		return nil, err
	}
	if current.Status != "published" {
		return nil, fmt.Errorf("post is not editable")
	}
	if !isAdmin && current.AuthorID != editorID {
		return nil, fmt.Errorf("not allowed to edit this post")
	}

	visibility := strings.TrimSpace(in.Visibility)
	if visibility == "" {
		visibility = current.Visibility
	}

	// Resolve attachment drive nodes. Use the post author's drive (so an
	// admin edit doesn't pull files from the admin's own drive).
	attachOwnerID := current.AuthorID
	type resolved struct {
		nodeID    string
		objectID  string
		name      string
		mimeType  string
		sizeBytes int64
	}
	resolvedAtts := make([]resolved, 0, len(in.AttachmentIDs))
	for _, nodeID := range in.AttachmentIDs {
		node, err := s.GetDriveNode(ctx, nodeID, attachOwnerID)
		if err != nil || node == nil || node.ObjectID == nil {
			continue
		}
		resolvedAtts = append(resolvedAtts, resolved{
			nodeID:    node.ID,
			objectID:  *node.ObjectID,
			name:      node.Name,
			mimeType:  node.MimeType,
			sizeBytes: node.SizeBytes,
		})
	}

	// Build snapshot JSON of the *old* attachments.
	oldAttachments := make([]model.PostRevisionAttachment, 0, len(current.Attachments))
	for _, a := range current.Attachments {
		oldAttachments = append(oldAttachments, model.PostRevisionAttachment{
			ObjectID:    a.ObjectID,
			DriveNodeID: a.DriveNodeID,
			Name:        a.Name,
			MimeType:    a.MimeType,
			SizeBytes:   a.SizeBytes,
		})
	}
	snapshotJSON, err := json.Marshal(oldAttachments)
	if err != nil {
		return nil, fmt.Errorf("marshal old attachments: %w", err)
	}

	err = s.withTx(ctx, func(tx pgx.Tx) error {
		// Insert revision row capturing the *previous* state.
		if _, err := tx.Exec(ctx, `
			INSERT INTO post_revisions (post_id, editor_id, content, visibility, attachments)
			VALUES ($1, $2, $3, $4, $5)
		`, postID, editorID, current.Content, current.Visibility, string(snapshotJSON)); err != nil {
			return err
		}

		// Update the post itself.
		if _, err := tx.Exec(ctx, `
			UPDATE posts
			SET content = $2, visibility = $3, updated_at = NOW(), edited_at = NOW()
			WHERE id = $1
		`, postID, strings.TrimSpace(in.Content), visibility); err != nil {
			return err
		}

		// Replace attachments.
		if _, err := tx.Exec(ctx, `DELETE FROM post_attachments WHERE post_id = $1`, postID); err != nil {
			return err
		}
		for i, a := range resolvedAtts {
			nodeIDPtr := &a.nodeID
			if _, err := tx.Exec(ctx, `
				INSERT INTO post_attachments (post_id, object_id, drive_node_id, name, mime_type, size_bytes, sort_order)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, postID, a.objectID, nodeIDPtr, a.name, a.mimeType, a.sizeBytes, i); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return s.GetPostByID(ctx, postID, &editorID)
}

// ListPostRevisions returns all revisions for a post, newest first, with editor populated.
func (s *Store) ListPostRevisions(ctx context.Context, postID string) ([]model.PostRevision, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT r.id, r.post_id, r.editor_id, r.content, r.visibility, r.attachments, r.created_at,
		       u.id, u.username, u.display_name, u.bio, u.role, u.avatar_object_id, u.avatar_data_url,
		       u.membership_ends_at, u.is_banned, u.created_at, u.updated_at
		FROM post_revisions r
		JOIN users u ON u.id = r.editor_id
		WHERE r.post_id = $1
		ORDER BY r.created_at DESC
	`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.PostRevision, 0)
	for rows.Next() {
		var rev model.PostRevision
		var editor model.User
		var attsJSON []byte
		if err := rows.Scan(
			&rev.ID, &rev.PostID, &rev.EditorID, &rev.Content, &rev.Visibility, &attsJSON, &rev.CreatedAt,
			&editor.ID, &editor.Username, &editor.DisplayName, &editor.Bio, &editor.Role,
			&editor.AvatarObjectID, &editor.AvatarDataURL, &editor.MembershipEndsAt, &editor.IsBanned,
			&editor.CreatedAt, &editor.UpdatedAt,
		); err != nil {
			return nil, err
		}
		editor.ComputeIsVIP()
		if len(attsJSON) > 0 {
			_ = json.Unmarshal(attsJSON, &rev.Attachments)
		}
		if rev.Attachments == nil {
			rev.Attachments = []model.PostRevisionAttachment{}
		}
		rev.Editor = &editor
		items = append(items, rev)
	}
	return items, rows.Err()
}

// ──────────────────────────────────────────────────────
// Feed queries (cursor-based pagination)
// ──────────────────────────────────────────────────────

// ListPublicFeed returns published posts ordered by created_at DESC.
func (s *Store) ListPublicFeed(ctx context.Context, viewerID *string, params model.PageParams) (*model.PageResult[model.Post], error) {
	return s.paginatedPostQuery(ctx, viewerID, params, `
		SELECT `+postFeedColumns+`
		FROM posts p
		JOIN users u ON u.id = p.author_id
		WHERE p.status = 'published' AND p.visibility = 'public'
	`, nil)
}

// ListFollowingFeed returns posts from users the given user follows.
func (s *Store) ListFollowingFeed(ctx context.Context, userID string, params model.PageParams) (*model.PageResult[model.Post], error) {
	return s.paginatedPostQuery(ctx, &userID, params, `
		SELECT `+postFeedColumns+`
		FROM posts p
		JOIN users u ON u.id = p.author_id
		WHERE p.status = 'published'
		  AND p.visibility IN ('public', 'followers')
		  AND (
			p.author_id = $`+viewerPlaceholder+`
			OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $`+viewerPlaceholder+`)
		  )
	`, []any{userID})
}

// ListUserPosts returns posts by a specific user.
func (s *Store) ListUserPosts(ctx context.Context, userID string, viewerID *string, params model.PageParams) (*model.PageResult[model.Post], error) {
	return s.paginatedPostQuery(ctx, viewerID, params, `
		SELECT `+postFeedColumns+`
		FROM posts p
		JOIN users u ON u.id = p.author_id
		WHERE p.status = 'published' AND p.author_id = $`+extraPlaceholder+`
	`, []any{userID})
}

// ListTopicFeed returns posts tagged with a specific topic slug.
func (s *Store) ListTopicFeed(ctx context.Context, topicSlug string, viewerID *string, params model.PageParams) (*model.PageResult[model.Post], error) {
	return s.paginatedPostQuery(ctx, viewerID, params, `
		SELECT `+postFeedColumns+`
		FROM posts p
		JOIN users u ON u.id = p.author_id
		JOIN post_topics pt ON pt.post_id = p.id
		JOIN topics t ON t.id = pt.topic_id
		WHERE p.status = 'published' AND t.slug = $`+extraPlaceholder+`
	`, []any{topicSlug})
}

// SearchPosts searches posts using tsvector (PostgreSQL) or LIKE (SQLite).
func (s *Store) SearchPosts(ctx context.Context, query string, viewerID *string, params model.PageParams) (*model.PageResult[model.Post], error) {
	searchClause := `(p.search_vector @@ plainto_tsquery('simple', $` + extraPlaceholder + `) OR p.content ILIKE '%' || $` + extraPlaceholder + ` || '%')`
	if s.pool.Dialect() == appdb.DialectSQLite {
		searchClause = `p.content LIKE '%' || $` + extraPlaceholder + ` || '%'`
	}
	return s.paginatedPostQuery(ctx, viewerID, params, `
		SELECT `+postFeedColumns+`
		FROM posts p
		JOIN users u ON u.id = p.author_id
		WHERE p.status = 'published'
		  AND `+searchClause+`
	`, []any{query})
}

// ListTrending returns top-scored posts from the trending_scores table.
func (s *Store) ListTrending(ctx context.Context, viewerID *string, limit int) ([]model.Post, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+postFeedColumns+`
		FROM trending_scores ts
		JOIN posts p ON p.id = ts.post_id
		JOIN users u ON u.id = p.author_id
		WHERE p.status = 'published'
		  AND p.visibility = 'public'
		ORDER BY ts.score_24h DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	posts, err := s.scanPostRows(ctx, rows, viewerID, 2)
	if err != nil {
		return nil, err
	}
	return posts, nil
}

// ──────────────────────────────────────────────────────
// Reactions
// ──────────────────────────────────────────────────────

// LikePost adds a reaction and increments the post's like_count.
func (s *Store) LikePost(ctx context.Context, userID, postID string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO reactions (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
		`, userID, postID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			_, err = tx.Exec(ctx, `UPDATE posts SET like_count = like_count + 1 WHERE id = $1`, postID)
		}
		return err
	})
}

// UnlikePost removes a reaction and decrements the post's like_count.
func (s *Store) UnlikePost(ctx context.Context, userID, postID string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			DELETE FROM reactions WHERE user_id = $1 AND post_id = $2
		`, userID, postID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			_, err = tx.Exec(ctx, `UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`, postID)
		}
		return err
	})
}

// CreateCommentAttachment links an object as a comment attachment.
func (s *Store) CreateCommentAttachment(ctx context.Context, commentID, objectID string, driveNodeID *string, name, mimeType string, sizeBytes int64, sortOrder int) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO comment_attachments (comment_id, object_id, drive_node_id, name, mime_type, size_bytes, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, commentID, objectID, driveNodeID, name, mimeType, sizeBytes, sortOrder)
	return err
}

// listCommentAttachments returns attachments for a list of comment IDs.
// Joins to storage_policies via objects so each row carries the resolved
// CDN URL when the policy has base_url configured.
func (s *Store) listCommentAttachments(ctx context.Context, commentIDs []string) (map[string][]model.PostAttachment, error) {
	if len(commentIDs) == 0 {
		return map[string][]model.PostAttachment{}, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT ca.id, ca.comment_id, ca.object_id, ca.drive_node_id,
		       ca.name, ca.mime_type, ca.size_bytes, ca.sort_order,
		       o.object_key,
		       COALESCE(sp.base_url, '') AS base_url
		FROM comment_attachments ca
		LEFT JOIN objects o ON o.id = ca.object_id
		LEFT JOIN storage_policies sp ON sp.id = o.policy_id
		WHERE ca.comment_id = ANY($1)
		ORDER BY ca.comment_id, ca.sort_order
	`, commentIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string][]model.PostAttachment)
	for rows.Next() {
		var (
			att       model.PostAttachment
			commentID string
			objectKey sql.NullString
			baseURL   sql.NullString
		)
		if err := rows.Scan(
			&att.ID, &commentID, &att.ObjectID, &att.DriveNodeID,
			&att.Name, &att.MimeType, &att.SizeBytes, &att.SortOrder,
			&objectKey, &baseURL,
		); err != nil {
			return nil, err
		}
		if baseURL.Valid && objectKey.Valid {
			att.URL = BuildAttachmentURL(baseURL.String, objectKey.String)
		}
		out[commentID] = append(out[commentID], att)
	}
	return out, rows.Err()
}

// LikeComment adds a reaction to a comment and increments the comment's like_count.
func (s *Store) LikeComment(ctx context.Context, userID, commentID string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO comment_reactions (user_id, comment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
		`, userID, commentID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			_, err = tx.Exec(ctx, `UPDATE comments SET like_count = like_count + 1 WHERE id = $1`, commentID)
		}
		return err
	})
}

// UnlikeComment removes a reaction from a comment and decrements the like_count.
func (s *Store) UnlikeComment(ctx context.Context, userID, commentID string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			DELETE FROM comment_reactions WHERE user_id = $1 AND comment_id = $2
		`, userID, commentID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			_, err = tx.Exec(ctx, `UPDATE comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`, commentID)
		}
		return err
	})
}

// ──────────────────────────────────────────────────────
// Comments
// ──────────────────────────────────────────────────────

// CreateComment adds a comment to a post and increments the comment_count.
func (s *Store) CreateComment(ctx context.Context, postID, authorID, content string, parentID *string) (*model.Comment, error) {
	var c model.Comment
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO comments (post_id, author_id, content, parent_id)
			VALUES ($1, $2, $3, $4)
			RETURNING id, post_id, author_id, parent_id, content, created_at
		`, postID, authorID, strings.TrimSpace(content), parentID).Scan(
			&c.ID, &c.PostID, &c.AuthorID, &c.ParentID, &c.Content, &c.CreatedAt,
		); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE posts SET comment_count = comment_count + 1, updated_at = NOW() WHERE id = $1`, postID)
		return err
	})
	if err != nil {
		return nil, err
	}
	author, err := s.GetUserByID(ctx, authorID)
	if err != nil {
		return nil, err
	}
	c.Author = author
	return &c, nil
}

// CommentSort describes comment sort options.
type CommentSort struct {
	By    string // "created_at" | "like_count"
	Order string // "asc" | "desc"
}

// ListComments returns top-level comments for a post with their flattened
// thread of replies (楼中楼 style). Only top-level comments (parent_id IS NULL)
// are paginated; every returned top-level comment carries its entire subtree of
// descendant replies in a single flat `Replies` slice, each reply carrying
// `ReplyToUser` set to the direct parent comment's author.
//
// Sort / cursor semantics match the old behaviour: when sorting by created_at
// the cursor is an RFC3339 timestamp; when sorting by like_count the cursor is
// an integer offset.
func (s *Store) ListComments(ctx context.Context, postID string, viewerID *string, sort CommentSort, params model.PageParams) (*model.PageResult[model.Comment], error) {
	limit := defaultPageLimit(params.Limit)

	// Validate sort
	sortBy := sort.By
	if sortBy != "like_count" && sortBy != "created_at" {
		sortBy = "created_at"
	}
	order := strings.ToUpper(sort.Order)
	if order != "ASC" && order != "DESC" {
		order = "DESC"
	}

	// ── Step 1: fetch paginated top-level comments ──────────────────────
	args := []any{postID}
	where := `WHERE c.post_id = $1 AND c.parent_id IS NULL`

	if params.Cursor != "" && sortBy == "created_at" {
		if t, err := time.Parse(time.RFC3339Nano, params.Cursor); err == nil {
			cmpOp := "<"
			if order == "ASC" {
				cmpOp = ">"
			}
			where += fmt.Sprintf(` AND c.created_at %s $%d`, cmpOp, len(args)+1)
			args = append(args, t)
		}
	}

	isLikedSelect := "FALSE AS is_liked"
	if viewerID != nil {
		args = append(args, *viewerID)
		isLikedSelect = fmt.Sprintf(`EXISTS(SELECT 1 FROM comment_reactions cr WHERE cr.comment_id = c.id AND cr.user_id = $%d) AS is_liked`, len(args))
	}

	args = append(args, limit+1)
	limitArg := len(args)

	offsetClause := ""
	if sortBy == "like_count" && params.Cursor != "" {
		var offset int
		if _, err := fmt.Sscanf(params.Cursor, "%d", &offset); err == nil && offset > 0 {
			args = append(args, offset)
			offsetClause = fmt.Sprintf(" OFFSET $%d", len(args))
		}
	}

	orderClause := fmt.Sprintf("ORDER BY c.%s %s, c.id %s", sortBy, order, order)

	query := fmt.Sprintf(`
		SELECT c.id, c.post_id, c.author_id, c.parent_id, c.content, c.like_count, c.created_at,
		       %s,
		       u.id, u.username, u.display_name, u.bio, u.role, u.avatar_object_id, u.avatar_data_url,
		       u.membership_ends_at, u.is_banned, u.created_at, u.updated_at
		FROM comments c
		JOIN users u ON u.id = c.author_id
		%s
		%s
		LIMIT $%d%s
	`, isLikedSelect, where, orderClause, limitArg, offsetClause)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.Comment, 0, limit)
	for rows.Next() {
		var c model.Comment
		var author model.User
		if err := rows.Scan(
			&c.ID, &c.PostID, &c.AuthorID, &c.ParentID, &c.Content, &c.LikeCount, &c.CreatedAt, &c.IsLiked,
			&author.ID, &author.Username, &author.DisplayName, &author.Bio, &author.Role,
			&author.AvatarObjectID, &author.AvatarDataURL, &author.MembershipEndsAt, &author.IsBanned,
			&author.CreatedAt, &author.UpdatedAt,
		); err != nil {
			return nil, err
		}
		author.ComputeIsVIP()
		c.Author = &author
		items = append(items, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := &model.PageResult[model.Comment]{Items: items}
	if len(items) > limit {
		result.Items = items[:limit]
		if sortBy == "created_at" {
			result.NextCursor = items[limit-1].CreatedAt.Format(time.RFC3339Nano)
		} else {
			currentOffset := 0
			if params.Cursor != "" {
				_, _ = fmt.Sscanf(params.Cursor, "%d", &currentOffset)
			}
			result.NextCursor = fmt.Sprintf("%d", currentOffset+limit)
		}
	}

	// ── Step 2: fetch all descendant replies for the top-level comments ─
	topLevelIDs := make([]string, 0, len(result.Items))
	for _, c := range result.Items {
		topLevelIDs = append(topLevelIDs, c.ID)
	}
	repliesByRoot, err := s.loadThreadReplies(ctx, topLevelIDs, viewerID)
	if err != nil {
		return nil, fmt.Errorf("load replies: %w", err)
	}
	for i := range result.Items {
		result.Items[i].Replies = repliesByRoot[result.Items[i].ID]
	}

	// ── Step 3: batch-load attachments for every comment (top + replies) ─
	allCommentIDs := make([]string, 0, len(result.Items)*2)
	for _, c := range result.Items {
		allCommentIDs = append(allCommentIDs, c.ID)
		for _, r := range c.Replies {
			allCommentIDs = append(allCommentIDs, r.ID)
		}
	}
	if attMap, err := s.listCommentAttachments(ctx, allCommentIDs); err == nil {
		for i := range result.Items {
			result.Items[i].Attachments = attMap[result.Items[i].ID]
			for j := range result.Items[i].Replies {
				result.Items[i].Replies[j].Attachments = attMap[result.Items[i].Replies[j].ID]
			}
		}
	}

	return result, nil
}

// loadThreadReplies fetches every descendant comment rooted at any of the
// given top-level comment IDs and returns them grouped by their root
// (top-level) ancestor. Each returned reply has its ReplyToUser populated
// with the author of its direct parent (unless the parent is the root itself,
// in which case ReplyToUser is left nil so the UI doesn't show a redundant
// "回复 @<author-of-this-thread>" prefix).
func (s *Store) loadThreadReplies(ctx context.Context, topLevelIDs []string, viewerID *string) (map[string][]model.Comment, error) {
	out := make(map[string][]model.Comment)
	if len(topLevelIDs) == 0 {
		return out, nil
	}

	args := []any{topLevelIDs}
	isLikedSelect := "FALSE AS is_liked"
	if viewerID != nil {
		args = append(args, *viewerID)
		isLikedSelect = fmt.Sprintf(`EXISTS(SELECT 1 FROM comment_reactions cr WHERE cr.comment_id = c.id AND cr.user_id = $%d) AS is_liked`, len(args))
	}

	// Recursive CTE: start from direct children of each top-level comment,
	// then walk down propagating the root_id. PostgreSQL + SQLite both
	// support this form of WITH RECURSIVE.
	query := fmt.Sprintf(`
		WITH RECURSIVE thread AS (
			SELECT c.id, c.parent_id, c.id AS root_id
			FROM comments c
			WHERE c.parent_id = ANY($1)
			UNION ALL
			SELECT c.id, c.parent_id, t.root_id
			FROM comments c
			JOIN thread t ON c.parent_id = t.id
		),
		thread_roots AS (
			SELECT t.id, c.parent_id AS direct_parent_id, cp.parent_id AS grandparent_id
			FROM thread t
			JOIN comments c ON c.id = t.id
			LEFT JOIN comments cp ON cp.id = c.parent_id
		)
		SELECT c.id, c.post_id, c.author_id, c.parent_id, c.content, c.like_count, c.created_at,
		       %s,
		       u.id, u.username, u.display_name, u.bio, u.role, u.avatar_object_id, u.avatar_data_url,
		       u.membership_ends_at, u.is_banned, u.created_at, u.updated_at,
		       pu.id, pu.username, pu.display_name, pu.bio, pu.role, pu.avatar_object_id, pu.avatar_data_url,
		       pu.membership_ends_at, pu.is_banned, pu.created_at, pu.updated_at,
		       t.root_id, tr.grandparent_id
		FROM thread t
		JOIN thread_roots tr ON tr.id = t.id
		JOIN comments c ON c.id = t.id
		JOIN users u ON u.id = c.author_id
		LEFT JOIN comments pc ON pc.id = c.parent_id
		LEFT JOIN users pu ON pu.id = pc.author_id
		ORDER BY c.created_at ASC, c.id ASC
	`, isLikedSelect)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			c              model.Comment
			author         model.User
			parentAuthor   model.User
			pAuthorID      sql.NullString
			pUsername      sql.NullString
			pDisplayName   sql.NullString
			pBio           sql.NullString
			pRole          sql.NullString
			pAvatarObjID   sql.NullString
			pAvatarDataURL sql.NullString
			pMembershipEnd sql.NullTime
			pIsBanned      sql.NullBool
			pCreatedAt     sql.NullTime
			pUpdatedAt     sql.NullTime
			rootID         string
			grandparentID  sql.NullString
		)
		if err := rows.Scan(
			&c.ID, &c.PostID, &c.AuthorID, &c.ParentID, &c.Content, &c.LikeCount, &c.CreatedAt, &c.IsLiked,
			&author.ID, &author.Username, &author.DisplayName, &author.Bio, &author.Role,
			&author.AvatarObjectID, &author.AvatarDataURL, &author.MembershipEndsAt, &author.IsBanned,
			&author.CreatedAt, &author.UpdatedAt,
			&pAuthorID, &pUsername, &pDisplayName, &pBio, &pRole,
			&pAvatarObjID, &pAvatarDataURL, &pMembershipEnd, &pIsBanned,
			&pCreatedAt, &pUpdatedAt,
			&rootID, &grandparentID,
		); err != nil {
			return nil, err
		}
		author.ComputeIsVIP()
		c.Author = &author

		// Populate ReplyToUser only when the direct parent isn't the
		// top-level root of this thread (i.e. this reply targets another
		// reply). We detect that by checking whether grandparent_id is
		// non-NULL – a reply whose parent has no parent is a direct child
		// of the top-level root.
		if grandparentID.Valid && pAuthorID.Valid {
			parentAuthor.ID = pAuthorID.String
			parentAuthor.Username = pUsername.String
			parentAuthor.DisplayName = pDisplayName.String
			if pBio.Valid {
				parentAuthor.Bio = pBio.String
			}
			parentAuthor.Role = pRole.String
			if pAvatarObjID.Valid {
				v := pAvatarObjID.String
				parentAuthor.AvatarObjectID = &v
			}
			if pAvatarDataURL.Valid {
				parentAuthor.AvatarDataURL = pAvatarDataURL.String
			}
			if pMembershipEnd.Valid {
				t := pMembershipEnd.Time
				parentAuthor.MembershipEndsAt = &t
			}
			if pIsBanned.Valid {
				parentAuthor.IsBanned = pIsBanned.Bool
			}
			if pCreatedAt.Valid {
				parentAuthor.CreatedAt = pCreatedAt.Time
			}
			if pUpdatedAt.Valid {
				parentAuthor.UpdatedAt = pUpdatedAt.Time
			}
			parentAuthor.ComputeIsVIP()
			c.ReplyToUser = &parentAuthor
		}

		out[rootID] = append(out[rootID], c)
	}
	return out, rows.Err()
}

// DeleteComment hard-deletes a comment. The comment author can delete their
// own comment; admins can delete any comment. The FK cascade drops any
// descendant replies automatically. The post's comment_count is decremented
// by the total number of deleted rows (self + descendants).
func (s *Store) DeleteComment(ctx context.Context, commentID, userID string, isAdmin bool) error {
	var postID, authorID string
	err := s.pool.QueryRow(ctx,
		`SELECT post_id, author_id FROM comments WHERE id = $1`,
		commentID,
	).Scan(&postID, &authorID)
	if err != nil {
		return maybeErrNoRows(err)
	}

	if !isAdmin && authorID != userID {
		return fmt.Errorf("not allowed")
	}

	// Count the total rows that will be removed (self + all descendants).
	var deletedCount int
	if err := s.pool.QueryRow(ctx, `
		WITH RECURSIVE thread AS (
			SELECT id FROM comments WHERE id = $1
			UNION ALL
			SELECT c.id FROM comments c JOIN thread t ON c.parent_id = t.id
		)
		SELECT COUNT(*) FROM thread
	`, commentID).Scan(&deletedCount); err != nil {
		return fmt.Errorf("count descendants: %w", err)
	}
	if deletedCount <= 0 {
		deletedCount = 1
	}

	return s.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM comments WHERE id = $1`, commentID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			UPDATE posts
			SET comment_count = GREATEST(0, comment_count - $1),
			    updated_at = NOW()
			WHERE id = $2
		`, deletedCount, postID)
		return err
	})
}

// ──────────────────────────────────────────────────────
// Follows
// ──────────────────────────────────────────────────────

// Follow adds a follow relationship.
func (s *Store) Follow(ctx context.Context, followerID, followeeID string) error {
	if followerID == followeeID {
		return nil
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
	`, followerID, followeeID)
	return err
}

// Unfollow removes a follow relationship.
func (s *Store) Unfollow(ctx context.Context, followerID, followeeID string) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2
	`, followerID, followeeID)
	return err
}

// IsFollowing checks whether followerID follows followeeID.
func (s *Store) IsFollowing(ctx context.Context, followerID, followeeID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2)
	`, followerID, followeeID).Scan(&exists)
	return exists, err
}

// ListFollowers returns the users who follow `userID`, paginated by follow
// created_at DESC. Each item carries an `is_following` flag indicating whether
// the viewer (usually `userID` itself) follows that user back.
func (s *Store) ListFollowers(ctx context.Context, userID string, params model.PageParams) (*model.PageResult[model.User], error) {
	return s.listFollowEdges(ctx, userID, params, true)
}

// ListFollowing returns the users that `userID` follows, paginated by follow
// created_at DESC. The `is_following` flag is always true for these rows.
func (s *Store) ListFollowing(ctx context.Context, userID string, params model.PageParams) (*model.PageResult[model.User], error) {
	return s.listFollowEdges(ctx, userID, params, false)
}

// listFollowEdges is shared by ListFollowers/ListFollowing. When `followers` is
// true, the result is users where followee_id = userID; otherwise, users where
// follower_id = userID.
func (s *Store) listFollowEdges(ctx context.Context, userID string, params model.PageParams, followers bool) (*model.PageResult[model.User], error) {
	limit := defaultPageLimit(params.Limit)

	// Pick the join column. For followers, we want the people whose
	// followee_id is the user; for following, the people whose follower_id is.
	var joinCol, otherCol string
	if followers {
		joinCol = "f.follower_id"
		otherCol = "f.followee_id"
	} else {
		joinCol = "f.followee_id"
		otherCol = "f.follower_id"
	}

	args := []any{userID}
	where := fmt.Sprintf(`WHERE %s = $1`, otherCol)

	if params.Cursor != "" {
		t, err := time.Parse(time.RFC3339Nano, params.Cursor)
		if err == nil {
			where += fmt.Sprintf(` AND f.created_at < $%d`, len(args)+1)
			args = append(args, t)
		}
	}

	args = append(args, limit+1)
	q := fmt.Sprintf(`
		SELECT u.id, u.username, u.display_name, u.bio, u.role, u.avatar_object_id,
		       u.avatar_data_url, u.membership_ends_at, u.is_banned, u.created_at, u.updated_at,
		       f.created_at AS follow_created_at,
		       EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = u.id) AS is_following
		FROM follows f
		JOIN users u ON u.id = %s
		%s
		ORDER BY f.created_at DESC
		LIMIT $%d
	`, joinCol, where, len(args))

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type edge struct {
		user      model.User
		createdAt time.Time
	}
	edges := make([]edge, 0, limit)
	for rows.Next() {
		var u model.User
		var followCreatedAt time.Time
		if err := rows.Scan(
			&u.ID, &u.Username, &u.DisplayName, &u.Bio, &u.Role, &u.AvatarObjectID,
			&u.AvatarDataURL, &u.MembershipEndsAt, &u.IsBanned, &u.CreatedAt, &u.UpdatedAt,
			&followCreatedAt, &u.IsFollowing,
		); err != nil {
			return nil, err
		}
		u.ComputeIsVIP()
		edges = append(edges, edge{user: u, createdAt: followCreatedAt})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	items := make([]model.User, 0, len(edges))
	for _, e := range edges {
		items = append(items, e.user)
	}

	result := &model.PageResult[model.User]{Items: items}
	if len(edges) > limit {
		result.Items = items[:limit]
		result.NextCursor = edges[limit-1].createdAt.Format(time.RFC3339Nano)
	}
	return result, nil
}

// GetUserProfile returns a user with follower/following counts and is_following relative to the viewer.
func (s *Store) GetUserProfile(ctx context.Context, username string, viewerID *string) (*model.User, error) {
	viewerVal := ""
	if viewerID != nil {
		viewerVal = *viewerID
	}

	var u model.User
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.username, u.display_name, u.bio, u.role, u.avatar_object_id, u.avatar_data_url,
		       u.wallet_balance_cents, u.storage_used_bytes, u.storage_quota_bytes,
		       u.upload_limit_bytes, u.membership_plan_id, u.membership_ends_at,
		       u.is_banned, u.created_at, u.updated_at,
		       (SELECT COUNT(*) FROM follows WHERE followee_id = u.id) AS follower_count,
		       (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) AS following_count,
		       (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND status = 'published') AS post_count,
		       EXISTS (SELECT 1 FROM follows WHERE follower_id = NULLIF($2, '')::uuid AND followee_id = u.id) AS is_following
		FROM users u
		WHERE u.username = $1
	`, username, viewerVal).Scan(
		&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.Bio, &u.Role, &u.AvatarObjectID, &u.AvatarDataURL,
		&u.WalletBalanceCents, &u.StorageUsedBytes, &u.StorageQuotaBytes,
		&u.UploadLimitBytes, &u.MembershipPlanID, &u.MembershipEndsAt,
		&u.IsBanned, &u.CreatedAt, &u.UpdatedAt,
		&u.FollowerCount, &u.FollowingCount, &u.PostCount, &u.IsFollowing,
	)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	u.ComputeIsVIP()
	return &u, nil
}

// ──────────────────────────────────────────────────────
// Reposts
// ──────────────────────────────────────────────────────

// Repost creates a new post with repost_of_id, stores the repost comment, and
// increments the original post's repost_count.
//
// If the user is reposting a post that itself is a repost (postID has its own
// repost_of_id), the new repost is anchored to the *original* post, not the
// intermediate one. This avoids deep "repost of a repost of a repost" chains
// and matches Twitter/X behaviour.
func (s *Store) Repost(ctx context.Context, userID, postID, content string) (*model.Post, error) {
	var newPost model.Post
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		// Resolve the original post ID. If postID is itself a repost, walk to its source.
		originalID := postID
		var parentRepostOf *string
		if err := tx.QueryRow(ctx, `
			SELECT repost_of_id FROM posts WHERE id = $1 AND status = 'published'
		`, postID).Scan(&parentRepostOf); err != nil {
			return maybeErrNoRows(err)
		}
		if parentRepostOf != nil && *parentRepostOf != "" {
			originalID = *parentRepostOf
		}

		// Disallow reposting one's own original post (consistent with previous behaviour).
		// We track reposts against the *original* so a user can only repost any chain once.
		tag, err := tx.Exec(ctx, `
			INSERT INTO reposts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
		`, userID, originalID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("already reposted")
		}

		// Increment the *original* post's repost_count, not the intermediate.
		if _, err := tx.Exec(ctx, `UPDATE posts SET repost_count = repost_count + 1 WHERE id = $1`, originalID); err != nil {
			return err
		}

		// Create the repost entry pointing at the original.
		return tx.QueryRow(ctx, `
			INSERT INTO posts (author_id, content, repost_of_id)
			VALUES ($1, $2, $3)
			RETURNING id, author_id, content, visibility, status, repost_of_id,
			          like_count, comment_count, repost_count, created_at, updated_at, edited_at
		`, userID, strings.TrimSpace(content), originalID).Scan(
			&newPost.ID, &newPost.AuthorID, &newPost.Content, &newPost.Visibility,
			&newPost.Status, &newPost.RepostOfID,
			&newPost.LikeCount, &newPost.CommentCount, &newPost.RepostCount,
			&newPost.CreatedAt, &newPost.UpdatedAt, &newPost.EditedAt,
		)
	})
	if err != nil {
		return nil, err
	}

	return s.GetPostByID(ctx, newPost.ID, &userID)
}

// ──────────────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────────────

// SearchUsers searches users by username or display_name using trigram similarity.
func (s *Store) SearchUsers(ctx context.Context, query string, params model.PageParams) (*model.PageResult[model.User], error) {
	limit := defaultPageLimit(params.Limit)
	query = strings.TrimSpace(query)

	args := []any{query}
	where := `WHERE (u.username % $1 OR u.display_name % $1 OR u.username ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')`
	if s.pool.Dialect() == appdb.DialectSQLite {
		where = `WHERE (u.username LIKE '%' || $1 || '%' OR u.display_name LIKE '%' || $1 || '%')`
	}

	if params.Cursor != "" {
		t, err := time.Parse(time.RFC3339Nano, params.Cursor)
		if err == nil {
			where += fmt.Sprintf(` AND u.created_at < $%d`, len(args)+1)
			args = append(args, t)
		}
	}

	args = append(args, limit+1)
	sql := fmt.Sprintf(`
		SELECT u.id, u.email, u.username, u.display_name, u.bio, u.role, u.avatar_object_id,
		       u.avatar_data_url, u.membership_ends_at, u.is_banned, u.created_at, u.updated_at
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
			&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.Bio, &u.Role, &u.AvatarObjectID,
			&u.AvatarDataURL, &u.MembershipEndsAt, &u.IsBanned, &u.CreatedAt, &u.UpdatedAt,
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

// ──────────────────────────────────────────────────────
// Reports
// ──────────────────────────────────────────────────────

// CreateReport files a new report.
func (s *Store) CreateReport(ctx context.Context, reporterID, targetType, targetID, reason string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO reports (reporter_id, target_type, target_id, reason)
		VALUES ($1, $2, $3, $4)
	`, reporterID, targetType, targetID, reason)
	return err
}

// ──────────────────────────────────────────────────────
// Topics
// ──────────────────────────────────────────────────────

var topicRe = regexp.MustCompile(`#([a-zA-Z\p{Han}\p{Katakana}\p{Hiragana}0-9_]+)#?`)

// ExtractAndLinkTopics parses #tags from content, upserts topics, and links them to the post.
func (s *Store) ExtractAndLinkTopics(ctx context.Context, postID, content string) error {
	matches := topicRe.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return nil
	}

	return s.withTx(ctx, func(tx pgx.Tx) error {
		for _, match := range matches {
			slug := strings.ToLower(match[1])
			title := "#" + match[1] + "#"

			var topicID string
			err := tx.QueryRow(ctx, `
				INSERT INTO topics (slug, title)
				VALUES ($1, $2)
				ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
				RETURNING id
			`, slug, title).Scan(&topicID)
			if err != nil {
				return err
			}

			if _, err := tx.Exec(ctx, `
				INSERT INTO post_topics (post_id, topic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
			`, postID, topicID); err != nil {
				return err
			}

			if _, err := tx.Exec(ctx, `
				UPDATE topics SET post_count = post_count + 1 WHERE id = $1
			`, topicID); err != nil {
				return err
			}
		}
		return nil
	})
}

// ──────────────────────────────────────────────────────
// Internal pagination helpers
// ──────────────────────────────────────────────────────

// Placeholder conventions for dynamic query building:
//   The "extra" args come first after the base query args,
//   then cursor, then limit.

const (
	postFeedColumns = `
		p.id, p.author_id, p.content, p.visibility, p.status, p.repost_of_id,
		p.like_count, p.comment_count, p.repost_count, p.view_count, p.created_at, p.updated_at, p.edited_at,
		u.id, u.username, u.display_name, u.bio, u.role, u.avatar_object_id, u.avatar_data_url,
		u.membership_ends_at, u.is_banned, u.created_at, u.updated_at
	`
	// These are just reference strings used in query building; actual numbers are computed dynamically.
	viewerPlaceholder = "VIEWER"
	extraPlaceholder  = "EXTRA"
)

// paginatedPostQuery runs a cursor-paginated post query.
// baseSQL must end before the cursor/order/limit clauses.
// extraArgs are additional args injected after any viewer arg.
func (s *Store) paginatedPostQuery(
	ctx context.Context,
	viewerID *string,
	params model.PageParams,
	baseSQL string,
	extraArgs []any,
) (*model.PageResult[model.Post], error) {
	limit := defaultPageLimit(params.Limit)

	// Build argument list and replace placeholders.
	args := make([]any, 0, len(extraArgs)+3)

	// Replace $EXTRA placeholders with the right positional argument.
	for i, arg := range extraArgs {
		args = append(args, arg)
		pos := fmt.Sprintf("$%d", i+1)
		baseSQL = strings.ReplaceAll(baseSQL, "$"+extraPlaceholder, pos)
		baseSQL = strings.ReplaceAll(baseSQL, "$"+viewerPlaceholder, pos)
	}

	// Cursor filter.
	cursorClause := ""
	if params.Cursor != "" {
		t, err := time.Parse(time.RFC3339Nano, params.Cursor)
		if err == nil {
			args = append(args, t)
			cursorClause = fmt.Sprintf(` AND p.created_at < $%d`, len(args))
		}
	}

	// Limit.
	args = append(args, limit+1)
	limitClause := fmt.Sprintf(` ORDER BY p.created_at DESC LIMIT $%d`, len(args))

	fullSQL := baseSQL + cursorClause + limitClause

	rows, err := s.pool.Query(ctx, fullSQL, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	posts, err := s.scanPostRows(ctx, rows, viewerID, 2)
	if err != nil {
		return nil, err
	}

	result := &model.PageResult[model.Post]{Items: posts}
	if len(posts) > limit {
		result.Items = posts[:limit]
		result.NextCursor = posts[limit-1].CreatedAt.Format(time.RFC3339Nano)
	}
	return result, nil
}

// scanPostRows scans rows produced by a query selecting postFeedColumns.
func (s *Store) scanPostRows(ctx context.Context, rows pgx.Rows, viewerID *string, repostDepth int) ([]model.Post, error) {
	posts := make([]model.Post, 0)
	postIDs := make([]string, 0)

	for rows.Next() {
		var p model.Post
		var author model.User
		if err := rows.Scan(
			&p.ID, &p.AuthorID, &p.Content, &p.Visibility, &p.Status, &p.RepostOfID,
			&p.LikeCount, &p.CommentCount, &p.RepostCount, &p.ViewCount, &p.CreatedAt, &p.UpdatedAt, &p.EditedAt,
			&author.ID, &author.Username, &author.DisplayName, &author.Bio, &author.Role,
			&author.AvatarObjectID, &author.AvatarDataURL, &author.MembershipEndsAt, &author.IsBanned,
			&author.CreatedAt, &author.UpdatedAt,
		); err != nil {
			return nil, err
		}
		author.ComputeIsVIP()
		p.Author = &author
		posts = append(posts, p)
		postIDs = append(postIDs, p.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Batch-load attachments.
	if len(postIDs) > 0 {
		attMap, err := s.attachmentsForPosts(ctx, postIDs)
		if err == nil {
			for i := range posts {
				posts[i].Attachments = attMap[posts[i].ID]
			}
		}
	}

	// Batch-load topics.
	if len(postIDs) > 0 {
		topicMap, err := s.topicsForPosts(ctx, postIDs)
		if err == nil {
			for i := range posts {
				posts[i].Topics = topicMap[posts[i].ID]
			}
		}
	}

	// Batch-load viewer-aware is_liked / is_reposted flags.
	if len(postIDs) > 0 && viewerID != nil && *viewerID != "" {
		liked, reposted, err := s.viewerReactionsForPosts(ctx, *viewerID, postIDs)
		if err == nil {
			for i := range posts {
				posts[i].IsLiked = liked[posts[i].ID]
				posts[i].IsReposted = reposted[posts[i].ID]
			}
		}
	}

	if repostDepth > 0 {
		if err := s.hydrateRepostReferences(ctx, posts, viewerID, repostDepth); err != nil {
			return nil, err
		}
	}

	return posts, nil
}

func (s *Store) loadPostsByIDs(ctx context.Context, postIDs []string, viewerID *string, repostDepth int) (map[string]*model.Post, error) {
	out := make(map[string]*model.Post, len(postIDs))
	if len(postIDs) == 0 {
		return out, nil
	}

	args := make([]any, 0, len(postIDs))
	placeholders := make([]string, 0, len(postIDs))
	for i, postID := range postIDs {
		args = append(args, postID)
		placeholders = append(placeholders, fmt.Sprintf("$%d", i+1))
	}

	rows, err := s.pool.Query(ctx, `
		SELECT `+postFeedColumns+`
		FROM posts p
		JOIN users u ON u.id = p.author_id
		WHERE p.id IN (`+strings.Join(placeholders, ", ")+`)
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	posts, err := s.scanPostRows(ctx, rows, viewerID, repostDepth)
	if err != nil {
		return nil, err
	}
	for i := range posts {
		out[posts[i].ID] = &posts[i]
	}
	return out, nil
}

func (s *Store) hydrateRepostReferences(ctx context.Context, posts []model.Post, viewerID *string, depth int) error {
	if depth <= 0 || len(posts) == 0 {
		return nil
	}

	ids := make([]string, 0, len(posts))
	seen := make(map[string]struct{}, len(posts))
	for i := range posts {
		if posts[i].RepostOfID == nil || *posts[i].RepostOfID == "" {
			continue
		}
		if _, ok := seen[*posts[i].RepostOfID]; ok {
			continue
		}
		seen[*posts[i].RepostOfID] = struct{}{}
		ids = append(ids, *posts[i].RepostOfID)
	}
	if len(ids) == 0 {
		return nil
	}

	repostMap, err := s.loadPostsByIDs(ctx, ids, viewerID, depth-1)
	if err != nil {
		return err
	}

	for i := range posts {
		if posts[i].RepostOfID == nil {
			continue
		}
		posts[i].RepostOf = repostMap[*posts[i].RepostOfID]
	}

	return nil
}

// viewerReactionsForPosts returns two sets indicating which posts the viewer has
// liked or reposted, restricted to the given postIDs.
func (s *Store) viewerReactionsForPosts(ctx context.Context, viewerID string, postIDs []string) (map[string]bool, map[string]bool, error) {
	liked := make(map[string]bool, len(postIDs))
	reposted := make(map[string]bool, len(postIDs))
	if len(postIDs) == 0 || viewerID == "" {
		return liked, reposted, nil
	}

	likeRows, err := s.pool.Query(ctx, `
		SELECT post_id::text FROM reactions
		WHERE user_id = $1::uuid AND post_id = ANY($2::uuid[])
	`, viewerID, postIDs)
	if err != nil {
		return liked, reposted, err
	}
	for likeRows.Next() {
		var pid string
		if err := likeRows.Scan(&pid); err != nil {
			likeRows.Close()
			return liked, reposted, err
		}
		liked[pid] = true
	}
	likeRows.Close()

	repostRows, err := s.pool.Query(ctx, `
		SELECT post_id::text FROM reposts
		WHERE user_id = $1::uuid AND post_id = ANY($2::uuid[])
	`, viewerID, postIDs)
	if err != nil {
		return liked, reposted, err
	}
	for repostRows.Next() {
		var pid string
		if err := repostRows.Scan(&pid); err != nil {
			repostRows.Close()
			return liked, reposted, err
		}
		reposted[pid] = true
	}
	repostRows.Close()

	return liked, reposted, nil
}

// attachmentsForPosts batch-loads attachments for a list of post IDs.
// Joins through objects → storage_policies so each row carries the base_url
// needed to compute the direct/CDN URL via store.BuildAttachmentURL — clients
// can render <img src=...> directly when the policy has a CDN configured.
//
// pa.source_deleted is maintained by the trash/restore/purge code paths in
// store/drive.go; when it (or objects.status='deleted' for admin-side global
// removals) is set the renderer shows a 已删除 placeholder instead of a
// download button.
func (s *Store) attachmentsForPosts(ctx context.Context, postIDs []string) (map[string][]model.PostAttachment, error) {
	out := make(map[string][]model.PostAttachment)
	if len(postIDs) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT pa.post_id, pa.id, pa.object_id, pa.drive_node_id,
		       pa.name, pa.mime_type, pa.size_bytes, pa.sort_order,
		       o.object_key,
		       COALESCE(sp.base_url, '') AS base_url,
		       COALESCE(o.status, 'active') AS object_status,
		       pa.source_deleted
		FROM post_attachments pa
		LEFT JOIN objects o ON o.id = pa.object_id
		LEFT JOIN storage_policies sp ON sp.id = o.policy_id
		WHERE pa.post_id = ANY($1)
		ORDER BY pa.sort_order ASC, pa.created_at ASC
	`, postIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			postID        string
			att           model.PostAttachment
			objectKey     sql.NullString
			baseURL       sql.NullString
			objectStatus  string
			sourceDeleted bool
		)
		if err := rows.Scan(
			&postID, &att.ID, &att.ObjectID, &att.DriveNodeID,
			&att.Name, &att.MimeType, &att.SizeBytes, &att.SortOrder,
			&objectKey, &baseURL,
			&objectStatus, &sourceDeleted,
		); err != nil {
			return nil, err
		}
		att.PostID = postID
		if baseURL.Valid && objectKey.Valid {
			att.URL = BuildAttachmentURL(baseURL.String, objectKey.String)
		}
		if sourceDeleted || objectStatus == "deleted" {
			att.IsDeleted = true
			att.URL = ""
		}
		out[postID] = append(out[postID], att)
	}
	return out, rows.Err()
}

// RefreshTrendingScores recalculates trending scores for recent posts.
// Score = (like*3 + comment*5 + repost*8 + view*0.5) / age-decay.
func (s *Store) RefreshTrendingScores(ctx context.Context) error {
	var query string
	if s.pool.Dialect() == appdb.DialectSQLite {
		query = `
			INSERT OR REPLACE INTO trending_scores (post_id, score_24h, score_7d, updated_at)
			SELECT
				p.id,
				CAST(p.like_count * 3 + p.comment_count * 5 + p.repost_count * 8 + p.view_count * 0.5 AS REAL)
					/ MAX((julianday('now') - julianday(p.created_at)) * 24, 1),
				CAST(p.like_count * 3 + p.comment_count * 5 + p.repost_count * 8 + p.view_count * 0.5 AS REAL)
					/ MAX(julianday('now') - julianday(p.created_at), 1),
				datetime('now')
			FROM posts p
			WHERE p.status = 'published'
			  AND p.visibility = 'public'
			  AND p.created_at > datetime('now', '-7 days')
		`
	} else {
		query = `
			INSERT INTO trending_scores (post_id, score_24h, score_7d, updated_at)
			SELECT
				p.id,
				(p.like_count * 3 + p.comment_count * 5 + p.repost_count * 8 + p.view_count * 0.5)::double precision
					/ GREATEST(EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600, 1),
				(p.like_count * 3 + p.comment_count * 5 + p.repost_count * 8 + p.view_count * 0.5)::double precision
					/ GREATEST(EXTRACT(EPOCH FROM (now() - p.created_at)) / 86400, 1),
				now()
			FROM posts p
			WHERE p.status = 'published'
			  AND p.visibility = 'public'
			  AND p.created_at > now() - INTERVAL '7 days'
			ON CONFLICT (post_id) DO UPDATE
			SET score_24h = EXCLUDED.score_24h,
				score_7d = EXCLUDED.score_7d,
				updated_at = now()
		`
	}
	_, err := s.pool.Exec(ctx, query)
	return err
}

// ──────────────────────────────────────────────────────
// Post views
// ──────────────────────────────────────────────────────

// RecordPostView increments view_count for a post the first time the given
// viewerKey is seen within the dedup window. Returns true if this view counted.
func (s *Store) RecordPostView(ctx context.Context, postID, viewerKey string) (bool, error) {
	if postID == "" || viewerKey == "" {
		return false, nil
	}
	var counted bool
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		var insertSQL string
		if s.pool.Dialect() == appdb.DialectSQLite {
			insertSQL = `INSERT OR IGNORE INTO post_views (post_id, viewer_key) VALUES ($1, $2)`
		} else {
			insertSQL = `INSERT INTO post_views (post_id, viewer_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`
		}
		tag, err := tx.Exec(ctx, insertSQL, postID, viewerKey)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		counted = true
		_, err = tx.Exec(ctx, `UPDATE posts SET view_count = view_count + 1 WHERE id = $1`, postID)
		return err
	})
	return counted, err
}

// CleanupOldPostViews removes post_views rows older than 24 hours so the dedup
// window slides forward and the table doesn't grow unbounded.
func (s *Store) CleanupOldPostViews(ctx context.Context) error {
	var query string
	if s.pool.Dialect() == appdb.DialectSQLite {
		query = `DELETE FROM post_views WHERE viewed_at < datetime('now', '-24 hours')`
	} else {
		query = `DELETE FROM post_views WHERE viewed_at < now() - INTERVAL '24 hours'`
	}
	_, err := s.pool.Exec(ctx, query)
	return err
}

// ──────────────────────────────────────────────────────
// Topic loading & follows
// ──────────────────────────────────────────────────────

// topicsForPosts batch-loads topics for a list of post IDs.
func (s *Store) topicsForPosts(ctx context.Context, postIDs []string) (map[string][]model.Topic, error) {
	out := make(map[string][]model.Topic)
	if len(postIDs) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT pt.post_id, t.id, t.slug, t.title, t.description,
		       t.post_count, t.follower_count, t.cover_url, t.is_banned, t.created_at
		FROM post_topics pt
		JOIN topics t ON t.id = pt.topic_id
		WHERE pt.post_id = ANY($1)
		ORDER BY t.post_count DESC
	`, postIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var postID string
		var t model.Topic
		if err := rows.Scan(
			&postID, &t.ID, &t.Slug, &t.Title, &t.Description,
			&t.PostCount, &t.FollowerCount, &t.CoverURL, &t.IsBanned, &t.CreatedAt,
		); err != nil {
			return nil, err
		}
		out[postID] = append(out[postID], t)
	}
	return out, rows.Err()
}

// GetTopicBySlug returns a topic by its slug. If viewerID is non-nil, the
// returned Topic.IsFollowing reflects whether that user follows the topic.
func (s *Store) GetTopicBySlug(ctx context.Context, slug string, viewerID *string) (*model.Topic, error) {
	var t model.Topic
	err := s.pool.QueryRow(ctx, `
		SELECT id, slug, title, description, post_count, follower_count, cover_url, is_banned, created_at
		FROM topics
		WHERE slug = $1
	`, strings.ToLower(slug)).Scan(
		&t.ID, &t.Slug, &t.Title, &t.Description, &t.PostCount, &t.FollowerCount, &t.CoverURL, &t.IsBanned, &t.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	if viewerID != nil && *viewerID != "" {
		var exists int
		_ = s.pool.QueryRow(ctx, `
			SELECT 1 FROM user_topic_follows WHERE user_id = $1 AND topic_id = $2
		`, *viewerID, t.ID).Scan(&exists)
		t.IsFollowing = exists == 1
	}
	return &t, nil
}

// FollowTopic adds a user→topic follow link and increments follower_count.
func (s *Store) FollowTopic(ctx context.Context, userID, topicID string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		var insertSQL string
		if s.pool.Dialect() == appdb.DialectSQLite {
			insertSQL = `INSERT OR IGNORE INTO user_topic_follows (user_id, topic_id) VALUES ($1, $2)`
		} else {
			insertSQL = `INSERT INTO user_topic_follows (user_id, topic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`
		}
		tag, err := tx.Exec(ctx, insertSQL, userID, topicID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			_, err = tx.Exec(ctx, `UPDATE topics SET follower_count = follower_count + 1 WHERE id = $1`, topicID)
		}
		return err
	})
}

// UnfollowTopic removes a user→topic follow link and decrements follower_count.
func (s *Store) UnfollowTopic(ctx context.Context, userID, topicID string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			DELETE FROM user_topic_follows WHERE user_id = $1 AND topic_id = $2
		`, userID, topicID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			_, err = tx.Exec(ctx, `
				UPDATE topics SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = $1
			`, topicID)
		}
		return err
	})
}

// SuggestTopics returns topics whose slug or title contains the given prefix,
// ordered by post_count desc. Used by search suggestions and PostComposer
// #tag# autocomplete.
func (s *Store) SuggestTopics(ctx context.Context, prefix string, limit int) ([]model.Topic, error) {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		// Surface the most active topics overall when no prefix.
		return s.listTopTopics(ctx, limit)
	}
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	pattern := "%" + strings.ToLower(prefix) + "%"
	rows, err := s.pool.Query(ctx, `
		SELECT id, slug, title, description, post_count, follower_count, cover_url, is_banned, created_at
		FROM topics
		WHERE (LOWER(slug) LIKE $1 OR LOWER(title) LIKE $1) AND is_banned = FALSE
		ORDER BY post_count DESC, follower_count DESC
		LIMIT $2
	`, pattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTopics(rows)
}

func (s *Store) listTopTopics(ctx context.Context, limit int) ([]model.Topic, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, slug, title, description, post_count, follower_count, cover_url, is_banned, created_at
		FROM topics
		WHERE is_banned = FALSE
		ORDER BY post_count DESC, follower_count DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTopics(rows)
}

func scanTopics(rows pgx.Rows) ([]model.Topic, error) {
	out := make([]model.Topic, 0)
	for rows.Next() {
		var t model.Topic
		if err := rows.Scan(
			&t.ID, &t.Slug, &t.Title, &t.Description, &t.PostCount,
			&t.FollowerCount, &t.CoverURL, &t.IsBanned, &t.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ──────────────────────────────────────────────────────
// Hot search board
// ──────────────────────────────────────────────────────

// HotSearchInput is the editable shape for upserting a hot search entry.
type HotSearchInput struct {
	ID         string
	Keyword    string
	LinkType   string
	LinkValue  string
	PinnedRank *int
	Hidden     bool
	Score      float64
	Source     string
}

// ListHotSearches returns hot search entries ordered by pinned rank then score.
// Pinned rows come first (1..N), then auto/manual rows by score desc.
func (s *Store) ListHotSearches(ctx context.Context, limit int, includeHidden bool) ([]model.HotSearch, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	hiddenClause := "WHERE hidden = FALSE"
	if includeHidden {
		hiddenClause = ""
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, keyword, link_type, link_value, score, pinned_rank, hidden, source, updated_at, created_at
		FROM hot_searches
		`+hiddenClause+`
		ORDER BY (pinned_rank IS NULL), pinned_rank ASC, score DESC, created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.HotSearch, 0)
	for rows.Next() {
		var h model.HotSearch
		if err := rows.Scan(
			&h.ID, &h.Keyword, &h.LinkType, &h.LinkValue, &h.Score, &h.PinnedRank,
			&h.Hidden, &h.Source, &h.UpdatedAt, &h.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, h)
	}
	return items, rows.Err()
}

// UpsertHotSearch creates or updates a manual hot search entry. If in.ID is
// empty a new row is inserted; otherwise the existing row is updated.
func (s *Store) UpsertHotSearch(ctx context.Context, in HotSearchInput) (*model.HotSearch, error) {
	if in.Source == "" {
		in.Source = "manual"
	}
	if in.LinkType == "" {
		in.LinkType = "topic"
	}
	var h model.HotSearch
	if in.ID == "" {
		err := s.pool.QueryRow(ctx, `
			INSERT INTO hot_searches (keyword, link_type, link_value, score, pinned_rank, hidden, source, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, now())
			RETURNING id, keyword, link_type, link_value, score, pinned_rank, hidden, source, updated_at, created_at
		`, in.Keyword, in.LinkType, in.LinkValue, in.Score, in.PinnedRank, in.Hidden, in.Source).Scan(
			&h.ID, &h.Keyword, &h.LinkType, &h.LinkValue, &h.Score, &h.PinnedRank,
			&h.Hidden, &h.Source, &h.UpdatedAt, &h.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		return &h, nil
	}
	err := s.pool.QueryRow(ctx, `
		UPDATE hot_searches
		SET keyword = $2, link_type = $3, link_value = $4, score = $5,
		    pinned_rank = $6, hidden = $7, updated_at = now()
		WHERE id = $1
		RETURNING id, keyword, link_type, link_value, score, pinned_rank, hidden, source, updated_at, created_at
	`, in.ID, in.Keyword, in.LinkType, in.LinkValue, in.Score, in.PinnedRank, in.Hidden).Scan(
		&h.ID, &h.Keyword, &h.LinkType, &h.LinkValue, &h.Score, &h.PinnedRank,
		&h.Hidden, &h.Source, &h.UpdatedAt, &h.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

// DeleteHotSearch removes a hot search entry by ID.
func (s *Store) DeleteHotSearch(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM hot_searches WHERE id = $1`, id)
	return err
}

// RecomputeHotSearches refreshes auto-source hot search rows from current
// topic activity. Manual rows (source='manual') are preserved untouched.
func (s *Store) RecomputeHotSearches(ctx context.Context) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM hot_searches WHERE source = 'auto'`); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT slug, title, post_count
			FROM topics
			WHERE post_count > 0
			ORDER BY post_count DESC, follower_count DESC
			LIMIT 50
		`)
		if err != nil {
			return err
		}
		type topicRow struct {
			slug      string
			title     string
			postCount int
		}
		batch := make([]topicRow, 0, 50)
		for rows.Next() {
			var r topicRow
			if err := rows.Scan(&r.slug, &r.title, &r.postCount); err != nil {
				rows.Close()
				return err
			}
			batch = append(batch, r)
		}
		rows.Close()

		for _, r := range batch {
			if _, err := tx.Exec(ctx, `
				INSERT INTO hot_searches (keyword, link_type, link_value, score, source, updated_at)
				VALUES ($1, 'topic', $2, $3, 'auto', now())
			`, r.title, r.slug, float64(r.postCount)); err != nil {
				return err
			}
		}
		return nil
	})
}
