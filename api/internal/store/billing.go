package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/marsshare/api/internal/model"
)

// ──────────────────────────────────────────────────────
// Wallet
// ──────────────────────────────────────────────────────

// GetWallet returns the user's current balance and recent ledger entries.
func (s *Store) GetWallet(ctx context.Context, userID string) (int64, []model.WalletLedger, error) {
	var balance int64
	if err := s.pool.QueryRow(ctx, `SELECT wallet_balance_cents FROM users WHERE id = $1`, userID).Scan(&balance); err != nil {
		return 0, nil, maybeErrNoRows(err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, type, amount_cents, balance_after, reference_type, reference_id, note, created_at
		FROM wallet_ledgers
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 50
	`, userID)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()

	ledgers := make([]model.WalletLedger, 0)
	for rows.Next() {
		var l model.WalletLedger
		if err := rows.Scan(
			&l.ID, &l.UserID, &l.Type, &l.AmountCents, &l.BalanceAfter,
			&l.ReferenceType, &l.ReferenceID, &l.Note, &l.CreatedAt,
		); err != nil {
			return 0, nil, err
		}
		ledgers = append(ledgers, l)
	}
	return balance, ledgers, rows.Err()
}

// CreditWallet adds funds to a user's wallet (atomic balance update + ledger insert).
func (s *Store) CreditWallet(ctx context.Context, userID string, amountCents int64, txType, refType, refID, note string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		var newBalance int64
		err := tx.QueryRow(ctx, `
			UPDATE users
			SET wallet_balance_cents = wallet_balance_cents + $2, updated_at = NOW()
			WHERE id = $1
			RETURNING wallet_balance_cents
		`, userID, amountCents).Scan(&newBalance)
		if err != nil {
			return err
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO wallet_ledgers (user_id, type, amount_cents, balance_after, reference_type, reference_id, note)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, userID, txType, amountCents, newBalance, refType, refID, note)
		return err
	})
}

// DebitWallet removes funds from a user's wallet. Returns an error if the balance is insufficient.
func (s *Store) DebitWallet(ctx context.Context, userID string, amountCents int64, txType, refType, refID, note string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		var balance int64
		if err := tx.QueryRow(ctx, `
			SELECT wallet_balance_cents FROM users WHERE id = $1 FOR UPDATE
		`, userID).Scan(&balance); err != nil {
			return err
		}
		if balance < amountCents {
			return errors.New("insufficient wallet balance")
		}

		var newBalance int64
		err := tx.QueryRow(ctx, `
			UPDATE users
			SET wallet_balance_cents = wallet_balance_cents - $2, updated_at = NOW()
			WHERE id = $1
			RETURNING wallet_balance_cents
		`, userID, amountCents).Scan(&newBalance)
		if err != nil {
			return err
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO wallet_ledgers (user_id, type, amount_cents, balance_after, reference_type, reference_id, note)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, userID, txType, -amountCents, newBalance, refType, refID, note)
		return err
	})
}

// ──────────────────────────────────────────────────────
// Membership plans
// ──────────────────────────────────────────────────────

// ListMembershipPlans returns all active membership plans (public).
func (s *Store) ListMembershipPlans(ctx context.Context) ([]model.MembershipPlan, error) {
	return s.queryMembershipPlans(ctx, true)
}

// ListAllMembershipPlans returns every membership plan including inactive ones (admin only).
func (s *Store) ListAllMembershipPlans(ctx context.Context) ([]model.MembershipPlan, error) {
	return s.queryMembershipPlans(ctx, false)
}

func (s *Store) queryMembershipPlans(ctx context.Context, activeOnly bool) ([]model.MembershipPlan, error) {
	where := ""
	if activeOnly {
		where = "WHERE is_active = TRUE"
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, slug, price_cents, duration_days, storage_policy_id,
		       storage_quota_bytes, upload_limit_bytes, is_active, sort_order
		FROM membership_plans
		`+where+`
		ORDER BY sort_order ASC, price_cents ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	plans := make([]model.MembershipPlan, 0)
	for rows.Next() {
		var p model.MembershipPlan
		if err := rows.Scan(
			&p.ID, &p.Name, &p.Slug, &p.PriceCents, &p.DurationDays, &p.StoragePolicyID,
			&p.StorageQuotaBytes, &p.UploadLimitBytes, &p.IsActive, &p.SortOrder,
		); err != nil {
			return nil, err
		}
		plans = append(plans, p)
	}
	return plans, rows.Err()
}

// CreateMembershipPlan inserts a new membership plan.
func (s *Store) CreateMembershipPlan(ctx context.Context, p *model.MembershipPlan) error {
	if strings.TrimSpace(p.Name) == "" {
		return errors.New("name is required")
	}
	if strings.TrimSpace(p.Slug) == "" {
		return errors.New("slug is required")
	}
	if p.DurationDays <= 0 {
		return errors.New("duration_days must be positive")
	}
	return s.pool.QueryRow(ctx, `
		INSERT INTO membership_plans (name, slug, price_cents, duration_days, storage_policy_id,
		                              storage_quota_bytes, upload_limit_bytes, is_active, sort_order)
		VALUES ($1, $2, $3, $4, NULLIF($5, '')::uuid, $6, $7, $8, $9)
		RETURNING id
	`,
		p.Name, p.Slug, p.PriceCents, p.DurationDays, ptrOrEmpty(p.StoragePolicyID),
		p.StorageQuotaBytes, p.UploadLimitBytes, p.IsActive, p.SortOrder,
	).Scan(&p.ID)
}

// UpdateMembershipPlan updates an existing plan.
func (s *Store) UpdateMembershipPlan(ctx context.Context, p *model.MembershipPlan) error {
	if p.ID == "" {
		return errors.New("plan id is required")
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE membership_plans
		SET name = $2, slug = $3, price_cents = $4, duration_days = $5,
		    storage_policy_id = NULLIF($6, '')::uuid,
		    storage_quota_bytes = $7, upload_limit_bytes = $8,
		    is_active = $9, sort_order = $10
		WHERE id = $1
	`,
		p.ID, p.Name, p.Slug, p.PriceCents, p.DurationDays, ptrOrEmpty(p.StoragePolicyID),
		p.StorageQuotaBytes, p.UploadLimitBytes, p.IsActive, p.SortOrder,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("plan not found")
	}
	return nil
}

// DeleteMembershipPlan removes a plan. Fails if any user currently references it.
func (s *Store) DeleteMembershipPlan(ctx context.Context, planID string) error {
	var inUse bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM users WHERE membership_plan_id = $1)
	`, planID).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return errors.New("plan is in use by one or more users — disable it instead")
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM membership_plans WHERE id = $1`, planID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("plan not found")
	}
	return nil
}

