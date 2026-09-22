package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/marsshare/api/internal/model"
)

var (
	ErrEmailAlreadyRegistered = errors.New("该邮箱已注册，请直接登录")
	ErrUsernameAlreadyTaken   = errors.New("用户名已占用，请重试")
	ErrInvalidCredentials     = errors.New("invalid credentials")
)

// ──────────────────────────────────────────────────────
// User CRUD
// ──────────────────────────────────────────────────────

// CreateUser inserts a new user and returns it. Default storage quotas
// come from the configurable system settings (set_default_storage_quota_bytes /
// _upload_limit_bytes), falling back to compile-time constants when unset.
func (s *Store) CreateUser(ctx context.Context, email, username, displayName, passwordHash string) (*model.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	storageQuota, uploadLimit := s.GetDefaultUserQuotas(ctx)
	var u model.User
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (email, username, display_name, password_hash, storage_quota_bytes, upload_limit_bytes)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, email, username, display_name, bio, role, avatar_object_id, avatar_data_url,
		          wallet_balance_cents, storage_used_bytes, storage_quota_bytes,
		          upload_limit_bytes, membership_plan_id, membership_ends_at,
		          is_banned, is_muted, muted_until, email_verified, created_at, updated_at
	`, email, username, displayName, passwordHash, storageQuota, uploadLimit).Scan(
		&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.Bio, &u.Role, &u.AvatarObjectID, &u.AvatarDataURL,
		&u.WalletBalanceCents, &u.StorageUsedBytes, &u.StorageQuotaBytes,
		&u.UploadLimitBytes, &u.MembershipPlanID, &u.MembershipEndsAt,
		&u.IsBanned, &u.IsMuted, &u.MutedUntil, &u.EmailVerified, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, normalizeUserInsertError(err)
	}
	u.ComputeIsVIP()
	return &u, nil
}

func normalizeUserInsertError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		switch pgErr.ConstraintName {
		case "users_email_key":
			return ErrEmailAlreadyRegistered
		case "users_username_key":
			return ErrUsernameAlreadyTaken
		default:
			return ErrEmailAlreadyRegistered
		}
	}
	return err
}

// GetUserByEmail returns a user by email address.
func (s *Store) GetUserByEmail(ctx context.Context, email string) (*model.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	return s.scanFullUser(s.pool.QueryRow(ctx, userSelectSQL+` WHERE u.email = $1`, email))
}

// GetUserByUsername returns a user by username (case-insensitive).
func (s *Store) GetUserByUsername(ctx context.Context, username string) (*model.User, error) {
	return s.scanFullUser(s.pool.QueryRow(ctx, userSelectSQL+` WHERE LOWER(u.username) = LOWER($1)`, username))
}

// GetUserByID returns a user by ID.
func (s *Store) GetUserByID(ctx context.Context, id string) (*model.User, error) {
	return s.scanFullUser(s.pool.QueryRow(ctx, userSelectSQL+` WHERE u.id = $1`, id))
}

// UpdateUserProfile updates a user's display name, bio, avatar object, and avatar data URL (base64).
func (s *Store) UpdateUserProfile(ctx context.Context, userID, displayName, bio string, avatarObjectID *string, avatarDataURL *string) error {
	// Build dynamic UPDATE so callers can omit fields
	parts := []string{"display_name = $2", "bio = $3", "avatar_object_id = $4", "updated_at = NOW()"}
	args := []any{userID, displayName, bio, avatarObjectID}
	if avatarDataURL != nil {
		parts = append(parts, fmt.Sprintf("avatar_data_url = $%d", len(args)+1))
		args = append(args, *avatarDataURL)
	}
	query := "UPDATE users SET " + strings.Join(parts, ", ") + " WHERE id = $1"
	_, err := s.pool.Exec(ctx, query, args...)
	return err
}

// UpdatePassword updates a user's password hash.
func (s *Store) UpdatePassword(ctx context.Context, userID, newPasswordHash string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1
	`, userID, newPasswordHash)
	return err
}

// ──────────────────────────────────────────────────────
// Sessions
// ──────────────────────────────────────────────────────

// CreateSession creates a new refresh-token session.
func (s *Store) CreateSession(ctx context.Context, userID, tokenHash, userAgent, ip string, expiresAt time.Time) (*model.Session, error) {
	var sess model.Session
	err := s.pool.QueryRow(ctx, `
		INSERT INTO sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, refresh_token_hash, user_agent, ip_address, expires_at, created_at
	`, userID, tokenHash, userAgent, ip, expiresAt).Scan(
		&sess.ID, &sess.UserID, &sess.RefreshTokenHash,
		&sess.UserAgent, &sess.IPAddress, &sess.ExpiresAt, &sess.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &sess, nil
}

// GetSessionByTokenHash returns a non-expired session matching the token hash.
func (s *Store) GetSessionByTokenHash(ctx context.Context, tokenHash string) (*model.Session, error) {
	var sess model.Session
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, refresh_token_hash, user_agent, ip_address, expires_at, created_at
		FROM sessions
		WHERE refresh_token_hash = $1 AND expires_at > NOW()
	`, tokenHash).Scan(
		&sess.ID, &sess.UserID, &sess.RefreshTokenHash,
		&sess.UserAgent, &sess.IPAddress, &sess.ExpiresAt, &sess.CreatedAt,
	)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	return &sess, nil
}

// DeleteSession removes a session by ID.
func (s *Store) DeleteSession(ctx context.Context, sessionID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, sessionID)
	return err
}

// DeleteExpiredSessions cleans up expired sessions.
func (s *Store) DeleteExpiredSessions(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < NOW()`)
	return err
}

