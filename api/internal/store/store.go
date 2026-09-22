package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/marsshare/api/internal/crypto"
	appdb "github.com/marsshare/api/internal/db"
	"github.com/pressly/goose/v3"
	"golang.org/x/crypto/bcrypt"
)

const (
	DefaultStorageQuotaBytes = int64(2 * 1024 * 1024 * 1024) // 2 GiB
	DefaultUploadLimitBytes  = int64(100 * 1024 * 1024)      // 100 MiB
)

// Store holds the database connection and dependencies for all data access.
// It supports both PostgreSQL (via pgxpool) and SQLite (via database/sql)
// through the db.DB interface.
type Store struct {
	pool    appdb.DB
	stdDB   *sql.DB
	secrets *crypto.SecretBox
}

// New creates a Store backed by a pgxpool (PostgreSQL).
func New(pool *pgxpool.Pool, db *sql.DB, secrets *crypto.SecretBox) *Store {
	return &Store{
		pool:    appdb.NewPostgres(pool),
		stdDB:   db,
		secrets: secrets,
	}
}

// NewWithDB creates a Store with an explicit db.DB implementation.
// Use this for SQLite or testing.
func NewWithDB(database appdb.DB, stdDB *sql.DB, secrets *crypto.SecretBox) *Store {
	return &Store{
		pool:    database,
		stdDB:   stdDB,
		secrets: secrets,
	}
}

// Dialect returns the current database dialect.
func (s *Store) Dialect() appdb.Dialect {
	return s.pool.Dialect()
}

// Migrate runs pending goose migrations.
func (s *Store) Migrate(ctx context.Context) error {
	goose.SetBaseFS(nil)
	dialect := "postgres"
	if s.pool.Dialect() == appdb.DialectSQLite {
		dialect = "sqlite3"
	}
	if err := goose.SetDialect(dialect); err != nil {
		return fmt.Errorf("goose set dialect: %w", err)
	}
	return goose.UpContext(ctx, s.stdDB, filepath.Clean("migrations"))
}

// SeedDefaults creates the admin user (if not exists) and ensures the default
// storage policy is present.
func (s *Store) SeedDefaults(ctx context.Context, adminEmail, adminPassword string) error {
	if err := s.ensureDefaultStoragePolicyExists(ctx); err != nil {
		return fmt.Errorf("seed storage policy: %w", err)
	}

	if err := s.seedMembershipPlans(ctx); err != nil {
		return fmt.Errorf("seed membership plans: %w", err)
	}

	if adminEmail != "" && adminPassword != "" {
		if err := s.bootstrapAdmin(ctx, adminEmail, adminPassword); err != nil {
			return fmt.Errorf("bootstrap admin: %w", err)
		}
		// Environment-based bootstrap is the non-interactive setup path.
		// Mark it complete so the setup guard does not block the seeded admin.
		if err := s.UpsertSetting(ctx, SettingSetupComplete, "true", false, ""); err != nil {
			return fmt.Errorf("mark bootstrap setup complete: %w", err)
		}
	}

	return nil
}

// EnsureDefaultStoragePolicy creates the default local storage policy if it doesn't exist.
// Called on startup when no admin credentials are set (setup wizard mode).
func (s *Store) EnsureDefaultStoragePolicy(ctx context.Context) {
	_ = s.ensureDefaultStoragePolicyExists(ctx)
}

func (s *Store) seedMembershipPlans(ctx context.Context) error {
	plans := []struct {
		name   string
		slug   string
		price  int64
		days   int
		quota  int64
		upload int64
	}{
		{"月度会员", "vip-month", 1990, 30, 20 * 1024 * 1024 * 1024, 1024 * 1024 * 1024},
		{"季度会员", "vip-quarter", 4990, 90, 50 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024},
		{"年度会员", "vip-year", 15990, 365, 200 * 1024 * 1024 * 1024, 5 * 1024 * 1024 * 1024},
	}
	for _, p := range plans {
		_, err := s.pool.Exec(ctx, `
			INSERT INTO membership_plans (name, slug, price_cents, duration_days, storage_quota_bytes, upload_limit_bytes)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (slug) DO NOTHING
		`, p.name, p.slug, p.price, p.days, p.quota, p.upload)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) bootstrapAdmin(ctx context.Context, email, password string) error {
	email = strings.ToLower(strings.TrimSpace(email))

	var existingID, existingRole string
	err := s.pool.QueryRow(ctx, `SELECT id, role FROM users WHERE email = $1`, email).Scan(&existingID, &existingRole)
	if err == nil {
		// Ensure existing user is admin and email-verified.
		_, err = s.pool.Exec(ctx, `
			UPDATE users SET role = 'admin', email_verified = TRUE, updated_at = NOW() WHERE id = $1
		`, existingID)
		return err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	username := normalizeUsername(email)
	_, err = s.pool.Exec(ctx, `
		INSERT INTO users (email, username, display_name, password_hash, role, email_verified, storage_quota_bytes, upload_limit_bytes)
		VALUES ($1, $2, '管理员', $3, 'admin', TRUE, $4, $5)
	`, email, username, hash, DefaultStorageQuotaBytes, DefaultUploadLimitBytes)
	return err
}

func (s *Store) withTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	if err = fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ensureDefaultStoragePolicyExists(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO storage_policies (id, name, type, is_enabled, is_default, local_path)
		SELECT $1, '本地存储', 'local', TRUE, TRUE, '/data/storage'
		WHERE NOT EXISTS (
			SELECT 1 FROM storage_policies WHERE is_default = TRUE
		)
	`, uuid.NewString())
	return err
}

func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}

func comparePassword(hash, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

func normalizeUsername(email string) string {
	base := strings.Split(strings.ToLower(email), "@")[0]
	base = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			return r
		}
		return '_'
	}, base)
	if base == "" {
		base = "user"
	}
	return fmt.Sprintf("%s_%s", strings.Trim(base, "_"), strings.ReplaceAll(uuid.NewString()[:8], "-", ""))
}

func randomCode(length int) string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	buf := make([]byte, length)
	for i := range buf {
		buf[i] = alphabet[rand.Intn(len(alphabet))]
	}
	return string(buf)
}

func maybeErrNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return sql.ErrNoRows
	}
	return err
}

func jsonRaw(v any) []byte {
	data, _ := json.Marshal(v)
	return data
}

// defaultPageLimit normalises cursor pagination parameters.
func defaultPageLimit(limit int) int {
	if limit <= 0 || limit > 50 {
		return 20
	}
	return limit
}