// ptrOrEmpty returns the dereferenced string or empty if nil — used so SQL
// NULLIF($, '')::uuid can convert to NULL when no value is set.
func ptrOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// PurchaseMembership debits the user's wallet and adds a membership row to
// the user's stack. Multiple memberships are consumed top-tier-first by the
// daily worker; the user's effective plan is recomputed after the insert.
func (s *Store) PurchaseMembership(ctx context.Context, userID, planID string) error {
	defStorage, defUpload := s.GetDefaultUserQuotas(ctx)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		// Load plan.
		var plan model.MembershipPlan
		if err := tx.QueryRow(ctx, `
			SELECT id, name, slug, price_cents, duration_days, storage_policy_id,
			       storage_quota_bytes, upload_limit_bytes, is_active, sort_order
			FROM membership_plans
			WHERE id = $1 AND is_active = TRUE
		`, planID).Scan(
			&plan.ID, &plan.Name, &plan.Slug, &plan.PriceCents, &plan.DurationDays, &plan.StoragePolicyID,
			&plan.StorageQuotaBytes, &plan.UploadLimitBytes, &plan.IsActive, &plan.SortOrder,
		); err != nil {
			return maybeErrNoRows(err)
		}

		// Check balance.
		var balance int64
		if err := tx.QueryRow(ctx, `SELECT wallet_balance_cents FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&balance); err != nil {
			return err
		}
		if balance < plan.PriceCents {
			return errors.New("insufficient wallet balance")
		}

		// started_at / ends_at are kept on the row for human-readable history
		// only — the queue order is decided by tier + created_at and the
		// running total comes from duration_days/consumed_days.
		start := time.Now()
		ends := start.Add(time.Duration(plan.DurationDays) * 24 * time.Hour)

		if _, err := tx.Exec(ctx, `
			INSERT INTO memberships (user_id, plan_id, started_at, ends_at, duration_days, consumed_days, source_type, source_id)
			VALUES ($1, $2, $3, $4, $5, 0, 'wallet', $6)
		`, userID, planID, start, ends, plan.DurationDays, planID); err != nil {
			return err
		}

		// Debit wallet + ledger.
		var newBalance int64
		if err := tx.QueryRow(ctx, `
			UPDATE users
			SET wallet_balance_cents = wallet_balance_cents - $2, updated_at = NOW()
			WHERE id = $1
			RETURNING wallet_balance_cents
		`, userID, plan.PriceCents).Scan(&newBalance); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO wallet_ledgers (user_id, type, amount_cents, balance_after, reference_type, reference_id, note)
			VALUES ($1, 'membership_purchase', $2, $3, 'membership_plan', $4, $5)
		`, userID, -plan.PriceCents, newBalance, planID, fmt.Sprintf("购买%s", plan.Name)); err != nil {
			return err
		}

		// Recompute effective state from the full stack.
		return recomputeUserMembershipTx(ctx, tx, userID, defStorage, defUpload)
	})
}

