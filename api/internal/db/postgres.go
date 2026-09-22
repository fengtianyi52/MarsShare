package db

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresDB wraps pgxpool.Pool to satisfy the DB interface.
type PostgresDB struct {
	Pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *PostgresDB {
	return &PostgresDB{Pool: pool}
}

func (p *PostgresDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return p.Pool.Exec(ctx, sql, args...)
}

func (p *PostgresDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return p.Pool.Query(ctx, sql, args...)
}

func (p *PostgresDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return p.Pool.QueryRow(ctx, sql, args...)
}

func (p *PostgresDB) BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error) {
	return p.Pool.BeginTx(ctx, opts)
}

func (p *PostgresDB) Dialect() Dialect {
	return DialectPostgres
}
