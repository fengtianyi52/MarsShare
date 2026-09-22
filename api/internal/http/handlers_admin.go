package httpapi

import (
	"context"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/marsshare/api/internal/model"
	"github.com/marsshare/api/internal/storage"
	"github.com/marsshare/api/internal/store"
)

// audit logs an admin action asynchronously (best-effort, does not block the response).
func (h *Handler) audit(c *gin.Context, action, targetType, targetID string, payload any) {
	// Use background context since the request may complete before this finishes
	go func() {
		_ = h.store.CreateAuditLog(c.Copy().Request.Context(), getUserID(c), action, targetType, targetID, payload)
	}()
}

// ────────────────────────────────────────────────────────────
// Dashboard
// ────────────────────────────────────────────────────────────

func (h *Handler) adminDashboard(c *gin.Context) {
	ctx := c.Request.Context()
	dashboard, err := h.store.AdminDashboard(ctx)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load dashboard")
		return
	}
	ok(c, dashboard)
}

// ────────────────────────────────────────────────────────────
// Users
// ────────────────────────────────────────────────────────────

func (h *Handler) adminUsers(c *gin.Context) {
	ctx := c.Request.Context()
	query := c.DefaultQuery("query", "")
	params := getPageParams(c)

	result, err := h.store.AdminListUsers(ctx, query, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load users")
		return
	}
	ok(c, result)
}

func (h *Handler) adminSetBan(c *gin.Context) {
	var req struct {
		Banned bool `json:"banned"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request")
		return
	}

	ctx := c.Request.Context()
	targetID := c.Param("id")
	if err := h.store.AdminSetBan(ctx, targetID, req.Banned); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update user ban status")
		return
	}
	h.audit(c, "set_ban", "user", targetID, req)
	ok(c, gin.H{"updated": true})
}

// ────────────────────────────────────────────────────────────
// Posts
// ────────────────────────────────────────────────────────────

func (h *Handler) adminPosts(c *gin.Context) {
	ctx := c.Request.Context()
	status := c.DefaultQuery("status", "")
	params := getPageParams(c)

	result, err := h.store.AdminListPosts(ctx, status, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load posts")
		return
	}
	ok(c, result)
}

func (h *Handler) adminSetPostStatus(c *gin.Context) {
	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "status is required")
		return
	}

	ctx := c.Request.Context()
	targetID := c.Param("id")
	if err := h.store.AdminSetPostStatus(ctx, targetID, req.Status); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update post status")
		return
	}
	h.audit(c, "set_post_status", "post", targetID, req)
	ok(c, gin.H{"updated": true})
}

// adminHardDeletePost permanently removes a post, its attached drive nodes,
// and any now-orphaned storage objects. Intended only for posts that have
// already been soft-deleted (status='deleted') or hidden, but is not enforced.
func (h *Handler) adminHardDeletePost(c *gin.Context) {
	ctx := c.Request.Context()
	postID := c.Param("id")

	objects, err := h.store.AdminHardDeletePost(ctx, postID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to delete post")
		return
	}

	// Best-effort storage cleanup outside the DB transaction.
	for _, obj := range objects {
		if err := h.storage.Delete(ctx, obj.PolicyID, []string{obj.ObjectKey}); err != nil {
			log.Printf("adminHardDeletePost: delete storage %q: %v", obj.ObjectKey, err)
		}
	}

	h.audit(c, "hard_delete_post", "post", postID, gin.H{"objects_deleted": len(objects)})
	ok(c, gin.H{"deleted": true})
}

// ────────────────────────────────────────────────────────────
// Topic management
// ────────────────────────────────────────────────────────────

func (h *Handler) adminListTopics(c *gin.Context) {
	ctx := c.Request.Context()
	params := getPageParams(c)

	result, err := h.store.AdminListTopics(ctx, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load topics")
		return
	}
	ok(c, result)
}

func (h *Handler) adminBanTopic(c *gin.Context) {
	var req struct {
		Banned bool `json:"banned"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request")
		return
	}

	ctx := c.Request.Context()
	topicID := c.Param("id")

	if err := h.store.AdminBanTopic(ctx, topicID, req.Banned); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update topic")
		return
	}

	action := "unban_topic"
	if req.Banned {
		action = "ban_topic"
	}
	h.audit(c, action, "topic", topicID, req)
	ok(c, gin.H{"updated": true})
}

