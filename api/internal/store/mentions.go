package store

import (
	"context"
	"regexp"
	"strings"
)

var mentionRE = regexp.MustCompile(`@([a-z][a-z0-9_]{1,29})`)

// NotifyMentions parses @username tokens in content and creates "mention"
// notifications for each valid, non-self mentioned user.
// postID is the post the content belongs to (for comments: use the parent post ID).
// Best-effort — all errors are silently discarded.
func (s *Store) NotifyMentions(ctx context.Context, content, authorID, postID string) {
	matches := mentionRE.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return
	}
	seen := make(map[string]bool)
	for _, m := range matches {
		username := strings.ToLower(m[1])
		if seen[username] {
			continue
		}
		seen[username] = true
		user, err := s.GetUserByUsername(ctx, username)
		if err != nil || user.ID == authorID {
			continue
		}
		_ = s.CreateNotification(ctx, user.ID, "mention", &authorID, &postID, "在内容中提到了你")
	}
}
