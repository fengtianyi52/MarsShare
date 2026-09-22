package store

import "context"

// CanViewerAccessObject reports whether the viewer may access the object
// through the generic /api/files/:id/* endpoints.
//
// Access is granted when any of these conditions is true:
//   - the viewer has at least one drive node pointing at the object
//     (covers normal drive files, trashed files, and deduplicated objects)
//   - the object is attached to a published post the viewer can see
//   - the object is attached to a comment under a published post the viewer can see
//
// A nil/empty viewerID means anonymous access, which is limited to objects
// attached to public published posts/comments.
func (s *Store) CanViewerAccessObject(ctx context.Context, objectID string, viewerID *string) (bool, error) {
	if objectID == "" {
		return false, nil
	}

	if viewerID != nil && *viewerID != "" {
		var ownNode bool
		if err := s.pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1
				FROM drive_nodes
				WHERE object_id = $1 AND user_id = $2
			)
		`, objectID, *viewerID).Scan(&ownNode); err != nil {
			return false, err
		}
		if ownNode {
			return true, nil
		}
	}

	ok, err := s.canViewerAccessPostAttachmentObject(ctx, objectID, viewerID)
	if err != nil {
		return false, err
	}
	if ok {
		return true, nil
	}

	return s.canViewerAccessCommentAttachmentObject(ctx, objectID, viewerID)
}

func (s *Store) canViewerAccessPostAttachmentObject(ctx context.Context, objectID string, viewerID *string) (bool, error) {
	var exists bool
	if viewerID != nil && *viewerID != "" {
		err := s.pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1
				FROM post_attachments pa
				JOIN posts p ON p.id = pa.post_id
				WHERE pa.object_id = $1
				  AND p.status = 'published'
				  AND (
					p.visibility = 'public'
					OR p.author_id = $2
					OR (
						p.visibility = 'followers'
						AND EXISTS (
							SELECT 1
							FROM follows f
							WHERE f.follower_id = $2
							  AND f.followee_id = p.author_id
						)
					)
				  )
			)
		`, objectID, *viewerID).Scan(&exists)
		return exists, err
	}

	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM post_attachments pa
			JOIN posts p ON p.id = pa.post_id
			WHERE pa.object_id = $1
			  AND p.status = 'published'
			  AND p.visibility = 'public'
		)
	`, objectID).Scan(&exists)
	return exists, err
}

func (s *Store) canViewerAccessCommentAttachmentObject(ctx context.Context, objectID string, viewerID *string) (bool, error) {
	var exists bool
	if viewerID != nil && *viewerID != "" {
		err := s.pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1
				FROM comment_attachments ca
				JOIN comments c ON c.id = ca.comment_id
				JOIN posts p ON p.id = c.post_id
				WHERE ca.object_id = $1
				  AND p.status = 'published'
				  AND (
					p.visibility = 'public'
					OR p.author_id = $2
					OR (
						p.visibility = 'followers'
						AND EXISTS (
							SELECT 1
							FROM follows f
							WHERE f.follower_id = $2
							  AND f.followee_id = p.author_id
						)
					)
				  )
			)
		`, objectID, *viewerID).Scan(&exists)
		return exists, err
	}

	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM comment_attachments ca
			JOIN comments c ON c.id = ca.comment_id
			JOIN posts p ON p.id = c.post_id
			WHERE ca.object_id = $1
			  AND p.status = 'published'
			  AND p.visibility = 'public'
		)
	`, objectID).Scan(&exists)
	return exists, err
}
