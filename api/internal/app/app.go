package app

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/marsshare/api/internal/auth"
	"github.com/marsshare/api/internal/crypto"
	appdb "github.com/marsshare/api/internal/db"
	"github.com/marsshare/api/internal/email"
	httpapi "github.com/marsshare/api/internal/http"
	"github.com/marsshare/api/internal/storage"
	"github.com/marsshare/api/internal/store"

	// SQLite driver (pure Go, no CGO required)
	_ "modernc.org/sqlite"
)

// Dependencies holds all application-level dependencies.
type Dependencies struct {
	Config  Config
	Pool    *pgxpool.Pool // nil when using SQLite
	DB      *sql.DB
	Store   *store.Store
	Secrets *crypto.SecretBox
	Tokens  *auth.TokenManager
	Storage *storage.Manager
	Email   *email.Service
}

// NewDependencies creates dependencies and runs migrations + seed.
func NewDependencies(ctx context.Context, cfg Config) (*Dependencies, error) {
	return newDependencies(ctx, cfg, true)
}

// NewWorkerDependencies creates dependencies without running migrations or seed.
func NewWorkerDependencies(ctx context.Context, cfg Config) (*Dependencies, error) {
	return newDependencies(ctx, cfg, false)
}

func newDependencies(ctx context.Context, cfg Config, prepare bool) (*Dependencies, error) {
	secrets, err := crypto.NewSecretBox(cfg.AppMasterKey)
	if err != nil {
		return nil, fmt.Errorf("create secretbox: %w", err)
	}

	tokens := auth.NewTokenManager(cfg.AppMasterKeyHash)

	if err := os.MkdirAll(cfg.LocalStoragePath, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir storage: %w", err)
	}

	storageManager := storage.NewManager()

	// ── Choose database backend based on DATABASE_URL prefix ──
	var (
		appStore *store.Store
		pool     *pgxpool.Pool
		stdDB    *sql.DB
	)

	if isSQLite(cfg.DatabaseURL) {
		log.Println("using SQLite database")
		dsn := strings.TrimPrefix(cfg.DatabaseURL, "sqlite://")
		dsn = strings.TrimPrefix(dsn, "sqlite:")
		stdDB, err = sql.Open("sqlite", dsn)
		if err != nil {
			return nil, fmt.Errorf("open sqlite: %w", err)
		}
		// Enable WAL mode and foreign keys
		if _, err := stdDB.ExecContext(ctx, "PRAGMA journal_mode=WAL"); err != nil {
			return nil, fmt.Errorf("sqlite pragma WAL: %w", err)
		}
		if _, err := stdDB.ExecContext(ctx, "PRAGMA foreign_keys=ON"); err != nil {
			return nil, fmt.Errorf("sqlite pragma FK: %w", err)
		}

		sqliteDB := appdb.NewSQLite(stdDB)
		appStore = store.NewWithDB(sqliteDB, stdDB, secrets)
	} else {
		log.Println("using PostgreSQL database")
		pool, err = pgxpool.New(ctx, cfg.DatabaseURL)
		if err != nil {
			return nil, fmt.Errorf("connect pgxpool: %w", err)
		}
		stdDB = stdlib.OpenDBFromPool(pool)
		appStore = store.New(pool, stdDB, secrets)
	}

	if prepare {
		if err := appStore.Migrate(ctx); err != nil {
			return nil, fmt.Errorf("migrate: %w", err)
		}
		if err := appStore.FixInvalidUsernames(ctx); err != nil {
			log.Printf("warning: username fix failed: %v", err)
		}
		// If admin credentials are provided via env vars, run traditional seed.
		// Otherwise, the setup wizard (POST /api/setup/initialize) will handle it.
		if cfg.BootstrapAdminEmail != "" && cfg.BootstrapAdminPassword != "" {
			if err := appStore.SeedDefaults(ctx, cfg.BootstrapAdminEmail, cfg.BootstrapAdminPassword); err != nil {
				return nil, fmt.Errorf("seed: %w", err)
			}
		} else {
			// Ensure at least the default storage policy exists for the wizard.
			appStore.EnsureDefaultStoragePolicy(ctx)
			log.Println("no admin credentials in env — setup wizard will be available at /setup")
		}
	}

	// Register a handler for every storage policy in the database.
	// Without this, uploads to non-default policies would fail with
	// "no storage handler registered". Each policy creates its own
	// handler based on its type and credentials.
	if policies, err := appStore.ListStoragePolicies(ctx); err == nil {
		for _, p := range policies {
			handler, err := storage.NewHandler(
				p.Type, p.Endpoint, p.Region, p.Bucket,
				p.AccessKey, p.SecretKey, p.LocalPath,
			)
			if err != nil {
				log.Printf("warning: storage policy %q (%s) skipped: %v", p.Name, p.Type, err)
				continue
			}
			storageManager.RegisterPolicy(p.ID, handler)
		}
	}

	emailSvc := email.New()

	return &Dependencies{
		Config:  cfg,
		Pool:    pool,
		DB:      stdDB,
		Store:   appStore,
		Secrets: secrets,
		Tokens:  tokens,
		Storage: storageManager,
		Email:   emailSvc,
	}, nil
}