// recomputeUserMembershipTx walks the user's membership stack and refreshes
// the cached fields on `users` (membership_plan_id, membership_ends_at,
// storage_quota_bytes, upload_limit_bytes).
//
// Selection rules:
//   - Active row = consumed_days < duration_days
//   - Order by tier desc (storage then sort_order), tie-break by created_at asc
//   - The TOP row decides the current plan & quotas
//   - The total remaining time = sum of remaining days across ALL active rows
func recomputeUserMembershipTx(ctx context.Context, tx pgx.Tx, userID string, defaultStorage, defaultUpload int64) error {
	rows, err := tx.Query(ctx, `
		SELECT m.plan_id, (m.duration_days - m.consumed_days) AS remaining,
		       mp.storage_quota_bytes, mp.upload_limit_bytes
		FROM memberships m
		JOIN membership_plans mp ON mp.id = m.plan_id
		WHERE m.user_id = $1 AND m.consumed_days < m.duration_days
		ORDER BY mp.storage_quota_bytes DESC, mp.sort_order DESC, m.created_at ASC
	`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()

	var (
		topPlanID       string
		topStorage      int64
		topUploadLimit  int64
		totalRemaining  int
		anyActive       bool
		first           = true
	)
	for rows.Next() {
		var (
			planID    string
			remaining int
			sq, ul    int64
		)
		if err := rows.Scan(&planID, &remaining, &sq, &ul); err != nil {
			return err
		}
		if first {
			topPlanID = planID
			topStorage = sq
			topUploadLimit = ul
			first = false
		}
		totalRemaining += remaining
		anyActive = true
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if anyActive {
		endsAt := time.Now().Add(time.Duration(totalRemaining) * 24 * time.Hour)
		_, err := tx.Exec(ctx, `
			UPDATE users
			SET membership_plan_id = $2,
			    membership_ends_at = $3,
			    storage_quota_bytes = GREATEST(storage_quota_bytes, $4),
			    upload_limit_bytes  = GREATEST(upload_limit_bytes,  $5),
			    updated_at = NOW()
			WHERE id = $1
		`, userID, topPlanID, endsAt, topStorage, topUploadLimit)
		return err
	}

	// No active rows — downgrade to free-tier defaults.
	_, err = tx.Exec(ctx, `
		UPDATE users
		SET membership_plan_id = NULL,
		    membership_ends_at = NULL,
		    storage_quota_bytes = $2,
		    upload_limit_bytes  = $3,
		    updated_at = NOW()
		WHERE id = $1
	`, userID, defaultStorage, defaultUpload)
	return err
}

// ListUserMemberships returns all memberships for a user (active and exhausted)
// joined with their plan details. Active rows come first, ordered by tier.
func (s *Store) ListUserMemberships(ctx context.Context, userID string) ([]model.Membership, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT m.id, m.user_id, m.plan_id, m.started_at, m.ends_at,
		       m.duration_days, m.consumed_days, m.source_type, m.source_id, m.created_at,
		       mp.name, mp.slug, mp.storage_quota_bytes, mp.upload_limit_bytes
		FROM memberships m
		JOIN membership_plans mp ON mp.id = m.plan_id
		WHERE m.user_id = $1
		ORDER BY (m.consumed_days < m.duration_days) DESC,
		         mp.storage_quota_bytes DESC, mp.sort_order DESC, m.created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]model.Membership, 0)
	for rows.Next() {
		var m model.Membership
		if err := rows.Scan(
			&m.ID, &m.UserID, &m.PlanID, &m.StartedAt, &m.EndsAt,
			&m.DurationDays, &m.ConsumedDays, &m.SourceType, &m.SourceID, &m.CreatedAt,
			&m.PlanName, &m.PlanSlug, &m.PlanStorage, &m.PlanUploadLimit,
		); err != nil {
			return nil, err
		}
		m.RemainingDays = m.DurationDays - m.ConsumedDays
		if m.RemainingDays < 0 {
			m.RemainingDays = 0
		}
		m.IsActive = m.RemainingDays > 0
		out = append(out, m)
	}
	return out, rows.Err()
}

