// Package db provides a database abstraction layer that supports both
// PostgreSQL (via pgxpool) and SQLite (via database/sql + modernc.org/sqlite).
//
// The DB interface mirrors the pgxpool.Pool surface used by the store layer,
// allowing the store to work with either backend transparently.
package db

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Dialect identifies the database engine.
type Dialect string

const (
	DialectPostgres Dialect = "postgres"
	DialectSQLite   Dialect = "sqlite"
)

// DB is the common interface for database operations.
// It is satisfied by pgxpool.Pool (PostgreSQL) and the sqliteDB adapter (SQLite).
type DB interface {
	// Exec executes a query without returning rows.
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	// Query executes a query that returns rows.
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	// QueryRow executes a query that returns at most one row.
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	// BeginTx starts a transaction.
	BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error)

	// Dialect returns the database dialect.
	Dialect() Dialect
}
