package store

import (
	"context"
	"fmt"
	"time"

	"github.com/marsshare/api/internal/model"
)

// CreateNotification inserts a notification. If actorID equals userID, the notification is skipped.
func (s *Store) CreateNotification(ctx context.Context, userID, nType string, actorID *string, postID *string, message string) error {
	if actorID != nil && *actorID == userID {
		return nil // don't notify yourself
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO notifications (user_id, type, actor_id, post_id, message)
		VALUES ($1, $2, $3, $4, $5)
	`, userID, nType, actorID, postID, message)
	return err
}

// ListNotifications returns notifications for a user with cursor pagination, joining the actor user.
func (s *Store) ListNotifications(ctx context.Context, userID string, params model.PageParams) (*model.PageResult[model.Notification], error) {
	limit := defaultPageLimit(params.Limit)
	args := []any{userID}
	where := `WHERE n.user_id = $1`

	if params.Cursor != "" {
		t, err := time.Parse(time.RFC3339Nano, params.Cursor)
		if err == nil {
			args = append(args, t)
			where += fmt.Sprintf(` AND n.created_at < $%d`, len(args))
		}
	}

	args = append(args, limit+1)
	sql := fmt.Sprintf(`
		SELECT n.id, n.user_id, n.type, n.actor_id, n.post_id, n.message, n.read_at, n.created_at,
		       a.id, a.username, a.display_name, a.avatar_object_id, a.avatar_data_url, a.is_banned
		FROM notifications n
		LEFT JOIN users a ON a.id = n.actor_id
		%s
		ORDER BY n.created_at DESC
		LIMIT $%d
	`, where, len(args))

	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.Notification, 0, limit)
	for rows.Next() {
		var notif model.Notification
		var actorID, actorUsername, actorDisplayName *string
		var actorAvatarObjectID *string
		var actorAvatarDataURL *string
		var actorIsBanned *bool
		if err := rows.Scan(
			&notif.ID, &notif.UserID, &notif.Type, &notif.ActorID, &notif.PostID,
			&notif.Message, &notif.ReadAt, &notif.CreatedAt,
			&actorID, &actorUsername, &actorDisplayName, &actorAvatarObjectID, &actorAvatarDataURL, &actorIsBanned,
		); err != nil {
			return nil, err
		}
		if actorID != nil {
			notif.Actor = &model.User{
				ID:             *actorID,
				AvatarObjectID: actorAvatarObjectID,
			}
			if actorUsername != nil {
				notif.Actor.Username = *actorUsername
			}
			if actorDisplayName != nil {
				notif.Actor.DisplayName = *actorDisplayName
			}
			if actorAvatarDataURL != nil {
				notif.Actor.AvatarDataURL = *actorAvatarDataURL
			}
			if actorIsBanned != nil {
				notif.Actor.IsBanned = *actorIsBanned
			}
		}
		items = append(items, notif)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := &model.PageResult[model.Notification]{Items: items}
	if len(items) > limit {
		result.Items = items[:limit]
		result.NextCursor = items[limit-1].CreatedAt.Format(time.RFC3339Nano)
	}
	return result, nil
}

// MarkNotificationRead marks a single notification as read.
func (s *Store) MarkNotificationRead(ctx context.Context, notifID, userID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL
	`, notifID, userID)
	return err
}

// MarkAllNotificationsRead marks all unread notifications for a user as read.
func (s *Store) MarkAllNotificationsRead(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL
	`, userID)
	return err
}

// CountUnreadNotifications returns the number of unread notifications for a user.
func (s *Store) CountUnreadNotifications(ctx context.Context, userID string) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL
	`, userID).Scan(&count)
	return count, err
}
