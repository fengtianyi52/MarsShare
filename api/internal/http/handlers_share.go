package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// ────────────────────────────────────────────────────────────
// Authenticated share management
// ────────────────────────────────────────────────────────────

type createShareRequest struct {
	DriveNodeID string  `json:"drive_node_id" binding:"required"`
	Password    string  `json:"password"`
	ExpiresAt   *string `json:"expires_at"`
}

func (h *Handler) createShare(c *gin.Context) {
	var req createShareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	userID := getUserID(c)

	// Generate random token
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to generate share token")
		return
	}
	token := hex.EncodeToString(tokenBytes)

	// Hash password if provided
	var passwordHash *string
	if req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to hash password")
			return
		}
		s := string(hash)
		passwordHash = &s
	}

	// Parse expiry
	var expiresAt *time.Time
	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		parsed, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil {
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid expires_at format, use RFC3339")
			return
		}
		expiresAt = &parsed
	}

	// Block sharing of system-protected nodes (the per-user "帖子图片"
	// folder and any file inside it). Post images are intended to be
	// surfaced through their host post, not via standalone share links.
	protected, err := h.store.IsNodeProtected(ctx, req.DriveNodeID, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to validate node")
		return
	}
	if protected {
		errorResponse(c, http.StatusForbidden, CodeForbidden, "系统文件夹及其内容不可分享")
		return
	}

	share, err := h.store.CreateShareLink(ctx, userID, req.DriveNodeID, token, passwordHash, expiresAt)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create share")
		return
	}

	created(c, share)
}

func (h *Handler) listShares(c *gin.Context) {
	ctx := c.Request.Context()
	shares, err := h.store.ListUserShares(ctx, getUserID(c))
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to list shares")
		return
	}
	ok(c, gin.H{"items": shares})
}

func (h *Handler) revokeShare(c *gin.Context) {
	ctx := c.Request.Context()
	if err := h.store.RevokeShare(ctx, c.Param("id"), getUserID(c)); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to revoke share")
		return
	}
	ok(c, gin.H{"revoked": true})
}

// ────────────────────────────────────────────────────────────
// Public share access
// ────────────────────────────────────────────────────────────

func (h *Handler) getPublicShare(c *gin.Context) {
	ctx := c.Request.Context()
	share, err := h.store.GetShareByToken(ctx, c.Param("token"))
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "share not found or expired")
		return
	}

	// Check expiry
	if share.ExpiresAt != nil && share.ExpiresAt.Before(time.Now()) {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "share has expired")
		return
	}
	if share.RevokedAt != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "share has been revoked")
		return
	}

	// share.NodeDeleted is true when the underlying file has been trashed
	// or hard-purged. We still return 200 with the share metadata so the
	// public viewer can render a "文件已被删除" state instead of a generic
	// 404. share.Node is nil after a hard purge but kept (with is_trashed)
	// after a recoverable trash.
	ok(c, gin.H{
		"share":        share,
		"node":         share.Node,
		"node_deleted": share.NodeDeleted,
		"has_password": share.HasPassword,
	})
}

func (h *Handler) verifySharePassword(c *gin.Context) {
	var req struct {
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "password is required")
		return
	}

	ctx := c.Request.Context()
	share, err := h.store.GetShareByToken(ctx, c.Param("token"))
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "share not found")
		return
	}

	if !share.HasPassword {
		ok(c, gin.H{"verified": true})
		return
	}

	// The password hash is stored in the share - we need to compare
	// Since ShareLink model may not expose the hash directly, we verify through the store
	// For now, we assume the store provides the hash or a verify method
	// The GetShareByToken returns the share with password info
	errorResponse(c, http.StatusUnauthorized, CodeUnauthorized, "password verification not available")
}

func (h *Handler) downloadPublicShare(c *gin.Context) {
	h.servePublicShare(c, "attachment")
}

func (h *Handler) previewPublicShare(c *gin.Context) {
	h.servePublicShare(c, "inline")
}

