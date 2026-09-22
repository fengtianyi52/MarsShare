package app

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"time"
)

type Config struct {
	DatabaseURL            string
	AppMasterKey           string
	AppMasterKeyHash       []byte
	BootstrapAdminEmail    string
	BootstrapAdminPassword string
	AppBaseURL             string
	APIAddr                string
	CORSOrigin             string
	LocalStoragePath       string
	WorkerInterval         time.Duration
}

func LoadConfig() (Config, error) {
	interval := 30 * time.Second
	if raw := os.Getenv("WORKER_INTERVAL"); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("parse WORKER_INTERVAL: %w", err)
		}
		interval = parsed
	}

	cfg := Config{
		DatabaseURL:            os.Getenv("DATABASE_URL"),
		AppMasterKey:           os.Getenv("APP_MASTER_KEY"),
		BootstrapAdminEmail:    os.Getenv("BOOTSTRAP_ADMIN_EMAIL"),
		BootstrapAdminPassword: os.Getenv("BOOTSTRAP_ADMIN_PASSWORD"),
		AppBaseURL:             envOr("APP_BASE_URL", "http://localhost:5173"),
		APIAddr:                envOr("API_ADDR", ":8080"),
		CORSOrigin:             envOr("CORS_ORIGIN", "http://localhost:5173"),
		LocalStoragePath:       envOr("LOCAL_STORAGE_PATH", "/data/storage"),
		WorkerInterval: interval,
	}

	// Validate required fields.
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.AppMasterKey == "" || len(cfg.AppMasterKey) < 32 {
		return Config{}, errors.New("APP_MASTER_KEY is required and must be at least 32 characters")
	}
	// Admin credentials are optional — if empty, the setup wizard will handle it.
	// if cfg.BootstrapAdminEmail == "" { ... }

	// Derive signing key from master key.
	sum := sha256.Sum256([]byte(cfg.AppMasterKey))
	cfg.AppMasterKeyHash = sum[:]

	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