func (h *Handler) adminDeleteTopic(c *gin.Context) {
	ctx := c.Request.Context()
	topicID := c.Param("id")

	// Get all posts in this topic, then hard-delete them with storage cleanup.
	postIDs, err := h.store.AdminGetTopicPostIDs(ctx, topicID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to get topic posts")
		return
	}

	for _, postID := range postIDs {
		objects, err := h.store.AdminHardDeletePost(ctx, postID)
		if err != nil {
			log.Printf("adminDeleteTopic: hard delete post %s: %v", postID, err)
			continue
		}
		for _, obj := range objects {
			if err := h.storage.Delete(ctx, obj.PolicyID, []string{obj.ObjectKey}); err != nil {
				log.Printf("adminDeleteTopic: delete storage %q: %v", obj.ObjectKey, err)
			}
		}
	}

	if err := h.store.AdminDeleteTopic(ctx, topicID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to delete topic")
		return
	}

	h.audit(c, "delete_topic", "topic", topicID, gin.H{"posts_deleted": len(postIDs)})
	ok(c, gin.H{"deleted": true, "posts_deleted": len(postIDs)})
}

// ────────────────────────────────────────────────────────────
// Reports
// ────────────────────────────────────────────────────────────

func (h *Handler) adminReports(c *gin.Context) {
	ctx := c.Request.Context()
	status := c.DefaultQuery("status", "")
	params := getPageParams(c)

	result, err := h.store.AdminListReports(ctx, status, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load reports")
		return
	}
	ok(c, result)
}

func (h *Handler) adminResolveReport(c *gin.Context) {
	var req struct {
		Resolution string `json:"resolution" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "resolution is required")
		return
	}

	ctx := c.Request.Context()
	adminID := getUserID(c)

	reportID := c.Param("id")
	if err := h.store.AdminResolveReport(ctx, reportID, adminID, req.Resolution); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to resolve report")
		return
	}
	h.audit(c, "resolve_report", "report", reportID, req)
	ok(c, gin.H{"resolved": true})
}

// ────────────────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────────────────

func (h *Handler) adminSettings(c *gin.Context) {
	ctx := c.Request.Context()
	settings, err := h.store.GetAllSettings(ctx)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load settings")
		return
	}
	ok(c, settings)
}

func (h *Handler) adminUpsertSetting(c *gin.Context) {
	var req struct {
		Key      string `json:"key" binding:"required"`
		Value    string `json:"value" binding:"required"`
		IsSecret bool   `json:"is_secret"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "key and value are required")
		return
	}

	ctx := c.Request.Context()
	adminID := getUserID(c)

	if err := h.store.UpsertSetting(ctx, req.Key, req.Value, req.IsSecret, adminID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update setting")
		return
	}
	h.audit(c, "upsert_setting", "setting", req.Key, gin.H{"is_secret": req.IsSecret})
	ok(c, gin.H{"updated": true})
}

// ────────────────────────────────────────────────────────────
// Stripe orders (admin view)
// ────────────────────────────────────────────────────────────

func (h *Handler) adminListStripeOrders(c *gin.Context) {
	ctx := c.Request.Context()
	status := c.DefaultQuery("status", "")
	params := getPageParams(c)

	result, err := h.store.AdminListStripeOrders(ctx, status, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load stripe orders")
		return
	}
	ok(c, result)
}

// ────────────────────────────────────────────────────────────
// Redeem batches
// ────────────────────────────────────────────────────────────

