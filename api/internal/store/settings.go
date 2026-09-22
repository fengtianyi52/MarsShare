package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/marsshare/api/internal/model"
)

// System settings (encrypted key-value store).

// GetSetting returns a decrypted setting value by key.
func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	var encrypted string
	if err := s.pool.QueryRow(ctx, `SELECT value_encrypted FROM system_settings WHERE key = $1`, key).Scan(&encrypted); err != nil {
		return "", maybeErrNoRows(err)
	}
	return s.secrets.DecryptString(encrypted)
}

// UpsertSetting creates or updates a system setting.
// If isSecret is true, the value is encrypted before persistence.
func (s *Store) UpsertSetting(ctx context.Context, key, value string, isSecret bool, updatedBy string) error {
	encrypted, err := s.secrets.EncryptString(value)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO system_settings (key, value_encrypted, is_secret, updated_by)
		VALUES ($1, $2, $3, NULLIF($4, '')::uuid)
		ON CONFLICT (key)
		DO UPDATE SET value_encrypted = EXCLUDED.value_encrypted,
		             is_secret = EXCLUDED.is_secret,
		             updated_by = EXCLUDED.updated_by,
		             updated_at = NOW()
	`, key, encrypted, isSecret, updatedBy)
	return err
}

// GetAllSettings returns all settings as a decrypted map.
func (s *Store) GetAllSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT key, value_encrypted FROM system_settings ORDER BY key ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	settings := make(map[string]string)
	for rows.Next() {
		var key, encrypted string
		if err := rows.Scan(&key, &encrypted); err != nil {
			return nil, err
		}
		value, err := s.secrets.DecryptString(encrypted)
		if err != nil {
			settings[key] = ""
			continue
		}
		settings[key] = value
	}
	return settings, rows.Err()
}

// Setup wizard.

const (
	SettingSetupComplete            = "setup_complete"
	SettingSiteName                 = "site_name"
	SettingSiteDesc                 = "site_description"
	SettingAdminPath                = "admin_path"
	SettingDefaultStorageQuotaBytes = "default_storage_quota_bytes"
	SettingDefaultUploadLimitBytes  = "default_upload_limit_bytes"

	// Site URL (used in email links; overrides APP_BASE_URL env var when set)
	SettingAppBaseURL = "app_base_url"

	// Email settings
	SettingEmailResendAPIKey = "email_resend_api_key"
	SettingEmailFrom             = "email_from"
	SettingEmailSenderName       = "email_sender_name"
	SettingEmailVerifyEnabled    = "email_verify_enabled"
	SettingEmailResetEnabled     = "email_reset_enabled"
	SettingEmailVerifySubject    = "email_verify_subject"
	SettingEmailVerifyTemplate   = "email_verify_template"
	SettingEmailResetSubject     = "email_reset_subject"
	SettingEmailResetTemplate    = "email_reset_template"

	// Worker-internal bookkeeping.
	SettingMembershipAdvancedAt = "membership_advanced_at"

	// Stripe settings (cash payment for wallet recharge / membership).
	// SecretKey / WebhookSecret are stored encrypted (is_secret = true).
	SettingStripeEnabled         = "stripe_enabled"
	SettingStripePublishableKey  = "stripe_publishable_key"
	SettingStripeSecretKey       = "stripe_secret_key"
	SettingStripeWebhookSecret   = "stripe_webhook_secret"
	SettingStripeCurrency        = "stripe_currency"            // ISO-4217, e.g. "usd", "cny"
	SettingStripeCreditRate      = "stripe_credit_rate"         // wallet credits per 1.00 unit of currency (default: 100)
)

// StripeSettings is the resolved Stripe configuration.
type StripeSettings struct {
	Enabled         bool
	PublishableKey  string
	SecretKey       string
	WebhookSecret   string
	Currency        string  // lowercase ISO-4217
	CreditRate      float64 // wallet cents credited per 1 cent paid (default 1.0)
}

// GetStripeSettings loads all Stripe settings in a single pass.
// Missing keys fall back to safe defaults; Enabled stays false unless
// both publishable and secret keys are present and the toggle is on.
func (s *Store) GetStripeSettings(ctx context.Context) *StripeSettings {
	get := func(key string) string {
		v, _ := s.GetSetting(ctx, key)
		return v
	}
	currency := strings.ToLower(strings.TrimSpace(get(SettingStripeCurrency)))
	if currency == "" {
		currency = "usd"
	}
	rate := 1.0
	if v := get(SettingStripeCreditRate); v != "" {
		var n float64
		if _, err := fmt.Sscanf(v, "%f", &n); err == nil && n > 0 {
			rate = n
		}
	}
	pub := get(SettingStripePublishableKey)
	sec := get(SettingStripeSecretKey)
	enabled := get(SettingStripeEnabled) == "true" && pub != "" && sec != ""
	return &StripeSettings{
		Enabled:        enabled,
		PublishableKey: pub,
		SecretKey:      sec,
		WebhookSecret:  get(SettingStripeWebhookSecret),
		Currency:       currency,
		CreditRate:     rate,
	}
}

// EmailSettings holds all email-related settings resolved from the DB.
type EmailSettings struct {
	APIKey         string // Resend API key
	From           string // formatted "Name <addr>" or bare addr
	VerifyEnabled  bool
	ResetEnabled   bool
	VerifySubject  string
	VerifyTemplate string // Go text/template HTML; empty = built-in default
	ResetSubject   string
	ResetTemplate  string // Go text/template HTML; empty = built-in default
}

// GetEmailSettings loads all email settings in a single pass.
// Never returns an error — missing keys fall back to zero/false values.
func (s *Store) GetEmailSettings(ctx context.Context) *EmailSettings {
	get := func(key string) string {
		v, _ := s.GetSetting(ctx, key)
		return v
	}
	senderName := get(SettingEmailSenderName)
	from := get(SettingEmailFrom)
	formattedFrom := from
	if senderName != "" && from != "" {
		formattedFrom = senderName + " <" + from + ">"
	}
	return &EmailSettings{
		APIKey:         get(SettingEmailResendAPIKey),
		From:           formattedFrom,
		VerifyEnabled:  get(SettingEmailVerifyEnabled) == "true",
		ResetEnabled:   get(SettingEmailResetEnabled) == "true",
		VerifySubject:  get(SettingEmailVerifySubject),
		VerifyTemplate: get(SettingEmailVerifyTemplate),
		ResetSubject:   get(SettingEmailResetSubject),
		ResetTemplate:  get(SettingEmailResetTemplate),
	}
}

// GetDefaultUserQuotas returns the configured default storage quota and
// upload limit for new free users. Falls back to compile-time constants
// when the settings are unset or invalid.
func (s *Store) GetDefaultUserQuotas(ctx context.Context) (storageQuota int64, uploadLimit int64) {
	storageQuota = DefaultStorageQuotaBytes
	uploadLimit = DefaultUploadLimitBytes
	if v, err := s.GetSetting(ctx, SettingDefaultStorageQuotaBytes); err == nil && v != "" {
		var n int64
		if _, e := fmt.Sscanf(v, "%d", &n); e == nil && n > 0 {
			storageQuota = n
		}
	}
	if v, err := s.GetSetting(ctx, SettingDefaultUploadLimitBytes); err == nil && v != "" {
		var n int64
		if _, e := fmt.Sscanf(v, "%d", &n); e == nil && n > 0 {
			uploadLimit = n
		}
	}
	return
}

// IsSetupComplete checks whether the initial setup wizard has been completed.
func (s *Store) IsSetupComplete(ctx context.Context) bool {
	val, err := s.GetSetting(ctx, SettingSetupComplete)
	return err == nil && val == "true"
}

// SetupConfig holds all the data collected by the first-run setup wizard.
type SetupConfig struct {
	SiteName          string `json:"site_name"`
	SiteDesc          string `json:"site_description"`
	AdminPath         string `json:"admin_path"`
	AdminEmail        string `json:"admin_email"`
	AdminUsername     string `json:"admin_username"`
	AdminPassword     string `json:"admin_password"`
	StoragePolicyType string `json:"storage_type"`
	LocalStoragePath  string `json:"local_path"`
	S3Endpoint        string `json:"s3_endpoint"`
	S3Bucket          string `json:"s3_bucket"`
	S3Region          string `json:"s3_region"`
	S3AccessKey       string `json:"s3_access_key"`
	S3SecretKey       string `json:"s3_secret_key"`
}

// CompleteSetup runs the first-time setup wizard: creates admin, saves settings,
// configures storage, and marks setup as complete.
func (s *Store) CompleteSetup(ctx context.Context, cfg SetupConfig) error {
	hash, err := hashPassword(cfg.AdminPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	username := cfg.AdminUsername
	if username == "" {
		username = normalizeUsername(cfg.AdminEmail)
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO users (id, email, username, display_name, password_hash, role, email_verified, storage_quota_bytes, upload_limit_bytes)
		VALUES ($1, $2, $3, $4, $5, 'admin', TRUE, $6, $7)
	`, uuid.NewString(), cfg.AdminEmail, username, "管理员", hash, DefaultStorageQuotaBytes, DefaultUploadLimitBytes)
	if err != nil {
		return fmt.Errorf("create admin: %w", err)
	}

	settings := map[string]string{
		SettingSiteName:  cfg.SiteName,
		SettingSiteDesc:  cfg.SiteDesc,
		SettingAdminPath: cfg.AdminPath,
	}
	for k, v := range settings {
		if v == "" {
			continue
		}
		if err := s.UpsertSetting(ctx, k, v, false, ""); err != nil {
			return fmt.Errorf("save setting %s: %w", k, err)
		}
	}

	if cfg.StoragePolicyType == "s3" {
		_, err := s.pool.Exec(ctx, `
			UPDATE storage_policies
			SET type = 's3', endpoint = $1, bucket = $2, region = $3,
			    access_key = $4, secret_key = $5, is_private = TRUE,
			    updated_at = NOW()
			WHERE is_default = TRUE
		`, cfg.S3Endpoint, cfg.S3Bucket, cfg.S3Region, cfg.S3AccessKey, cfg.S3SecretKey)
		if err != nil {
			return fmt.Errorf("update storage policy: %w", err)
		}
	} else if cfg.LocalStoragePath != "" {
		_, err := s.pool.Exec(ctx, `
			UPDATE storage_policies
			SET local_path = $1, updated_at = NOW()
			WHERE is_default = TRUE
		`, cfg.LocalStoragePath)
		if err != nil {
			return fmt.Errorf("update local path: %w", err)
		}
	}

	if err := s.seedMembershipPlans(ctx); err != nil {
		return fmt.Errorf("seed plans: %w", err)
	}

	if err := s.UpsertSetting(ctx, SettingSetupComplete, "true", false, ""); err != nil {
		return fmt.Errorf("mark setup complete: %w", err)
	}

	return nil
}

