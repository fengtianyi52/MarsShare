package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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

// ────────────────────────────────────────────────────────────
// Drive tree & folders
// ────────────────────────────────────────────────────────────

func (h *Handler) driveTree(c *gin.Context) {
	ctx := c.Request.Context()
	userID := getUserID(c)
	// Best-effort: make sure every user (including legacy accounts created
	// before the system folder existed) has a "帖子图片" folder. The call is
	// idempotent and cheap on the hot path.
	if _, err := h.store.EnsurePostImagesFolder(ctx, userID); err != nil {
		log.Printf("driveTree: ensure post images folder for %s: %v", userID, err)
	}
	nodes, err := h.store.GetDriveTree(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load drive tree")
		return
	}
	ok(c, gin.H{"items": nodes})
}

func (h *Handler) createFolder(c *gin.Context) {
	var req struct {
		Name     string  `json:"name" binding:"required"`
		ParentID *string `json:"parent_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	node, err := h.store.CreateFolder(ctx, getUserID(c), req.Name, req.ParentID)
	if err != nil {
		if errors.Is(err, store.ErrSystemNodeProtected) {
			errorResponse(c, http.StatusForbidden, CodeForbidden, "无法在系统文件夹下创建子项")
			return
		}
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create folder")
		return
	}
	created(c, node)
}

func (h *Handler) updateDriveNode(c *gin.Context) {
	// Use a raw map so we can tell whether a field was *omitted* (no change)
	// versus *explicitly null* (move to root). Gin's binding to *string can't
	// distinguish these cases.
	var raw map[string]json.RawMessage
	if err := c.ShouldBindJSON(&raw); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request")
		return
	}

	ctx := c.Request.Context()
	nodeID := c.Param("id")
	userID := getUserID(c)

	// Rename: only present when the client wants to change the name.
	if rawName, ok := raw["name"]; ok {
		var name string
		if err := json.Unmarshal(rawName, &name); err != nil {
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid name")
			return
		}
		if err := h.store.RenameDriveNode(ctx, nodeID, userID, name); err != nil {
			if errors.Is(err, store.ErrSystemNodeProtected) {
				errorResponse(c, http.StatusForbidden, CodeForbidden, "系统文件夹及其内容不可修改")
				return
			}
			log.Printf("rename drive node %s: %v", nodeID, err)
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "failed to rename: "+err.Error())
			return
		}
	}

	// Move: present means change parent. JSON null means root.
	if rawParent, ok := raw["parent_id"]; ok {
		var parent *string
		if err := json.Unmarshal(rawParent, &parent); err != nil {
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid parent_id")
			return
		}
		// Treat empty string as root for convenience.
		if parent != nil && *parent == "" {
			parent = nil
		}
		if err := h.store.MoveDriveNode(ctx, nodeID, userID, parent); err != nil {
			if errors.Is(err, store.ErrSystemNodeProtected) {
				errorResponse(c, http.StatusForbidden, CodeForbidden, "系统文件夹及其内容不可移动")
				return
			}
			log.Printf("move drive node %s: %v", nodeID, err)
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "failed to move: "+err.Error())
			return
		}
	}

	ok(c, gin.H{"updated": true})
}

func (h *Handler) deleteDriveNode(c *gin.Context) {
	ctx := c.Request.Context()
	if err := h.store.TrashDriveNode(ctx, c.Param("id"), getUserID(c)); err != nil {
		if errors.Is(err, store.ErrSystemNodeProtected) {
			errorResponse(c, http.StatusForbidden, CodeForbidden, "系统文件夹及其内容不可删除")
			return
		}
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to trash node")
		return
	}
	ok(c, gin.H{"trashed": true})
}

func (h *Handler) copyDriveNode(c *gin.Context) {
	var req struct {
		ParentID *string `json:"parent_id"`
	}
	// Body is optional — copying to root means parent_id == nil.
	_ = c.ShouldBindJSON(&req)

	ctx := c.Request.Context()
	userID := getUserID(c)
	nodeID := c.Param("id")

	// Quota check using the source's recursive size.
	user, err := h.store.GetUserByID(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load user")
		return
	}

	copied, sizeDelta, err := h.store.CopyDriveNode(ctx, nodeID, userID, req.ParentID)
	if err != nil {
		if errors.Is(err, store.ErrSystemNodeProtected) {
			errorResponse(c, http.StatusForbidden, CodeForbidden, "系统文件夹及其内容不可复制")
			return
		}
		log.Printf("copy drive node %s: %v", nodeID, err)
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "failed to copy node: "+err.Error())
		return
	}

	// Best-effort post-copy quota warning. The copy already happened —
	// over-quota would have been preferable to detect upfront, but for
	// dedup-style copies (drive_nodes pointing at the same object) we
	// only consume the user's quota counter, not actual storage.
	if user.StorageUsedBytes+sizeDelta > user.StorageQuotaBytes {
		log.Printf("warning: copy by user %s pushed quota over limit (used+delta=%d, quota=%d)",
			userID, user.StorageUsedBytes+sizeDelta, user.StorageQuotaBytes)
	}

	created(c, copied)
}

func (h *Handler) restoreDriveNode(c *gin.Context) {
	ctx := c.Request.Context()
	if err := h.store.RestoreDriveNode(ctx, c.Param("id"), getUserID(c)); err != nil {
		if errors.Is(err, store.ErrQuotaExceededOnRestore) {
			errorResponse(c, http.StatusForbidden, CodeStorageExceeded, "还原后将超出存储配额")
			return
		}
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to restore node")
		return
	}
	ok(c, gin.H{"restored": true})
}

func (h *Handler) driveTrash(c *gin.Context) {
	ctx := c.Request.Context()
	nodes, err := h.store.ListTrash(ctx, getUserID(c))
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load trash")
		return
	}
	ok(c, gin.H{"items": nodes})
}

// purgeDriveNode permanently removes a single trashed node (and any
// descendants). Bytes are reclaimed from the storage backend best-effort.
func (h *Handler) purgeDriveNode(c *gin.Context) {
	ctx := c.Request.Context()
	nodeID := c.Param("id")
	userID := getUserID(c)

	objects, err := h.store.PurgeDriveNode(ctx, nodeID, userID)
	if err != nil {
		if errors.Is(err, store.ErrSystemNodeProtected) {
			errorResponse(c, http.StatusForbidden, CodeForbidden, "系统文件夹及其内容不可彻底删除")
			return
		}
		if errors.Is(err, store.ErrNodeNotTrashed) {
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "节点未在回收站，无法彻底删除")
			return
		}
		log.Printf("purge drive node %s: %v", nodeID, err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to purge node: "+err.Error())
		return
	}

	// Best-effort byte cleanup outside the DB transaction.
	for _, obj := range objects {
		if err := h.storage.Delete(ctx, obj.PolicyID, []string{obj.ObjectKey}); err != nil {
			log.Printf("purgeDriveNode: delete storage %q: %v", obj.ObjectKey, err)
		}
	}
	ok(c, gin.H{"purged": true, "objects_deleted": len(objects)})
}

// emptyTrash permanently deletes every trashed node owned by the user.
func (h *Handler) emptyTrash(c *gin.Context) {
	ctx := c.Request.Context()
	userID := getUserID(c)

	objects, err := h.store.EmptyTrash(ctx, userID)
	if err != nil {
		log.Printf("empty trash for %s: %v", userID, err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to empty trash")
		return
	}
	for _, obj := range objects {
		if err := h.storage.Delete(ctx, obj.PolicyID, []string{obj.ObjectKey}); err != nil {
			log.Printf("emptyTrash: delete storage %q: %v", obj.ObjectKey, err)
		}
	}
	ok(c, gin.H{"emptied": true, "objects_deleted": len(objects)})
}

// ────────────────────────────────────────────────────────────
// Upload
// ────────────────────────────────────────────────────────────

func (h *Handler) uploadFile(c *gin.Context) {
	ctx := c.Request.Context()
	userID := getUserID(c)

	fileHeader, err := c.FormFile("file")
	if err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "missing file in upload")
		return
	}
	parentID := c.PostForm("parent_id")
	purpose := c.PostForm("purpose")

	// Post image fast path: route the upload into the user's system folder
	// and skip both the quota check and the storage_used delta. The system
	// folder is created on demand if missing.
	postImageMode := purpose == "post_image"
	if postImageMode {
		folder, ferr := h.store.EnsurePostImagesFolder(ctx, userID)
		if ferr != nil {
			log.Printf("upload: ensure post images folder: %v", ferr)
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to prepare system folder")
			return
		}
		parentID = folder.ID
	} else if parentID != "" {
		// User-driven uploads are not allowed to write inside any
		// system-protected node.
		protected, perr := h.store.IsNodeProtected(ctx, parentID, userID)
		if perr != nil {
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to validate parent")
			return
		}
		if protected {
			errorResponse(c, http.StatusForbidden, CodeForbidden, "无法直接上传到系统文件夹")
			return
		}
	}

	// Get user info for quota checks
	user, err := h.store.GetUserByID(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to get user info")
		return
	}

	// Get storage policy
	policy, err := h.store.GetDefaultStoragePolicy(ctx)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "no storage policy configured")
		return
	}

	// Quota only applies to regular uploads — post images live in the
	// system folder and are explicitly excluded from the user's quota
	// counter (they're considered platform overhead).
	if !postImageMode && user.StorageUsedBytes+fileHeader.Size > user.StorageQuotaBytes {
		errorResponse(c, http.StatusForbidden, CodeStorageExceeded, "storage quota exceeded")
		return
	}

	// Check file size limit
	maxSize := policy.MaxFileSizeBytes
	if user.UploadLimitBytes > 0 && user.UploadLimitBytes < maxSize {
		maxSize = user.UploadLimitBytes
	}
	if maxSize > 0 && fileHeader.Size > maxSize {
		errorResponse(c, http.StatusBadRequest, CodeFileTooLarge, fmt.Sprintf("file exceeds size limit of %d bytes", maxSize))
		return
	}

	// Open file for reading
	file, err := fileHeader.Open()
	if err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "failed to open uploaded file")
		return
	}
	defer file.Close()

	// Compute SHA256 while reading the file into a buffer
	hasher := sha256.New()
	tee := io.TeeReader(file, hasher)
	// Read all into memory for SHA256 computation (we need to seek back)
	data, err := io.ReadAll(tee)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to read upload")
		return
	}
	sha256Hex := hex.EncodeToString(hasher.Sum(nil))

	// Detect mime type
	mimeType := fileHeader.Header.Get("Content-Type")
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = http.DetectContentType(data[:min(512, len(data))])
	}

	// Check for dedup
	existingObj, _ := h.store.FindObjectBySHA256(ctx, policy.ID, sha256Hex)
	if existingObj != nil {
		// Dedup: create drive node pointing to existing object
		node, err := h.store.CreateFileNode(ctx, userID, fileHeader.Filename, ptrStr(parentID), existingObj.ID, fileHeader.Size, mimeType)
		if err != nil {
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create file node")
			return
		}
		if !postImageMode {
			_ = h.store.UpdateUserStorageUsed(ctx, userID, fileHeader.Size)
		}
		created(c, gin.H{
			"object": existingObj,
			"node":   node,
		})
		return
	}

	// Generate object key
	objectKey := storage.GenerateKey(policy.DirNamingRule, policy.FileNamingRule, userID, fileHeader.Filename)

	// Upload to storage
	reader := newBytesReader(data)
	if err := h.storage.Put(ctx, policy.ID, objectKey, reader, fileHeader.Size); err != nil {
		log.Printf("upload: storage.Put policy=%s key=%s: %v", policy.ID, objectKey, err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to persist upload: "+err.Error())
		return
	}

	// Create object record
	obj, err := h.store.CreateObject(ctx, userID, policy.ID, objectKey, sha256Hex, mimeType, fileHeader.Size)
	if err != nil {
		log.Printf("upload: CreateObject: %v", err)
		_ = h.storage.Delete(ctx, policy.ID, []string{objectKey})
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create object record")
		return
	}

	// Create drive node
	node, err := h.store.CreateFileNode(ctx, userID, fileHeader.Filename, ptrStr(parentID), obj.ID, fileHeader.Size, mimeType)
	if err != nil {
		log.Printf("upload: CreateFileNode: %v", err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create file node")
		return
	}

	// Update storage used (skipped for post images, which live in the
	// system folder and don't count against the user quota).
	if !postImageMode {
		_ = h.store.UpdateUserStorageUsed(ctx, userID, fileHeader.Size)
	}

	created(c, gin.H{
		"object": obj,
		"node":   node,
	})
}

// ────────────────────────────────────────────────────────────
// Download & Preview
// ────────────────────────────────────────────────────────────

func (h *Handler) downloadFile(c *gin.Context) {
	h.serveFile(c, c.Param("id"), "attachment")
}

func (h *Handler) previewFile(c *gin.Context) {
	h.serveFile(c, c.Param("id"), "inline")
}

func (h *Handler) canAccessObject(c *gin.Context, objectID string) (bool, error) {
	if getUserRole(c) == "admin" {
		return true, nil
	}
	return h.store.CanViewerAccessObject(c.Request.Context(), objectID, ptrStr(getUserID(c)))
}

func (h *Handler) serveFile(c *gin.Context, objectID, disposition string) {
	ctx := c.Request.Context()

	obj, err := h.store.GetObjectByID(ctx, objectID)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "file not found")
		return
	}
	allowed, err := h.canAccessObject(c, objectID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to check file access")
		return
	}
	if !allowed {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "file not found")
		return
	}

	policy, err := h.store.GetStoragePolicyByID(ctx, obj.PolicyID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "storage policy not found")
		return
	}

	// CDN / custom domain shortcut. When the storage policy has a base_url
	// configured (typically a CDN domain in front of cloud storage, or an
	// nginx reverse proxy in front of local storage), redirect straight to
	// the resolved URL. We honor proxy_download as an explicit opt-out: if
	// the admin wants every fetch to flow through the API for ACL/quota
	// reasons, we still proxy.
	if !policy.ProxyDownload && policy.BaseURL != "" {
		if direct := store.BuildAttachmentURL(policy.BaseURL, obj.ObjectKey); direct != "" {
			c.Redirect(http.StatusFound, direct)
			return
		}
	}

	// For local storage or proxy_download policies: stream with Range support
	if policy.Type == "local" || policy.ProxyDownload {
		h.proxyServe(c, policy.ID, obj, disposition)
		return
	}

	// For cloud storage without a CDN: redirect to signed URL
	expires := time.Duration(policy.URLExpireSeconds) * time.Second
	if expires == 0 {
		expires = 15 * time.Minute
	}
	url, err := h.storage.Source(ctx, policy.ID, obj.ObjectKey, expires)
	if err != nil {
		// Fall back to proxying
		h.proxyServe(c, policy.ID, obj, disposition)
		return
	}

	c.Redirect(http.StatusFound, url)
}

// proxyServe streams a file from storage with HTTP Range support (RFC 7233).
func (h *Handler) proxyServe(c *gin.Context, policyID string, obj *model.Object, disposition string) {
	ctx := c.Request.Context()

	reader, err := h.storage.Get(ctx, policyID, obj.ObjectKey)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to read file")
		return
	}
	defer reader.Close()

	// Extract original filename from object key
	filename := obj.ObjectKey
	if idx := strings.LastIndex(filename, "/"); idx >= 0 {
		filename = filename[idx+1:]
	}

	c.Header("Content-Type", obj.MimeType)
	c.Header("Content-Disposition", fmt.Sprintf("%s; filename=\"%s\"", disposition, filename))
	c.Header("Accept-Ranges", "bytes")

	// If the underlying reader supports io.ReadSeeker (local files), use http.ServeContent
	// which handles Range requests automatically.
	if rs, ok := reader.(io.ReadSeeker); ok {
		http.ServeContent(c.Writer, c.Request, filename, time.Time{}, rs)
		return
	}

	// For non-seekable readers (cloud proxy), stream without Range support
	c.Header("Content-Length", fmt.Sprintf("%d", obj.SizeBytes))
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, reader)
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

type bytesReader struct {
	data   []byte
	offset int
}

func newBytesReader(data []byte) *bytesReader {
	return &bytesReader{data: data}
}

func (r *bytesReader) Read(p []byte) (int, error) {
	if r.offset >= len(r.data) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.offset:])
	r.offset += n
	return n, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
