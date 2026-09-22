package httpapi

import (
	"crypto/sha1"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/marsshare/api/internal/auth"
	"github.com/marsshare/api/internal/store"
)

// viewerKeyFor returns a stable key identifying the current viewer for
// dedup-style counters (e.g. post views). Authenticated users are keyed by
// their user_id; anonymous viewers are keyed by a hash of ip+user-agent so
// the same browser counts once within the dedup window.
func viewerKeyFor(c *gin.Context) string {
	if uid := getUserID(c); uid != "" {
		return "u:" + uid
	}
	h := sha1.Sum([]byte(c.ClientIP() + "|" + c.Request.UserAgent()))
	return "ip:" + hex.EncodeToString(h[:8])
}

// requireAuth is a middleware that extracts and validates a Bearer token.
// On success it sets "user_id" and "user_role" in the Gin context.
// Returns 401 if the token is missing or invalid.
func requireAuth(tokens *auth.TokenManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := extractBearerToken(c)
		if raw == "" {
			errorResponse(c, http.StatusUnauthorized, CodeUnauthorized, "missing or invalid authorization header")
			c.Abort()
			return
		}
		claims, err := tokens.ValidateAccessToken(raw)
		if err != nil {
			errorResponse(c, http.StatusUnauthorized, CodeUnauthorized, "invalid or expired token")
			c.Abort()
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("user_role", claims.Role)
		c.Next()
	}
}

// optionalAuth tries to extract and validate a Bearer token.
// If present and valid, sets "user_id" and "user_role" in the context.
// If absent or invalid, does nothing and continues.
func optionalAuth(tokens *auth.TokenManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := extractBearerToken(c)
		if raw == "" {
			c.Next()
			return
		}
		claims, err := tokens.ValidateAccessToken(raw)
		if err != nil {
			c.Next()
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("user_role", claims.Role)
		c.Next()
	}
}

// requireAdmin checks that the authenticated user has the "admin" role.
// Must be placed after requireAuth in the middleware chain.
func requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if getUserRole(c) != "admin" {
			errorResponse(c, http.StatusForbidden, CodeForbidden, "admin access required")
			c.Abort()
			return
		}
		c.Next()
	}
}

// setupGuard blocks all requests (returning 503) until the initial setup wizard
// has been completed. Setup routes (/api/setup/*) are registered before this
// middleware so they bypass it. Once setup is done, the cached atomic flag
// ensures zero overhead on subsequent requests.
func (h *Handler) setupGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if h.setupDone.Load() {
			c.Next()
			return
		}
		// Allow setup endpoints (already registered before this middleware)
		if strings.HasPrefix(c.Request.URL.Path, "/api/setup/") {
			c.Next()
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": gin.H{
				"code":    "SETUP_REQUIRED",
				"message": "系统尚未初始化，请先完成安装向导",
			},
		})
		c.Abort()
	}
}

// requireNotBanned blocks authenticated users whose account is banned.
// Must be placed after requireAuth in the middleware chain.
//
// Why this middleware exists: access tokens are stateless JWTs and remain
// valid until expiry, so banning a user (which only deletes their refresh
// sessions) does not by itself revoke an in-flight access token. Without
// this check a banned user can keep posting/commenting until their access
// token times out. Returns 401 with code "BANNED" so the frontend can
// distinguish a ban from a generic auth failure and force-logout.
func requireNotBanned(s *store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := getUserID(c)
		if userID == "" {
			c.Next()
			return
		}
		banned, err := s.IsUserBanned(c.Request.Context(), userID)
		if err != nil {
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to check user status")
			c.Abort()
			return
		}
		if banned {
			// Best-effort: invalidate any remaining refresh sessions so the
			// user cannot recover via /auth/refresh either.
			_ = s.DeleteAllSessionsByUserID(c.Request.Context(), userID)
			errorResponse(c, http.StatusUnauthorized, CodeBanned, "您的账号已被封禁")
			c.Abort()
			return
		}
		c.Next()
	}
}

// requireNotMuted blocks authenticated users who are currently muted.
// It must be placed after requireAuth in the middleware chain.
// Returns 403 with code "MUTED" if the user is muted.
func requireNotMuted(s *store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := getUserID(c)
		if userID == "" {
			c.Next()
			return
		}
		muted, err := s.IsUserMuted(c.Request.Context(), userID)
		if err != nil {
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to check user status")
			c.Abort()
			return
		}
		if muted {
			errorResponse(c, http.StatusForbidden, "MUTED", "your account has been muted")
			c.Abort()
			return
		}
		c.Next()
	}
}

// extractBearerToken reads the token from the Authorization header, falling
// back to the "token" query parameter. The query-param fallback is intentionally
// limited to file preview/download routes so that <img src="...?token="> works
// without a service-worker or fetch-proxy. The access token is short-lived so
// the security exposure from URL-visible tokens is acceptable for media assets.
func extractBearerToken(c *gin.Context) string {
	header := c.GetHeader("Authorization")
	if len(header) > 7 && strings.EqualFold(header[:7], "bearer ") {
		return strings.TrimSpace(header[7:])
	}
	if t := c.Query("token"); t != "" {
		return t
	}
	return ""
}