// Storage policies (admin CRUD).

// ListStoragePolicies returns all storage policies.
func (s *Store) ListStoragePolicies(ctx context.Context) ([]model.StoragePolicy, error) {
	rows, err := s.pool.Query(ctx, storagePolicySelectSQL+` ORDER BY sp.created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.StoragePolicy, 0)
	for rows.Next() {
		var sp model.StoragePolicy
		if err := rows.Scan(
			&sp.ID, &sp.Name, &sp.Type, &sp.IsEnabled, &sp.IsDefault,
			&sp.Endpoint, &sp.Bucket, &sp.Region, &sp.AccessKey, &sp.SecretKey,
			&sp.LocalPath, &sp.DirNamingRule, &sp.FileNamingRule,
			&sp.MaxFileSizeBytes, &sp.AllowedMimeTypes, &sp.IsPrivate,
			&sp.ProxyDownload, &sp.BaseURL, &sp.URLExpireSeconds,
			&sp.CreatedAt, &sp.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, sp)
	}
	return items, rows.Err()
}

// CreateStoragePolicy inserts a new storage policy.
func (s *Store) CreateStoragePolicy(ctx context.Context, policy *model.StoragePolicy) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		if policy.IsDefault {
			policy.IsEnabled = true
			if _, err := tx.Exec(ctx, `
				UPDATE storage_policies
				SET is_default = FALSE, updated_at = NOW()
				WHERE is_default = TRUE
			`); err != nil {
				return err
			}
		}

		return tx.QueryRow(ctx, `
			INSERT INTO storage_policies (
				name, type, is_enabled, is_default, endpoint, bucket, region,
				access_key, secret_key, local_path, dir_naming_rule, file_naming_rule,
				max_file_size_bytes, allowed_mime_types, is_private, proxy_download,
				base_url, url_expire_seconds
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
			RETURNING id, created_at, updated_at
		`,
			policy.Name, policy.Type, policy.IsEnabled, policy.IsDefault,
			policy.Endpoint, policy.Bucket, policy.Region,
			policy.AccessKey, policy.SecretKey, policy.LocalPath,
			policy.DirNamingRule, policy.FileNamingRule,
			policy.MaxFileSizeBytes, policy.AllowedMimeTypes,
			policy.IsPrivate, policy.ProxyDownload,
			policy.BaseURL, policy.URLExpireSeconds,
		).Scan(&policy.ID, &policy.CreatedAt, &policy.UpdatedAt)
	})
}

// UpdateStoragePolicy updates an existing storage policy.
func (s *Store) UpdateStoragePolicy(ctx context.Context, policy *model.StoragePolicy) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		var wasDefault bool
		if err := tx.QueryRow(ctx, `SELECT is_default FROM storage_policies WHERE id = $1`, policy.ID).Scan(&wasDefault); err != nil {
			return err
		}

		if policy.IsDefault {
			policy.IsEnabled = true
			if _, err := tx.Exec(ctx, `
				UPDATE storage_policies
				SET is_default = FALSE, updated_at = NOW()
				WHERE is_default = TRUE AND id <> $1
			`, policy.ID); err != nil {
				return err
			}
		} else if wasDefault {
			var hasOtherDefault bool
			if err := tx.QueryRow(ctx, `
				SELECT EXISTS(
					SELECT 1 FROM storage_policies
					WHERE is_default = TRUE AND id <> $1
				)
			`, policy.ID).Scan(&hasOtherDefault); err != nil {
				return err
			}
			if !hasOtherDefault {
				policy.IsDefault = true
				policy.IsEnabled = true
			}
		}

		// access_key / secret_key 为空字符串时保留原值，因为前端不会回显敏感字段，
		// 编辑时留空表示"不修改密钥"。
		_, err := tx.Exec(ctx, `
			UPDATE storage_policies
			SET name = $2, type = $3, is_enabled = $4, is_default = $5,
			    endpoint = $6, bucket = $7, region = $8,
			    access_key = CASE WHEN $9 = '' THEN access_key ELSE $9 END,
			    secret_key = CASE WHEN $10 = '' THEN secret_key ELSE $10 END,
			    local_path = $11,
			    dir_naming_rule = $12, file_naming_rule = $13,
			    max_file_size_bytes = $14, allowed_mime_types = $15,
			    is_private = $16, proxy_download = $17,
			    base_url = $18, url_expire_seconds = $19,
			    updated_at = NOW()
			WHERE id = $1
		`,
			policy.ID, policy.Name, policy.Type, policy.IsEnabled, policy.IsDefault,
			policy.Endpoint, policy.Bucket, policy.Region,
			policy.AccessKey, policy.SecretKey, policy.LocalPath,
			policy.DirNamingRule, policy.FileNamingRule,
			policy.MaxFileSizeBytes, policy.AllowedMimeTypes,
			policy.IsPrivate, policy.ProxyDownload,
			policy.BaseURL, policy.URLExpireSeconds,
		)
		return err
	})
}

// DeleteStoragePolicy deletes a storage policy by ID.
func (s *Store) DeleteStoragePolicy(ctx context.Context, policyID string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		var wasDefault bool
		if err := tx.QueryRow(ctx, `SELECT is_default FROM storage_policies WHERE id = $1`, policyID).Scan(&wasDefault); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `DELETE FROM storage_policies WHERE id = $1`, policyID); err != nil {
			return err
		}
		if !wasDefault {
			return nil
		}

		tag, err := tx.Exec(ctx, `
			WITH candidate AS (
				SELECT id
				FROM storage_policies
				WHERE is_enabled = TRUE
				ORDER BY created_at ASC, id ASC
				LIMIT 1
			)
			UPDATE storage_policies
			SET is_default = TRUE, updated_at = NOW()
			WHERE id = (SELECT id FROM candidate)
		`)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			return nil
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO storage_policies (id, name, type, is_enabled, is_default, local_path)
			VALUES ($1, '本地存储', 'local', TRUE, TRUE, '/data/storage')
		`, uuid.NewString())
		return err
	})
}