// ──────────────────────────────────────────────────────
// Redeem codes
// ──────────────────────────────────────────────────────

// GetRedeemCode returns a redeem code by its code string.
func (s *Store) GetRedeemCode(ctx context.Context, code string) (*model.RedeemCode, error) {
	var rc model.RedeemCode
	err := s.pool.QueryRow(ctx, `
		SELECT id, batch_id, code, amount_cents, redeemed_by, redeemed_at
		FROM redeem_codes
		WHERE code = $1
	`, code).Scan(&rc.ID, &rc.BatchID, &rc.Code, &rc.AmountCents, &rc.RedeemedBy, &rc.RedeemedAt)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	return &rc, nil
}

// RedeemCode validates and redeems a code, crediting the user's wallet.
func (s *Store) RedeemCode(ctx context.Context, userID, code string) error {
	return s.withTx(ctx, func(tx pgx.Tx) error {
		var redeemID string
		var amount int64
		if err := tx.QueryRow(ctx, `
			SELECT id, amount_cents
			FROM redeem_codes
			WHERE code = $1 AND redeemed_at IS NULL
			FOR UPDATE
		`, code).Scan(&redeemID, &amount); err != nil {
			return maybeErrNoRows(err)
		}

		// Mark code as redeemed.
		if _, err := tx.Exec(ctx, `
			UPDATE redeem_codes SET redeemed_by = $2, redeemed_at = NOW() WHERE id = $1
		`, redeemID, userID); err != nil {
			return err
		}

		// Increment batch redeemed_count.
		if _, err := tx.Exec(ctx, `
			UPDATE redeem_batches SET redeemed_count = redeemed_count + 1
			WHERE id = (SELECT batch_id FROM redeem_codes WHERE id = $1)
		`, redeemID); err != nil {
			return err
		}

		// Credit wallet.
		var newBalance int64
		if err := tx.QueryRow(ctx, `
			UPDATE users
			SET wallet_balance_cents = wallet_balance_cents + $2, updated_at = NOW()
			WHERE id = $1
			RETURNING wallet_balance_cents
		`, userID, amount).Scan(&newBalance); err != nil {
			return err
		}

		_, err := tx.Exec(ctx, `
			INSERT INTO wallet_ledgers (user_id, type, amount_cents, balance_after, reference_type, reference_id, note)
			VALUES ($1, 'redeem_code', $2, $3, 'redeem_code', $4, $5)
		`, userID, amount, newBalance, redeemID, fmt.Sprintf("兑换码充值 %s", code))
		return err
	})
}

