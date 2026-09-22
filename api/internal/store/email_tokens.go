package store

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	TokenTypeEmailVerification = "email_verification"
	TokenTypePasswordReset     = "password_reset"
)

// CreateEmailToken invalidates any existing unused tokens of the same type
// for the user, then creates a new one. Returns the raw token string.
func (s *Store) CreateEmailToken(ctx context.Context, userID, tokenType string, expiresAt time.Time) (string, error) {
	// Generate a URL-safe 64-char opaque token
	token := strings.ReplaceAll(uuid.NewString(), "-", "") +
		strings.ReplaceAll(uuid.NewString(), "-", "")

	// Invalidate existing unused tokens of this type for the user
	_, err := s.pool.Exec(ctx, `
		DELETE FROM email_tokens
		WHERE user_id = $1 AND token_type = $2 AND used_at IS NULL
	`, userID, tokenType)
	if err != nil {
		return "", err
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO email_tokens (user_id, token, token_type, expires_at)
		VALUES ($1, $2, $3, $4)
	`, userID, token, tokenType, expiresAt)
	if err != nil {
		return "", err
	}
	return token, nil
}

// UseEmailToken atomically validates and marks a token as used.
// Returns the associated user_id on success, sql.ErrNoRows if not found/expired/used.
func (s *Store) UseEmailToken(ctx context.Context, token, tokenType string) (string, error) {
	var userID string
	err := s.pool.QueryRow(ctx, `
		UPDATE email_tokens
		SET used_at = NOW()
		WHERE token = $1
		  AND token_type = $2
		  AND used_at IS NULL
		  AND expires_at > NOW()
		RETURNING user_id
	`, token, tokenType).Scan(&userID)
	if err != nil {
		return "", maybeErrNoRows(err)
	}
	return userID, nil
}

// MarkEmailVerified sets email_verified = true for the given user.
func (s *Store) MarkEmailVerified(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users
		SET email_verified = TRUE, email_verified_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, userID)
	return err
}

// CleanupExpiredEmailTokens removes tokens that are expired or already used.
func (s *Store) CleanupExpiredEmailTokens(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM email_tokens
		WHERE expires_at < NOW() OR used_at IS NOT NULL
	`)
	return err
}