// Close releases all resources held by Dependencies.
func (d *Dependencies) Close() {
	if d.DB != nil {
		_ = d.DB.Close()
	}
	if d.Pool != nil {
		d.Pool.Close()
	}
}

// isSQLite returns true if the database URL points to a SQLite database.
func isSQLite(url string) bool {
	return strings.HasPrefix(url, "sqlite://") || strings.HasPrefix(url, "sqlite:")
}

// Server wraps an HTTP server and its dependencies.
type Server struct {
	httpServer *http.Server
	deps       *Dependencies
}

// NewServer creates a fully wired Server ready to listen.
func NewServer(ctx context.Context, cfg Config) (*Server, error) {
	deps, err := NewDependencies(ctx, cfg)
	if err != nil {
		return nil, err
	}

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())
	router.Use(cors.New(buildCORSConfig(cfg.CORSOrigin)))

	httpapi.RegisterRoutes(router, httpapi.Config{
		AppBaseURL: cfg.AppBaseURL,
	}, deps.Store, deps.Tokens, deps.Storage, deps.Email)

	return &Server{
		httpServer: &http.Server{
			Addr:              cfg.APIAddr,
			Handler:           router,
			ReadHeaderTimeout: 10 * time.Second,
		},
		deps: deps,
	}, nil
}

// Run starts the HTTP server.
func (s *Server) Run() error {
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully shuts down the HTTP server.
func (s *Server) Shutdown(ctx context.Context) {
	if s.httpServer != nil {
		_ = s.httpServer.Shutdown(ctx)
	}
}

// Close releases all resources.
func (s *Server) Close() {
	if s.deps != nil {
		s.deps.Close()
	}
}

// buildCORSConfig parses the CORS_ORIGIN env var into a gin-contrib/cors
// config. The value is a comma-separated list of allowed origins; "*" is a
// special token meaning "allow any origin".
//
// We deliberately use AllowOriginFunc instead of AllowOrigins so that:
//   - the wildcard ("*") still works *together* with AllowCredentials=true
//     (the upstream AllowAllOrigins flag is mutually exclusive with
//     credentials per the CORS spec, which would break our Bearer-token
//     login flow when the deployer sets CORS_ORIGIN=*).
//   - whitespace and trailing slashes in user-supplied values are tolerated.
func buildCORSConfig(raw string) cors.Config {
	allowed := make([]string, 0)
	allowAny := false
	for _, part := range strings.Split(raw, ",") {
		o := strings.TrimSpace(part)
		o = strings.TrimRight(o, "/")
		if o == "" {
			continue
		}
		if o == "*" {
			allowAny = true
			continue
		}
		allowed = append(allowed, o)
	}

	return cors.Config{
		AllowOriginFunc: func(origin string) bool {
			if allowAny {
				return true
			}
			origin = strings.TrimRight(origin, "/")
			for _, a := range allowed {
				if a == origin {
					return true
				}
			}
			return false
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Content-Type", "Authorization", "X-Share-Password"},
		ExposeHeaders:    []string{"Content-Disposition", "Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}
}
