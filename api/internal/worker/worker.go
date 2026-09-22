package worker

import (
	"context"
	"log"
	"time"

	"github.com/marsshare/api/internal/store"
)

const oneDay = 24 * time.Hour

type Worker struct {
	store    *store.Store
	interval time.Duration
}

func New(appStore *store.Store, interval time.Duration) *Worker {
	return &Worker{store: appStore, interval: interval}
}

func (w *Worker) Run(ctx context.Context) error {
	// Run once immediately on start
	w.runAll(ctx)

	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			w.runAll(ctx)
		}
	}
}

func (w *Worker) runAll(ctx context.Context) {
	w.runTask(ctx, "advance memberships", w.advanceMemberships)
	w.runTask(ctx, "refresh trending scores", w.store.RefreshTrendingScores)
	w.runTask(ctx, "recompute hot searches", w.store.RecomputeHotSearches)
	w.runTask(ctx, "cleanup old post views", w.store.CleanupOldPostViews)
	w.runTask(ctx, "cleanup expired sessions", w.store.DeleteExpiredSessions)
	w.runTask(ctx, "cleanup orphaned objects", w.store.CleanupOrphanedObjects)
	w.runTask(ctx, "generate file previews", w.generatePreviews)
}

// advanceMemberships consumes one day from each user's top-tier active
// membership. Throttled to once per 24h via a system_settings timestamp so
// that the worker's normal short tick interval doesn't accelerate expiry.
//
// On first run (no timestamp yet), or if the worker has been offline for
// several days, it catches up by advancing the missed days in one go.
func (w *Worker) advanceMemberships(ctx context.Context) error {
	now := time.Now()
	last, _ := w.store.GetSetting(ctx, store.SettingMembershipAdvancedAt)
	if last == "" {
		// Initialise on first run — don't consume anything yet, just record
		// the baseline so we start counting from now.
		return w.store.UpsertSetting(ctx, store.SettingMembershipAdvancedAt, now.UTC().Format(time.RFC3339), false, "")
	}
	lastT, err := time.Parse(time.RFC3339, last)
	if err != nil {
		// Stored value is corrupt — reset to now so we don't repeatedly fail.
		return w.store.UpsertSetting(ctx, store.SettingMembershipAdvancedAt, now.UTC().Format(time.RFC3339), false, "")
	}
	elapsed := now.Sub(lastT)
	if elapsed < oneDay {
		return nil
	}
	days := int(elapsed / oneDay)
	if err := w.store.AdvanceMembershipsDaily(ctx, days); err != nil {
		return err
	}
	// Roll the timestamp forward by exactly the days we consumed (preserve
	// the sub-day remainder so daily ticks stay aligned).
	next := lastT.Add(time.Duration(days) * oneDay)
	return w.store.UpsertSetting(ctx, store.SettingMembershipAdvancedAt, next.UTC().Format(time.RFC3339), false, "")
}

// generatePreviews is a placeholder for future PDF/image preview generation.
func (w *Worker) generatePreviews(ctx context.Context) error {
	// TODO: query objects with preview_status='pending', generate thumbnails,
	// update preview_status and preview_object_key.
	return nil
}

func (w *Worker) runTask(ctx context.Context, name string, fn func(context.Context) error) {
	if err := fn(ctx); err != nil {
		log.Printf("[worker] %s failed: %v", name, err)
	}
}