// CreateRedeemBatch creates a batch of redeem codes.
func (s *Store) CreateRedeemBatch(ctx context.Context, name string, amountCents int64, count int, createdBy string) (*model.RedeemBatch, error) {
	var batch model.RedeemBatch
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO redeem_batches (name, amount_cents, total_count, created_by)
			VALUES ($1, $2, $3, $4)
			RETURNING id, name, amount_cents, total_count, redeemed_count, created_by, created_at
		`, name, amountCents, count, createdBy).Scan(
			&batch.ID, &batch.Name, &batch.AmountCents, &batch.TotalCount,
			&batch.RedeemedCount, &batch.CreatedBy, &batch.CreatedAt,
		); err != nil {
			return err
		}

		for i := 0; i < count; i++ {
			code := randomCode(12)
			if _, err := tx.Exec(ctx, `
				INSERT INTO redeem_codes (batch_id, code, amount_cents) VALUES ($1, $2, $3)
			`, batch.ID, code, amountCents); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &batch, nil
}

// ListRedeemBatches returns all redeem batches.
func (s *Store) ListRedeemBatches(ctx context.Context) ([]model.RedeemBatch, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, amount_cents, total_count, redeemed_count, created_by, created_at
		FROM redeem_batches
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.RedeemBatch, 0)
	for rows.Next() {
		var b model.RedeemBatch
		if err := rows.Scan(
			&b.ID, &b.Name, &b.AmountCents, &b.TotalCount, &b.RedeemedCount, &b.CreatedBy, &b.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, b)
	}
	return items, rows.Err()
}

// ListRedeemCodes returns all codes in a batch.
func (s *Store) ListRedeemCodes(ctx context.Context, batchID string) ([]model.RedeemCode, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, batch_id, code, amount_cents, redeemed_by, redeemed_at
		FROM redeem_codes
		WHERE batch_id = $1
		ORDER BY created_at ASC
	`, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.RedeemCode, 0)
	for rows.Next() {
		var rc model.RedeemCode
		if err := rows.Scan(&rc.ID, &rc.BatchID, &rc.Code, &rc.AmountCents, &rc.RedeemedBy, &rc.RedeemedAt); err != nil {
			return nil, err
		}
		items = append(items, rc)
	}
	return items, rows.Err()
}

// ──────────────────────────────────────────────────────
// Stripe orders
// ──────────────────────────────────────────────────────

