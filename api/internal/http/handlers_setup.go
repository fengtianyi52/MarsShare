package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/marsshare/api/internal/store"
)

// ────────────────────────────────────────────────────────────
// Setup Status
// ────────────────────────────────────────────────────────────

// setupStatus returns whether initial setup has been completed.
// GET /api/setup/status — always public, even before setup.
func (h *Handler) setupStatus(c *gin.Context) {
	ctx := c.Request.Context()
	complete := h.store.IsSetupComplete(ctx)

	// Always return site config so the frontend can build dynamic routes
	adminPath := "admin"
	siteName := "MarsShare"
	if complete {
		if v, err := h.store.GetSetting(ctx, "admin_path"); err == nil && v != "" {
			adminPath = v
		}
		if v, err := h.store.GetSetting(ctx, "site_name"); err == nil && v != "" {
			siteName = v
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"setup_complete": complete,
		"admin_path":     adminPath,
		"site_name":      siteName,
	})
}

// ────────────────────────────────────────────────────────────
// Setup Initialize
// ────────────────────────────────────────────────────────────

// setupInitialize performs the first-time setup.
// POST /api/setup/initialize — only works if setup is not yet complete.
// Once called successfully, this endpoint permanently stops working.
func (h *Handler) setupInitialize(c *gin.Context) {
	ctx := c.Request.Context()

	// Guard: already initialized → 403
	if h.store.IsSetupComplete(ctx) {
		errorResponse(c, http.StatusForbidden, CodeForbidden, "系统已完成初始化，此接口已禁用")
		return
	}

	var req store.SetupConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "请求参数无效: "+err.Error())
		return
	}

	// Validate required fields
	if strings.TrimSpace(req.AdminEmail) == "" {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "管理员邮箱不能为空")
		return
	}
	if len(req.AdminPassword) < 6 {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "管理员密码至少 6 位")
		return
	}
	if strings.TrimSpace(req.SiteName) == "" {
		req.SiteName = "MarsShare"
	}
	if strings.TrimSpace(req.AdminPath) == "" {
		req.AdminPath = "admin"
	}

	// Run setup
	if err := h.store.CompleteSetup(ctx, req); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "初始化失败: "+err.Error())
		return
	}

	// Mark setup complete in the in-memory flag so the guard middleware
	// starts blocking /setup and allowing all other routes immediately.
	h.setupDone.Store(true)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "初始化完成，请使用管理员账户登录",
	})
}
