package db

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// placeholderRe matches PostgreSQL-style $N placeholders.
var placeholderRe = regexp.MustCompile(`\$(\d+)`)

// SQLiteDB wraps a standard database/sql.DB to satisfy the DB interface.
// It automatically converts $N placeholders to ? and strips PostgreSQL-specific syntax.
type SQLiteDB struct {
	db *sql.DB
}

func NewSQLite(db *sql.DB) *SQLiteDB {
	return &SQLiteDB{db: db}
}

// StdDB returns the underlying *sql.DB for use with Goose migrations.
func (s *SQLiteDB) StdDB() *sql.DB {
	return s.db
}

func (s *SQLiteDB) Dialect() Dialect {
	return DialectSQLite
}

func (s *SQLiteDB) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	q := adaptSQL(query)
	result, err := s.db.ExecContext(ctx, q, args...)
	if err != nil {
		return pgconn.NewCommandTag(""), wrapErr(err)
	}
	affected, _ := result.RowsAffected()
	return pgconn.NewCommandTag(fmt.Sprintf("OK %d", affected)), nil
}

func (s *SQLiteDB) Query(ctx context.Context, query string, args ...any) (pgx.Rows, error) {
	q := adaptSQL(query)
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, wrapErr(err)
	}
	return &sqliteRows{rows: rows}, nil
}

func (s *SQLiteDB) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	q := adaptSQL(query)
	row := s.db.QueryRowContext(ctx, q, args...)
	return &sqliteRow{row: row}
}

func (s *SQLiteDB) BeginTx(ctx context.Context, _ pgx.TxOptions) (pgx.Tx, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	return &sqliteTx{tx: tx, ctx: ctx}, nil
}

// adaptSQL converts PostgreSQL SQL to SQLite-compatible SQL.
func adaptSQL(query string) string {
	// Replace $N with ?
	q := placeholderRe.ReplaceAllString(query, "?")
	// Strip GENERATED ALWAYS AS ... STORED (used for tsvector)
	q = stripGenerated(q)
	// Replace now() with datetime('now')
	q = strings.ReplaceAll(q, "now()", "datetime('now')")
	q = strings.ReplaceAll(q, "NOW()", "datetime('now')")
	// Replace gen_random_uuid() with hex(randomblob(16))
	q = strings.ReplaceAll(q, "gen_random_uuid()", "lower(hex(randomblob(16)))")
	// Remove USING GIN(...) index clauses
	q = regexp.MustCompile(`(?i)\s+USING\s+GIN\s*\([^)]+\)`).ReplaceAllString(q, "")
	// Replace TSVECTOR type with TEXT
	q = strings.ReplaceAll(q, "TSVECTOR", "TEXT")
	q = strings.ReplaceAll(q, "tsvector", "TEXT")
	// Replace TIMESTAMPTZ with TEXT
	q = strings.ReplaceAll(q, "TIMESTAMPTZ", "TEXT")
	// Replace JSONB with TEXT
	q = strings.ReplaceAll(q, "JSONB", "TEXT")
	// Replace DOUBLE PRECISION with REAL
	q = strings.ReplaceAll(q, "DOUBLE PRECISION", "REAL")
	// Remove ON CONFLICT constraints that reference constraint names
	return q
}

// stripGenerated removes GENERATED ALWAYS AS (...) STORED clauses.
var generatedRe = regexp.MustCompile(`(?i)\s+GENERATED\s+ALWAYS\s+AS\s*\([^)]*\)\s*STORED`)

func stripGenerated(q string) string {
	return generatedRe.ReplaceAllString(q, "")
}

// wrapErr converts sql.ErrNoRows to pgx.ErrNoRows for compatibility.
func wrapErr(err error) error {
	if err == sql.ErrNoRows {
		return pgx.ErrNoRows
	}
	return err
}

// ── sqliteRow wraps sql.Row to implement pgx.Row ──

type sqliteRow struct {
	row *sql.Row
}

func (r *sqliteRow) Scan(dest ...any) error {
	return wrapErr(r.row.Scan(dest...))
}

// ── sqliteRows wraps sql.Rows to implement pgx.Rows ──

type sqliteRows struct {
	rows *sql.Rows
}

func (r *sqliteRows) Close()                        { r.rows.Close() }
func (r *sqliteRows) Err() error                    { return r.rows.Err() }
func (r *sqliteRows) Next() bool                    { return r.rows.Next() }
func (r *sqliteRows) Scan(dest ...any) error        { return r.rows.Scan(dest...) }
func (r *sqliteRows) CommandTag() pgconn.CommandTag  { return pgconn.NewCommandTag("SELECT") }
func (r *sqliteRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *sqliteRows) RawValues() [][]byte           { return nil }
func (r *sqliteRows) Values() ([]any, error)        { return nil, nil }
func (r *sqliteRows) Conn() *pgx.Conn               { return nil }

// ── sqliteTx wraps sql.Tx to implement pgx.Tx ──

type sqliteTx struct {
	tx  *sql.Tx
	ctx context.Context
}

func (t *sqliteTx) Begin(ctx context.Context) (pgx.Tx, error) {
	// SQLite doesn't support nested transactions; return self as no-op
	return t, nil
}

func (t *sqliteTx) Commit(ctx context.Context) error {
	return t.tx.Commit()
}

func (t *sqliteTx) Rollback(ctx context.Context) error {
	return t.tx.Rollback()
}

func (t *sqliteTx) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	q := adaptSQL(query)
	result, err := t.tx.ExecContext(ctx, q, args...)
	if err != nil {
		return pgconn.NewCommandTag(""), wrapErr(err)
	}
	affected, _ := result.RowsAffected()
	return pgconn.NewCommandTag(fmt.Sprintf("OK %d", affected)), nil
}

func (t *sqliteTx) Query(ctx context.Context, query string, args ...any) (pgx.Rows, error) {
	q := adaptSQL(query)
	rows, err := t.tx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, wrapErr(err)
	}
	return &sqliteRows{rows: rows}, nil
}

func (t *sqliteTx) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	q := adaptSQL(query)
	return &sqliteRow{row: t.tx.QueryRowContext(ctx, q, args...)}
}

func (t *sqliteTx) CopyFrom(_ context.Context, _ pgx.Identifier, _ []string, _ pgx.CopyFromSource) (int64, error) {
	return 0, fmt.Errorf("CopyFrom not supported in SQLite")
}

func (t *sqliteTx) SendBatch(_ context.Context, _ *pgx.Batch) pgx.BatchResults {
	return nil
}

func (t *sqliteTx) LargeObjects() pgx.LargeObjects {
	return pgx.LargeObjects{}
}

func (t *sqliteTx) Prepare(_ context.Context, _ string, _ string) (*pgconn.StatementDescription, error) {
	return nil, fmt.Errorf("Prepare not supported in SQLite adapter")
}

func (t *sqliteTx) Conn() *pgx.Conn {
	return nil
}