// CreateStripeOrder inserts a new pending stripe order row.
// `planID` may be empty for kind="recharge".
func (s *Store) CreateStripeOrder(ctx context.Context, userID, sessionID, kind, planID string, amountCents int64, currency string) (*model.StripeOrder, error) {
	var o model.StripeOrder
	err := s.pool.QueryRow(ctx, `
		INSERT INTO stripe_orders (user_id, session_id, kind, plan_id, amount_cents, currency)
		VALUES ($1, $2, $3, NULLIF($4, '')::uuid, $5, $6)
		RETURNING id, user_id, session_id, payment_intent, kind, plan_id, amount_cents, currency, status, paid_at, created_at, updated_at
	`, userID, sessionID, kind, planID, amountCents, currency).Scan(
		&o.ID, &o.UserID, &o.SessionID, &o.PaymentIntent, &o.Kind, &o.PlanID,
		&o.AmountCents, &o.Currency, &o.Status, &o.PaidAt, &o.CreatedAt, &o.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// GetStripeOrderBySession returns the stripe order linked to the given Checkout Session.
func (s *Store) GetStripeOrderBySession(ctx context.Context, sessionID string) (*model.StripeOrder, error) {
	var o model.StripeOrder
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, session_id, payment_intent, kind, plan_id, amount_cents, currency, status, paid_at, created_at, updated_at
		FROM stripe_orders
		WHERE session_id = $1
	`, sessionID).Scan(
		&o.ID, &o.UserID, &o.SessionID, &o.PaymentIntent, &o.Kind, &o.PlanID,
		&o.AmountCents, &o.Currency, &o.Status, &o.PaidAt, &o.CreatedAt, &o.UpdatedAt,
	)
	if err != nil {
		return nil, maybeErrNoRows(err)
	}
	return &o, nil
}

// FulfillStripeOrder marks the order as paid and applies its side effects
// (credit wallet, optionally activate membership) atomically. Idempotent: if
// the order is already paid the function returns nil without re-applying.
//
// `creditMultiplier` is the wallet-credit-cents-per-payment-cent rate. With
// the default value of 1.0, paying 100 cents credits 100 wallet cents (i.e.
// the wallet balance is denominated in the same unit as Stripe charges).
func (s *Store) FulfillStripeOrder(ctx context.Context, sessionID, paymentIntent string, creditMultiplier float64) error {
	if creditMultiplier <= 0 {
		creditMultiplier = 1.0
	}
	defStorage, defUpload := s.GetDefaultUserQuotas(ctx)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		var (
			id          string
			userID      string
			kind        string
			planID      *string
			amountCents int64
			status      string
		)
		err := tx.QueryRow(ctx, `
			SELECT id, user_id, kind, plan_id, amount_cents, status
			FROM stripe_orders
			WHERE session_id = $1
			FOR UPDATE
		`, sessionID).Scan(&id, &userID, &kind, &planID, &amountCents, &status)
		if err != nil {
			return maybeErrNoRows(err)
		}
		if status == "paid" {
			return nil // already fulfilled
		}

		// Mark order as paid first.
		if _, err := tx.Exec(ctx, `
			UPDATE stripe_orders
			SET status = 'paid', payment_intent = $2, paid_at = NOW(), updated_at = NOW()
			WHERE id = $1
		`, id, paymentIntent); err != nil {
			return err
		}

		// Compute wallet credit amount.
		creditCents := int64(float64(amountCents) * creditMultiplier)
		if creditCents <= 0 {
			creditCents = amountCents
		}

		// Always credit the wallet — keeps the ledger consistent.
		var newBalance int64
		if err := tx.QueryRow(ctx, `
			UPDATE users
			SET wallet_balance_cents = wallet_balance_cents + $2, updated_at = NOW()
			WHERE id = $1
			RETURNING wallet_balance_cents
		`, userID, creditCents).Scan(&newBalance); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO wallet_ledgers (user_id, type, amount_cents, balance_after, reference_type, reference_id, note)
			VALUES ($1, 'stripe_recharge', $2, $3, 'stripe_order', $4, $5)
		`, userID, creditCents, newBalance, id, fmt.Sprintf("Stripe 充值 %s", sessionID)); err != nil {
			return err
		}

		// For membership orders, immediately debit + push to the user's stack.
		if kind == "membership" && planID != nil && *planID != "" {
			var plan model.MembershipPlan
			if err := tx.QueryRow(ctx, `
				SELECT id, name, slug, price_cents, duration_days, storage_policy_id,
				       storage_quota_bytes, upload_limit_bytes, is_active, sort_order
				FROM membership_plans
				WHERE id = $1
			`, *planID).Scan(
				&plan.ID, &plan.Name, &plan.Slug, &plan.PriceCents, &plan.DurationDays, &plan.StoragePolicyID,
				&plan.StorageQuotaBytes, &plan.UploadLimitBytes, &plan.IsActive, &plan.SortOrder,
			); err != nil {
				return fmt.Errorf("load membership plan: %w", err)
			}
			// Skip activation if the credited amount cannot cover the plan
			// (admin may have changed prices between checkout and webhook).
			if newBalance < plan.PriceCents {
				return nil
			}

			start := time.Now()
			ends := start.Add(time.Duration(plan.DurationDays) * 24 * time.Hour)

			if _, err := tx.Exec(ctx, `
				INSERT INTO memberships (user_id, plan_id, started_at, ends_at, duration_days, consumed_days, source_type, source_id)
				VALUES ($1, $2, $3, $4, $5, 0, 'stripe', $6)
			`, userID, plan.ID, start, ends, plan.DurationDays, sessionID); err != nil {
				return err
			}

			var afterDebit int64
			if err := tx.QueryRow(ctx, `
				UPDATE users
				SET wallet_balance_cents = wallet_balance_cents - $2, updated_at = NOW()
				WHERE id = $1
				RETURNING wallet_balance_cents
			`, userID, plan.PriceCents).Scan(&afterDebit); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO wallet_ledgers (user_id, type, amount_cents, balance_after, reference_type, reference_id, note)
				VALUES ($1, 'membership_purchase', $2, $3, 'membership_plan', $4, $5)
			`, userID, -plan.PriceCents, afterDebit, plan.ID, fmt.Sprintf("购买%s", plan.Name)); err != nil {
				return err
			}
			return recomputeUserMembershipTx(ctx, tx, userID, defStorage, defUpload)
		}
		return nil
	})
}

// AdminListStripeOrders returns all stripe orders joined with user / plan info,
// supporting cursor pagination and an optional status filter.
func (s *Store) AdminListStripeOrders(ctx context.Context, status string, params model.PageParams) (*model.PageResult[model.StripeOrder], error) {
	limit := defaultPageLimit(params.Limit)
	args := make([]any, 0, 3)
	where := "WHERE 1=1"

	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(` AND so.status = $%d`, len(args))
	}
	if params.Cursor != "" {
		t, err := time.Parse(time.RFC3339Nano, params.Cursor)
		if err == nil {
			args = append(args, t)
			where += fmt.Sprintf(` AND so.created_at < $%d`, len(args))
		}
	}
	args = append(args, limit+1)

	sql := fmt.Sprintf(`
		SELECT so.id, so.user_id, so.session_id, so.payment_intent, so.kind, so.plan_id,
		       so.amount_cents, so.currency, so.status, so.paid_at, so.created_at, so.updated_at,
		       u.username, u.email, u.display_name, mp.name
		FROM stripe_orders so
		JOIN users u ON u.id = so.user_id
		LEFT JOIN membership_plans mp ON mp.id = so.plan_id
		%s
		ORDER BY so.created_at DESC
		LIMIT $%d
	`, where, len(args))

	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.StripeOrder, 0, limit)
	for rows.Next() {
		var o model.StripeOrder
		if err := rows.Scan(
			&o.ID, &o.UserID, &o.SessionID, &o.PaymentIntent, &o.Kind, &o.PlanID,
			&o.AmountCents, &o.Currency, &o.Status, &o.PaidAt, &o.CreatedAt, &o.UpdatedAt,
			&o.Username, &o.UserEmail, &o.DisplayName, &o.PlanName,
		); err != nil {
			return nil, err
		}
		items = append(items, o)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := &model.PageResult[model.StripeOrder]{Items: items}
	if len(items) > limit {
		result.Items = items[:limit]
		result.NextCursor = items[limit-1].CreatedAt.Format(time.RFC3339Nano)
	}
	return result, nil
}

// MarkStripeOrderFailed transitions the order to a terminal failed/canceled state.
func (s *Store) MarkStripeOrderFailed(ctx context.Context, sessionID, status string) error {
	if status != "failed" && status != "canceled" {
		status = "failed"
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE stripe_orders
		SET status = $2, updated_at = NOW()
		WHERE session_id = $1 AND status = 'pending'
	`, sessionID, status)
	return err
}

// AdvanceMembershipsDaily consumes one day from each user's currently
// highest-tier active membership and refreshes their cached effective state.
//
// Top-tier first means: when a user holds, say, a year + a month, the year
// is fully consumed before the month starts being decremented.
//
// `days` is how many days to advance (used by the worker to catch up when it
// has been offline for a while). 1 = a normal nightly tick.
func (s *Store) AdvanceMembershipsDaily(ctx context.Context, days int) error {
	if days <= 0 {
		return nil
	}
	defStorage, defUpload := s.GetDefaultUserQuotas(ctx)
	return s.withTx(ctx, func(tx pgx.Tx) error {
		// Collect every user that currently has at least one active row.
		userRows, err := tx.Query(ctx, `
			SELECT DISTINCT user_id
			FROM memberships
			WHERE consumed_days < duration_days
		`)
		if err != nil {
			return err
		}
		userIDs := make([]string, 0)
		for userRows.Next() {
			var uid string
			if err := userRows.Scan(&uid); err != nil {
				userRows.Close()
				return err
			}
			userIDs = append(userIDs, uid)
		}
		userRows.Close()
		if err := userRows.Err(); err != nil {
			return err
		}

		for _, uid := range userIDs {
			// Consume `days` days, top-tier first. After each tick the next
			// tier may take over, so we re-query in a loop.
			remaining := days
			for remaining > 0 {
				var membershipID string
				var membershipRemaining int
				err := tx.QueryRow(ctx, `
					SELECT m.id, (m.duration_days - m.consumed_days)
					FROM memberships m
					JOIN membership_plans mp ON mp.id = m.plan_id
					WHERE m.user_id = $1 AND m.consumed_days < m.duration_days
					ORDER BY mp.storage_quota_bytes DESC, mp.sort_order DESC, m.created_at ASC
					LIMIT 1
				`, uid).Scan(&membershipID, &membershipRemaining)
				if err != nil {
					if err == pgx.ErrNoRows {
						break // user has no more active memberships
					}
					return err
				}
				take := remaining
				if take > membershipRemaining {
					take = membershipRemaining
				}
				if _, err := tx.Exec(ctx, `
					UPDATE memberships
					SET consumed_days = consumed_days + $2
					WHERE id = $1
				`, membershipID, take); err != nil {
					return err
				}
				remaining -= take
			}
			if err := recomputeUserMembershipTx(ctx, tx, uid, defStorage, defUpload); err != nil {
				return err
			}
		}
		return nil
	})
}

// ExpireMemberships kept as a thin shim around AdvanceMembershipsDaily(1) so
// older callers (and bg worker code that hasn't been updated yet) still link.
func (s *Store) ExpireMemberships(ctx context.Context) error {
	return s.AdvanceMembershipsDaily(ctx, 1)
}