func (h *Handler) servePublicShare(c *gin.Context, disposition string) {
	ctx := c.Request.Context()
	token := c.Param("token")

	share, err := h.store.GetShareByToken(ctx, token)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "share not found")
		return
	}

	// Check expiry and revocation
	if share.ExpiresAt != nil && share.ExpiresAt.Before(time.Now()) {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "share has expired")
		return
	}
	if share.RevokedAt != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "share has been revoked")
		return
	}

	// File deleted: return 410 Gone with a clear FILE_DELETED code so the
	// frontend never tries to download a missing file.
	if share.NodeDeleted || share.Node == nil || share.Node.ObjectID == nil {
		errorResponse(c, http.StatusGone, CodeFileDeleted, "文件已被删除")
		return
	}
	node := share.Node

	// Get the object
	obj, err := h.store.GetObjectByID(ctx, *node.ObjectID)
	if err != nil || obj.Status == "deleted" {
		errorResponse(c, http.StatusGone, CodeFileDeleted, "文件已被删除")
		return
	}

	// Increment download count
	_ = h.store.IncrementShareDownloads(ctx, share.ID)

	// Get policy and serve
	policy, err := h.store.GetStoragePolicyByID(ctx, obj.PolicyID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "storage policy not found")
		return
	}

	if policy.Type == "local" || policy.ProxyDownload {
		reader, err := h.storage.Get(ctx, policy.ID, obj.ObjectKey)
		if err != nil {
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to read file")
			return
		}
		defer reader.Close()

		c.Header("Content-Type", obj.MimeType)
		c.Header("Content-Disposition", fmt.Sprintf("%s; filename=\"%s\"", disposition, node.Name))
		c.Header("Content-Length", fmt.Sprintf("%d", obj.SizeBytes))
		c.Status(http.StatusOK)
		_, _ = io.Copy(c.Writer, reader)
		return
	}

	// Redirect to signed URL
	expires := time.Duration(policy.URLExpireSeconds) * time.Second
	if expires == 0 {
		expires = 15 * time.Minute
	}
	url, err := h.storage.Source(ctx, policy.ID, obj.ObjectKey, expires)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to generate download URL")
		return
	}
	c.Redirect(http.StatusFound, url)
}

// ────────────────────────────────────────────────────────────
// Drive transfers
// ────────────────────────────────────────────────────────────

func (h *Handler) transferAttachment(c *gin.Context) {
	ctx := c.Request.Context()
	attachmentID := c.Param("id")
	userID := getUserID(c)

	var req struct {
		ParentID *string `json:"parent_id"`
	}
	_ = c.ShouldBindJSON(&req)

	// Look up the attachment by its primary key.
	att, err := h.store.GetPostAttachmentByID(ctx, attachmentID)
	if err != nil || att == nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "attachment not found")
		return
	}
	if att.IsDeleted {
		errorResponse(c, http.StatusGone, CodeFileDeleted, "文件已被删除")
		return
	}

	// Quota check
	user, err := h.store.GetUserByID(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load user")
		return
	}
	if user.StorageUsedBytes+att.SizeBytes > user.StorageQuotaBytes {
		errorResponse(c, http.StatusForbidden, CodeStorageExceeded, "storage quota exceeded")
		return
	}

	// Create a drive node for the user pointing to the same object,
	// preserving the original file name from the attachment.
	node, err := h.store.CreateFileNode(ctx, userID, att.Name, req.ParentID, att.ObjectID, att.SizeBytes, att.MimeType)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to transfer attachment")
		return
	}
	_ = h.store.UpdateUserStorageUsed(ctx, userID, att.SizeBytes)

	created(c, node)
}

func (h *Handler) transferShare(c *gin.Context) {
	ctx := c.Request.Context()
	token := c.Param("token")
	userID := getUserID(c)

	var req struct {
		ParentID *string `json:"parent_id"`
		Password string  `json:"password"`
	}
	_ = c.ShouldBindJSON(&req)

	share, err := h.store.GetShareByToken(ctx, token)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "share not found")
		return
	}

	if share.ExpiresAt != nil && share.ExpiresAt.Before(time.Now()) {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "share has expired")
		return
	}
	if share.RevokedAt != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "share has been revoked")
		return
	}

	if share.NodeDeleted || share.Node == nil || share.Node.ObjectID == nil {
		errorResponse(c, http.StatusGone, CodeFileDeleted, "文件已被删除")
		return
	}
	srcNode := share.Node

	obj, err := h.store.GetObjectByID(ctx, *srcNode.ObjectID)
	if err != nil || obj.Status == "deleted" {
		errorResponse(c, http.StatusGone, CodeFileDeleted, "文件已被删除")
		return
	}

	// Create drive node for the requesting user
	node, err := h.store.CreateFileNode(ctx, userID, srcNode.Name, req.ParentID, obj.ID, obj.SizeBytes, obj.MimeType)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to transfer share")
		return
	}
	_ = h.store.UpdateUserStorageUsed(ctx, userID, obj.SizeBytes)

	created(c, node)
}