// DeleteAllSessionsByUserID removes every active session for a user,
// effectively forcing them to log out from all devices immediately.
func (s *Store) DeleteAllSessionsByUserID(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID)
	return err
}

// ──────────────────────────────────────────────────────
// Auth helpers
// ──────────────────────────────────────────────────────

// AuthenticateUser verifies email/password and returns the user.
func (s *Store) AuthenticateUser(ctx context.Context, email, password string) (*model.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var hash string
	var u model.User
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, username, display_name, bio, role, avatar_object_id, avatar_data_url,
		       wallet_balance_cents, storage_used_bytes, storage_quota_bytes,
		       upload_limit_bytes, membership_plan_id, membership_ends_at,
		       is_banned, created_at, updated_at, password_hash
		FROM users
		WHERE email = $1 AND is_banned = FALSE
	`, email).Scan(
		&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.Bio, &u.Role, &u.AvatarObjectID, &u.AvatarDataURL,
		&u.WalletBalanceCents, &u.StorageUsedBytes, &u.StorageQuotaBytes,
		&u.UploadLimitBytes, &u.MembershipPlanID, &u.MembershipEndsAt,
		&u.IsBanned, &u.CreatedAt, &u.UpdatedAt, &hash,
	)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	if err := comparePassword(hash, password); err != nil {
		return nil, ErrInvalidCredentials
	}
	u.ComputeIsVIP()
	return &u, nil
}

// GetPasswordHash returns the password hash for a user (for use by handlers that verify current password).
func (s *Store) GetPasswordHash(ctx context.Context, userID string) (string, error) {
	var hash string
	err := s.pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash)
	return hash, maybeErrNoRows(err)
}

// SyncExpiredMemberships resets users whose memberships have expired
// to the configured default user quotas.
func (s *Store) SyncExpiredMemberships(ctx context.Context) error {
	storageQuota, uploadLimit := s.GetDefaultUserQuotas(ctx)
	_, err := s.pool.Exec(ctx, `
		UPDATE users
		SET storage_quota_bytes = $1,
		    upload_limit_bytes = $2,
		    membership_plan_id = NULL,
		    membership_ends_at = NULL,
		    updated_at = NOW()
		WHERE membership_ends_at IS NOT NULL AND membership_ends_at < NOW()
	`, storageQuota, uploadLimit)
	return err
}

// ──────────────────────────────────────────────────────
// Internal SQL fragments
// ──────────────────────────────────────────────────────

const userSelectSQL = `
	SELECT u.id, u.email, u.username, u.display_name, u.bio, u.role, u.avatar_object_id,
	       u.avatar_data_url,
	       u.wallet_balance_cents, u.storage_used_bytes, u.storage_quota_bytes,
	       u.upload_limit_bytes, u.membership_plan_id, u.membership_ends_at,
	       u.is_banned, u.is_muted, u.muted_until, u.email_verified, u.created_at, u.updated_at
	FROM users u
`

type rowScanner interface {
	Scan(dest ...any) error
}

func (s *Store) scanFullUser(row rowScanner) (*model.User, error) {
	var u model.User
	err := row.Scan(
		&u.ID, &u.Email, &u.Username, &u.DisplayName, &u.Bio, &u.Role, &u.AvatarObjectID,
		&u.AvatarDataURL,
		&u.WalletBalanceCents, &u.StorageUsedBytes, &u.StorageQuotaBytes,
		&u.UploadLimitBytes, &u.MembershipPlanID, &u.MembershipEndsAt,
		&u.IsBanned, &u.IsMuted, &u.MutedUntil, &u.EmailVerified, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, maybeErrNoRows(err)
	}
	u.ComputeIsVIP()
	return &u, nil
}

// IsUserMuted returns true if the user is currently muted (is_muted=true and muted_until
// is either null or in the future).
func (s *Store) IsUserMuted(ctx context.Context, userID string) (bool, error) {
	var muted bool
	err := s.pool.QueryRow(ctx, `
		SELECT is_muted AND (muted_until IS NULL OR muted_until > NOW())
		FROM users WHERE id = $1
	`, userID).Scan(&muted)
	return muted, err
}

// IsUserBanned returns true if the user is currently banned. Used by the
// requireNotBanned middleware so each authenticated request can reject
// access tokens issued before the ban took effect (JWTs are stateless and
// remain valid until expiry, so we must check on every request).
func (s *Store) IsUserBanned(ctx context.Context, userID string) (bool, error) {
	var banned bool
	err := s.pool.QueryRow(ctx, `SELECT is_banned FROM users WHERE id = $1`, userID).Scan(&banned)
	return banned, err
}