func (h *Handler) adminCreateRedeemBatch(c *gin.Context) {
	var req struct {
		Name        string `json:"name" binding:"required"`
		AmountCents int64  `json:"amount_cents" binding:"required"`
		Count       int    `json:"count" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	adminID := getUserID(c)

	batch, err := h.store.CreateRedeemBatch(ctx, req.Name, req.AmountCents, req.Count, adminID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create redeem batch")
		return
	}

	// Get the codes for this batch
	codes, err := h.store.ListRedeemCodes(ctx, batch.ID)
	if err != nil {
		// Return batch without codes
		created(c, batch)
		return
	}

	created(c, gin.H{
		"batch": batch,
		"codes": codes,
	})
}

func (h *Handler) adminListRedeemBatches(c *gin.Context) {
	ctx := c.Request.Context()
	batches, err := h.store.ListRedeemBatches(ctx)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load redeem batches")
		return
	}
	ok(c, gin.H{"items": batches})
}

// ────────────────────────────────────────────────────────────
// Storage policies
// ────────────────────────────────────────────────────────────

// storagePolicyInput is the request DTO for create/update storage policy.
// We can't bind directly to model.StoragePolicy because AccessKey/SecretKey
// are tagged json:"-" (to hide them in responses), which also discards them
// on input.
type storagePolicyInput struct {
	Name             string `json:"name"`
	Type             string `json:"type"`
	IsEnabled        bool   `json:"is_enabled"`
	IsDefault        bool   `json:"is_default"`
	Endpoint         string `json:"endpoint"`
	Bucket           string `json:"bucket"`
	Region           string `json:"region"`
	AccessKey        string `json:"access_key"`
	SecretKey        string `json:"secret_key"`
	LocalPath        string `json:"local_path"`
	DirNamingRule    string `json:"dir_naming_rule"`
	FileNamingRule   string `json:"file_naming_rule"`
	MaxFileSizeBytes int64  `json:"max_file_size_bytes"`
	AllowedMimeTypes string `json:"allowed_mime_types"`
	IsPrivate        bool   `json:"is_private"`
	ProxyDownload    bool   `json:"proxy_download"`
	BaseURL          string `json:"base_url"`
	URLExpireSeconds int    `json:"url_expire_seconds"`
}

func (in *storagePolicyInput) toModel() *model.StoragePolicy {
	return &model.StoragePolicy{
		Name:             in.Name,
		Type:             in.Type,
		IsEnabled:        in.IsEnabled,
		IsDefault:        in.IsDefault,
		Endpoint:         in.Endpoint,
		Bucket:           in.Bucket,
		Region:           in.Region,
		AccessKey:        in.AccessKey,
		SecretKey:        in.SecretKey,
		LocalPath:        in.LocalPath,
		DirNamingRule:    in.DirNamingRule,
		FileNamingRule:   in.FileNamingRule,
		MaxFileSizeBytes: in.MaxFileSizeBytes,
		AllowedMimeTypes: in.AllowedMimeTypes,
		IsPrivate:        in.IsPrivate,
		ProxyDownload:    in.ProxyDownload,
		BaseURL:          in.BaseURL,
		URLExpireSeconds: in.URLExpireSeconds,
	}
}

func (h *Handler) adminStoragePolicies(c *gin.Context) {
	ctx := c.Request.Context()
	policies, err := h.store.ListStoragePolicies(ctx)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load storage policies")
		return
	}
	ok(c, gin.H{"items": policies})
}

// reloadStoragePolicyHandler reads the policy from DB and (re)registers
// its storage handler in the manager. Call this after every create/update
// so the in-memory manager stays in sync with the database. Errors are
// logged but not fatal — caller decides whether to surface them.
func (h *Handler) reloadStoragePolicyHandler(ctx context.Context, policyID string) error {
	p, err := h.store.GetStoragePolicyByID(ctx, policyID)
	if err != nil {
		return err
	}
	handler, err := storage.NewHandler(
		p.Type, p.Endpoint, p.Region, p.Bucket,
		p.AccessKey, p.SecretKey, p.LocalPath,
	)
	if err != nil {
		return err
	}
	h.storage.RegisterPolicy(p.ID, handler)
	return nil
}

func (h *Handler) adminCreateStoragePolicy(c *gin.Context) {
	var input storagePolicyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	policy := input.toModel()
	ctx := c.Request.Context()
	if err := h.store.CreateStoragePolicy(ctx, policy); err != nil {
		log.Printf("create storage policy: %v", err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create storage policy")
		return
	}
	if err := h.reloadStoragePolicyHandler(ctx, policy.ID); err != nil {
		log.Printf("register storage handler for policy %s: %v", policy.ID, err)
	}
	created(c, policy)
}

func (h *Handler) adminUpdateStoragePolicy(c *gin.Context) {
	var input storagePolicyInput
	if err := c.ShouldBindJSON(&input); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	policy := input.toModel()
	policy.ID = c.Param("id")

	ctx := c.Request.Context()
	if err := h.store.UpdateStoragePolicy(ctx, policy); err != nil {
		log.Printf("update storage policy %s: %v", policy.ID, err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update storage policy")
		return
	}
	if err := h.reloadStoragePolicyHandler(ctx, policy.ID); err != nil {
		log.Printf("re-register storage handler for policy %s: %v", policy.ID, err)
	}
	ok(c, policy)
}

func (h *Handler) adminDeleteStoragePolicy(c *gin.Context) {
	ctx := c.Request.Context()
	policyID := c.Param("id")
	if err := h.store.DeleteStoragePolicy(ctx, policyID); err != nil {
		log.Printf("delete storage policy %s: %v", policyID, err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to delete storage policy")
		return
	}
	h.storage.UnregisterPolicy(policyID)
	ok(c, gin.H{"deleted": true})
}

func (h *Handler) adminTestStoragePolicy(c *gin.Context) {
	ctx := c.Request.Context()
	policyID := c.Param("id")

	// Get the policy
	policy, err := h.store.GetStoragePolicyByID(ctx, policyID)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "storage policy not found")
		return
	}

	// Always build a fresh handler from the persisted policy so the test
	// reflects the latest configuration (the manager may have a stale handler
	// or none at all).
	handler, err := storage.NewHandler(
		policy.Type, policy.Endpoint, policy.Region, policy.Bucket,
		policy.AccessKey, policy.SecretKey, policy.LocalPath,
	)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "failed to initialize storage handler: "+err.Error())
		return
	}

	// Test by writing and reading a small test file
	testKey := "_marsshare_test_" + time.Now().Format("20060102150405")
	testData := "MarsShare storage test"

	if err := handler.Put(ctx, testKey, strings.NewReader(testData), int64(len(testData))); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "write test failed: "+err.Error())
		return
	}

	// Read it back
	reader, err := handler.Get(ctx, testKey)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "read test failed: "+err.Error())
		return
	}
	readData, _ := io.ReadAll(reader)
	_ = reader.Close()

	// Clean up
	_ = handler.Delete(ctx, []string{testKey})

	if string(readData) != testData {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "data integrity test failed")
		return
	}

	ok(c, gin.H{"success": true, "message": "storage policy test passed"})
}

// ────────────────────────────────────────────────────────────
// Membership plans (admin CRUD)
// ────────────────────────────────────────────────────────────

type membershipPlanInput struct {
	Name              string  `json:"name"`
	Slug              string  `json:"slug"`
	PriceCents        int64   `json:"price_cents"`
	DurationDays      int     `json:"duration_days"`
	StoragePolicyID   *string `json:"storage_policy_id"`
	StorageQuotaBytes int64   `json:"storage_quota_bytes"`
	UploadLimitBytes  int64   `json:"upload_limit_bytes"`
	IsActive          bool    `json:"is_active"`
	SortOrder         int     `json:"sort_order"`
}

func (in *membershipPlanInput) toModel() *model.MembershipPlan {
	return &model.MembershipPlan{
		Name:              in.Name,
		Slug:              in.Slug,
		PriceCents:        in.PriceCents,
		DurationDays:      in.DurationDays,
		StoragePolicyID:   in.StoragePolicyID,
		StorageQuotaBytes: in.StorageQuotaBytes,
		UploadLimitBytes:  in.UploadLimitBytes,
		IsActive:          in.IsActive,
		SortOrder:         in.SortOrder,
	}
}

func (h *Handler) adminListMembershipPlans(c *gin.Context) {
	ctx := c.Request.Context()
	plans, err := h.store.ListAllMembershipPlans(ctx)
	if err != nil {
		log.Printf("admin list membership plans: %v", err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load membership plans")
		return
	}
	ok(c, gin.H{"items": plans})
}

func (h *Handler) adminCreateMembershipPlan(c *gin.Context) {
	var input membershipPlanInput
	if err := c.ShouldBindJSON(&input); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}
	plan := input.toModel()
	ctx := c.Request.Context()
	if err := h.store.CreateMembershipPlan(ctx, plan); err != nil {
		log.Printf("create membership plan: %v", err)
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "failed to create plan: "+err.Error())
		return
	}
	created(c, plan)
}

func (h *Handler) adminUpdateMembershipPlan(c *gin.Context) {
	var input membershipPlanInput
	if err := c.ShouldBindJSON(&input); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}
	plan := input.toModel()
	plan.ID = c.Param("id")

	ctx := c.Request.Context()
	if err := h.store.UpdateMembershipPlan(ctx, plan); err != nil {
		log.Printf("update membership plan %s: %v", plan.ID, err)
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "failed to update plan: "+err.Error())
		return
	}
	ok(c, plan)
}

func (h *Handler) adminDeleteMembershipPlan(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if err := h.store.DeleteMembershipPlan(ctx, id); err != nil {
		log.Printf("delete membership plan %s: %v", id, err)
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "failed to delete plan: "+err.Error())
		return
	}
	ok(c, gin.H{"deleted": true})
}

// ────────────────────────────────────────────────────────────
// Admin wallet credit
// ────────────────────────────────────────────────────────────

func (h *Handler) adminCreditWallet(c *gin.Context) {
	var req struct {
		UserID      string `json:"user_id" binding:"required"`
		AmountCents int64  `json:"amount_cents" binding:"required"`
		Note        string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	adminID := getUserID(c)

	if err := h.store.CreditWallet(ctx, req.UserID, req.AmountCents, "admin_credit", "admin", adminID, req.Note); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to credit wallet")
		return
	}
	ok(c, gin.H{"credited": true})
}

// ────────────────────────────────────────────────────────────
// Hot search board
// ────────────────────────────────────────────────────────────

func (h *Handler) adminListHotSearches(c *gin.Context) {
	ctx := c.Request.Context()
	items, err := h.store.ListHotSearches(ctx, 100, true)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load hot searches")
		return
	}
	ok(c, gin.H{"items": items})
}

type upsertHotSearchRequest struct {
	Keyword    string   `json:"keyword" binding:"required"`
	LinkType   string   `json:"link_type"`
	LinkValue  string   `json:"link_value"`
	PinnedRank *int     `json:"pinned_rank"`
	Hidden     bool     `json:"hidden"`
	Score      *float64 `json:"score"`
}

func (h *Handler) adminUpsertHotSearch(c *gin.Context) {
	var req upsertHotSearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}
	ctx := c.Request.Context()
	id := c.Param("id") // empty for POST, present for PUT

	in := store.HotSearchInput{
		ID:         id,
		Keyword:    strings.TrimSpace(req.Keyword),
		LinkType:   strings.TrimSpace(req.LinkType),
		LinkValue:  strings.TrimSpace(req.LinkValue),
		PinnedRank: req.PinnedRank,
		Hidden:     req.Hidden,
		Source:     "manual",
	}
	if req.Score != nil {
		in.Score = *req.Score
	}

	out, err := h.store.UpsertHotSearch(ctx, in)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to save hot search")
		return
	}
	h.audit(c, "upsert_hot_search", "hot_search", out.ID, in)
	ok(c, out)
}

func (h *Handler) adminDeleteHotSearch(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if err := h.store.DeleteHotSearch(ctx, id); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to delete hot search")
		return
	}
	h.audit(c, "delete_hot_search", "hot_search", id, nil)
	ok(c, gin.H{"deleted": true})
}

func (h *Handler) adminRecomputeHotSearches(c *gin.Context) {
	ctx := c.Request.Context()
	if err := h.store.RecomputeHotSearches(ctx); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to recompute hot searches")
		return
	}
	h.audit(c, "recompute_hot_searches", "hot_search", "", nil)
	ok(c, gin.H{"recomputed": true})
}

// ────────────────────────────────────────────────────────────
// File management (全站文件)
// ────────────────────────────────────────────────────────────

func (h *Handler) adminListFiles(c *gin.Context) {
	ctx := c.Request.Context()
	params := store.AdminListObjectsParams{
		Query:      strings.TrimSpace(c.Query("query")),
		MimePrefix: strings.TrimSpace(c.Query("mime_prefix")),
		Status:     strings.TrimSpace(c.Query("status")),
		PageParams: getPageParams(c),
	}

	result, err := h.store.AdminListObjects(ctx, params)
	if err != nil {
		log.Printf("admin list files: %v", err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load files")
		return
	}
	ok(c, result)
}

func (h *Handler) adminDeleteFile(c *gin.Context) {
	ctx := c.Request.Context()
	objectID := c.Param("id")

	info, err := h.store.AdminHardDeleteObject(ctx, objectID)
	if err != nil {
		log.Printf("admin delete file %s: %v", objectID, err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to delete file")
		return
	}

	// Best-effort byte cleanup outside the DB transaction.
	if info.PolicyID != "" && info.ObjectKey != "" {
		if err := h.storage.Delete(ctx, info.PolicyID, []string{info.ObjectKey}); err != nil {
			log.Printf("adminDeleteFile: storage delete %q: %v", info.ObjectKey, err)
		}
	}

	h.audit(c, "hard_delete_file", "object", objectID, gin.H{"object_key": info.ObjectKey})
	ok(c, gin.H{"deleted": true})
}

// ────────────────────────────────────────────────────────────
// User mute
// ────────────────────────────────────────────────────────────

func (h *Handler) adminSetMute(c *gin.Context) {
	var req struct {
		Muted      bool    `json:"muted"`
		MutedUntil *string `json:"muted_until"` // RFC3339, null = permanent
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request")
		return
	}

	var mutedUntil *time.Time
	if req.MutedUntil != nil && *req.MutedUntil != "" {
		t, err := time.Parse(time.RFC3339, *req.MutedUntil)
		if err != nil {
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid muted_until format, use RFC3339")
			return
		}
		mutedUntil = &t
	}

	ctx := c.Request.Context()
	targetID := c.Param("id")
	if err := h.store.AdminSetMute(ctx, targetID, req.Muted, mutedUntil); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update user mute status")
		return
	}
	h.audit(c, "set_mute", "user", targetID, req)
	ok(c, gin.H{"updated": true})
}
