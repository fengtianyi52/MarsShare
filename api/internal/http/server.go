package httpapi

import (
	"context"
	"net/http"
	"sync/atomic"

	"github.com/gin-gonic/gin"
	"github.com/marsshare/api/internal/auth"
	"github.com/marsshare/api/internal/email"
	"github.com/marsshare/api/internal/storage"
	"github.com/marsshare/api/internal/store"
)

// Ensure atomic is used (type alias to suppress false-positive unused import).
var _ atomic.Bool

// Config holds configuration for the HTTP layer.
type Config struct {
	AppBaseURL string
}

// Handler holds dependencies for all HTTP handlers.
type Handler struct {
	cfg       Config
	store     *store.Store
	tokens    *auth.TokenManager
	storage   *storage.Manager
	email     *email.Service
	setupDone atomic.Bool // cached flag for setup-complete check
}

// RegisterRoutes sets up all API routes on the given Gin engine.
func RegisterRoutes(router *gin.Engine, cfg Config, s *store.Store, t *auth.TokenManager, sm *storage.Manager, em *email.Service) {
	h := &Handler{
		cfg:     cfg,
		store:   s,
		tokens:  t,
		storage: sm,
		email:   em,
	}

	// Pre-load setup status into memory so we don't hit DB on every request.
	h.setupDone.Store(s.IsSetupComplete(context.Background()))

	// Health check
	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := router.Group("/api")

	// ── Setup routes (always accessible) ────────────────
	api.GET("/setup/status", h.setupStatus)
	api.POST("/setup/initialize", h.setupInitialize)

	// ── Setup guard: block all non-setup routes if not initialized ──
	api.Use(h.setupGuard())

	// ── Public routes ────────────────────────────────────
	pub := api.Group("")
	{
		// Auth
		pub.POST("/auth/register", h.register)
		pub.POST("/auth/login", h.login)
		pub.POST("/auth/logout", h.logout)
		pub.POST("/auth/refresh", h.refresh)
		pub.POST("/auth/forgot-password", h.forgotPassword)
		pub.POST("/auth/reset-password", h.resetPassword)
		pub.POST("/auth/verify-email", h.verifyEmail)
		pub.POST("/auth/resend-verification", h.resendVerification)

		// Feeds (with optional auth for viewer context)
		pub.GET("/feed", optionalAuth(t), h.feed)
		pub.GET("/trending", optionalAuth(t), h.trending)
		pub.GET("/search", optionalAuth(t), h.search)
		pub.GET("/search/suggest", optionalAuth(t), h.searchSuggest)
		pub.GET("/hot-searches", h.listHotSearches)
		pub.GET("/topics/:slug", optionalAuth(t), h.topicFeed)
		pub.GET("/topics/:slug/info", optionalAuth(t), h.getTopic)

		// User profiles and post detail (with optional auth)
		pub.GET("/users/mention", h.mentionSearch)
		pub.GET("/users/:username", optionalAuth(t), h.userProfile)
		pub.GET("/posts/:id", optionalAuth(t), h.getPost)
		pub.GET("/posts/:id/revisions", optionalAuth(t), h.getPostRevisions)
		pub.GET("/posts/:id/comments", optionalAuth(t), h.listComments)
		pub.GET("/files/:id/preview", optionalAuth(t), h.previewFile)

		// Public shares
		pub.GET("/shares/public/:token", h.getPublicShare)
		pub.POST("/shares/public/:token/verify", h.verifySharePassword)
		pub.GET("/shares/public/:token/download", h.downloadPublicShare)
		pub.GET("/shares/public/:token/preview", h.previewPublicShare)

		// Stripe webhook (no auth)
		pub.POST("/billing/stripe/webhook", h.stripeWebhook)
		// Stripe public config (publishable key + currency); used by the
		// frontend to decide whether to render cash-payment buttons.
		pub.GET("/billing/stripe/config", h.stripeConfig)
	}

	// ── Authenticated routes ─────────────────────────────
	// requireNotBanned runs after requireAuth so a banned user's still-valid
	// JWT is rejected on every request, not just at refresh time.
	authed := api.Group("")
	authed.Use(requireAuth(t), requireNotBanned(s))
	{
		// Profile
		authed.GET("/me", h.me)
		authed.PATCH("/me", h.updateProfile)
		authed.GET("/me/followers", h.myFollowers)
		authed.GET("/me/following", h.myFollowing)
		authed.POST("/auth/password", h.changePassword)
		authed.POST("/auth/send-verification", h.sendVerificationEmail)

		// Posts (edit/delete allowed while muted; creation is not)
		authed.PUT("/posts/:id", h.updatePost)
		authed.DELETE("/posts/:id", h.deletePost)

		// Comments (delete own comments; creation is gated by mute in `write`)
		authed.DELETE("/comments/:id", h.deleteComment)

		// Notifications
		authed.GET("/notifications", h.listNotifications)
		authed.POST("/notifications/:id/read", h.markNotificationRead)
		authed.POST("/notifications/read-all", h.markAllNotificationsRead)
		authed.GET("/notifications/unread-count", h.unreadNotificationCount)

		// Drive (read + management)
		authed.GET("/drive/tree", h.driveTree)
		authed.POST("/drive/folders", h.createFolder)
		authed.PATCH("/drive/nodes/:id", h.updateDriveNode)
		authed.DELETE("/drive/nodes/:id", h.deleteDriveNode)
		authed.POST("/drive/nodes/:id/copy", h.copyDriveNode)
		authed.POST("/drive/nodes/:id/restore", h.restoreDriveNode)
		authed.POST("/drive/nodes/:id/purge", h.purgeDriveNode)
		authed.GET("/drive/trash", h.driveTrash)
		authed.POST("/drive/trash/empty", h.emptyTrash)

		// Files
		authed.POST("/uploads", h.uploadFile)
		authed.GET("/files/:id/download", h.downloadFile)

		// Shares (read + revoke)
		authed.GET("/shares", h.listShares)
		authed.DELETE("/shares/:id", h.revokeShare)

		// Billing
		authed.GET("/billing/wallet", h.wallet)
		authed.GET("/billing/plans", h.plans)
		authed.POST("/billing/memberships/purchase", h.purchaseMembership)
		authed.POST("/billing/redeem", h.redeem)
		authed.POST("/billing/stripe/checkout", h.stripeCheckout)
		authed.GET("/billing/stripe/orders/:session_id", h.stripeOrderStatus)
	}

	// ── Write routes (authenticated + not banned + not muted) ─────────
	write := api.Group("")
	write.Use(requireAuth(t), requireNotBanned(s), requireNotMuted(s))
	{
		// Posts
		write.POST("/posts", h.createPost)

		// Comments
		write.POST("/posts/:id/comments", h.addComment)

		// Reactions
		write.POST("/posts/:id/reactions", h.likePost)
		write.DELETE("/posts/:id/reactions", h.unlikePost)
		write.POST("/comments/:id/reactions", h.likeComment)
		write.DELETE("/comments/:id/reactions", h.unlikeComment)

		// Repost
		write.POST("/posts/:id/repost", h.repost)

		// Follow
		write.POST("/follows/:id", h.follow)
		write.DELETE("/follows/:id", h.unfollow)

		// Topic follow
		write.POST("/topics/:slug/follow", h.followTopic)
		write.DELETE("/topics/:slug/follow", h.unfollowTopic)

		// Reports
		write.POST("/reports", h.report)

		// Shares (create)
		write.POST("/shares", h.createShare)

		// Drive transfers
		write.POST("/drive/transfer/attachments/:id", h.transferAttachment)
		write.POST("/drive/transfer/shares/:token", h.transferShare)
	}

	// ── Admin routes ─────────────────────────────────────
	admin := api.Group("/admin")
	admin.Use(requireAuth(t), requireNotBanned(s), requireAdmin())
	{
		admin.GET("/dashboard", h.adminDashboard)

		// Users
		admin.GET("/users", h.adminUsers)
		admin.POST("/users/:id/ban", h.adminSetBan)
		admin.POST("/users/:id/mute", h.adminSetMute)

		// Posts
		admin.GET("/posts", h.adminPosts)
		admin.POST("/posts/:id/status", h.adminSetPostStatus)
		admin.DELETE("/posts/:id/hard", h.adminHardDeletePost)

		// Topics
		admin.GET("/topics", h.adminListTopics)
		admin.POST("/topics/:id/ban", h.adminBanTopic)
		admin.DELETE("/topics/:id", h.adminDeleteTopic)

		// Reports
		admin.GET("/reports", h.adminReports)
		admin.POST("/reports/:id/resolve", h.adminResolveReport)

		// Settings
		admin.GET("/settings", h.adminSettings)
		admin.PUT("/settings", h.adminUpsertSetting)

		// Redeem batches
		admin.POST("/redeem-batches", h.adminCreateRedeemBatch)
		admin.GET("/redeem-batches", h.adminListRedeemBatches)

		// Storage policies
		admin.GET("/storage-policies", h.adminStoragePolicies)
		admin.POST("/storage-policies", h.adminCreateStoragePolicy)
		admin.PUT("/storage-policies/:id", h.adminUpdateStoragePolicy)
		admin.DELETE("/storage-policies/:id", h.adminDeleteStoragePolicy)
		admin.POST("/storage-policies/:id/test", h.adminTestStoragePolicy)

		// Membership plans
		admin.GET("/membership-plans", h.adminListMembershipPlans)
		admin.POST("/membership-plans", h.adminCreateMembershipPlan)
		admin.PUT("/membership-plans/:id", h.adminUpdateMembershipPlan)
		admin.DELETE("/membership-plans/:id", h.adminDeleteMembershipPlan)

		// Admin wallet credit
		admin.POST("/wallet/credit", h.adminCreditWallet)

		// Stripe orders
		admin.GET("/stripe/orders", h.adminListStripeOrders)

		// File management (全站文件)
		admin.GET("/files", h.adminListFiles)
		admin.DELETE("/files/:id", h.adminDeleteFile)

		// Hot search board
		admin.GET("/hot-searches", h.adminListHotSearches)
		admin.POST("/hot-searches", h.adminUpsertHotSearch)
		admin.PUT("/hot-searches/:id", h.adminUpsertHotSearch)
		admin.DELETE("/hot-searches/:id", h.adminDeleteHotSearch)
		admin.POST("/hot-searches/recompute", h.adminRecomputeHotSearches)
	}
}
