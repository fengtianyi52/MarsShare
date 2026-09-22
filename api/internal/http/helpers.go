package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/marsshare/api/internal/model"
)

// ────────────────────────────────────────────────────────────
// Error codes
// ────────────────────────────────────────────────────────────

const (
	CodeInvalidInput    = "INVALID_INPUT"
	CodeUnauthorized    = "UNAUTHORIZED"
	CodeForbidden       = "FORBIDDEN"
	CodeNotFound        = "NOT_FOUND"
	CodeConflict        = "CONFLICT"
	CodeInsufficientBal = "INSUFFICIENT_BALANCE"
	CodeStorageExceeded = "STORAGE_EXCEEDED"
	CodeFileTooLarge    = "FILE_TOO_LARGE"
	CodeInternalError   = "INTERNAL_ERROR"
	// CodeEmailNotVerified is returned by login when the account exists but
	// the email has not been verified yet (and verify-on-register is enabled).
	CodeEmailNotVerified = "EMAIL_NOT_VERIFIED"
	// CodeBanned is returned for any authenticated request from a banned
	// account. The frontend uses this code to force-logout the user.
	CodeBanned = "BANNED"
	// CodeFileDeleted is returned when a share or post attachment is
	// requested but the underlying file has been trashed/purged by its
	// owner or hard-deleted by an admin. The frontend renders a clear
	// "文件已被删除" state instead of a generic 404.
	CodeFileDeleted = "FILE_DELETED"
)

// ────────────────────────────────────────────────────────────
// Context helpers
// ────────────────────────────────────────────────────────────

// getUserID returns the authenticated user's ID from the Gin context.
func getUserID(c *gin.Context) string {
	id, _ := c.Get("user_id")
	s, _ := id.(string)
	return s
}

// getUserRole returns the authenticated user's role from the Gin context.
func getUserRole(c *gin.Context) string {
	role, _ := c.Get("user_role")
	s, _ := role.(string)
	return s
}

// getPageParams parses cursor pagination query parameters.
// Default limit is 20, max is 100.
func getPageParams(c *gin.Context) model.PageParams {
	cursor := strings.TrimSpace(c.Query("cursor"))
	limit := 20
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			limit = v
		}
	}
	if limit > 100 {
		limit = 100
	}
	return model.PageParams{
		Cursor: cursor,
		Limit:  limit,
	}
}

// ────────────────────────────────────────────────────────────
// Response helpers
// ────────────────────────────────────────────────────────────

// errorResponse writes a structured JSON error.
func errorResponse(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{
		"error": gin.H{
			"code":    code,
			"message": message,
		},
	})
}

// ok writes a 200 JSON response with the given payload.
func ok(c *gin.Context, data any) {
	c.JSON(http.StatusOK, data)
}

// created writes a 201 JSON response with the given payload.
func created(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, data)
}

// ptrStr is a convenience helper that returns a pointer to a string,
// or nil if the string is empty.
func ptrStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
