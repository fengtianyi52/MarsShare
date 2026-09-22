package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/marsshare/api/internal/auth"
	"github.com/marsshare/api/internal/store"
	"golang.org/x/crypto/bcrypt"
)

var usernameRE = regexp.MustCompile(`^[a-z][a-z0-9_]{1,29}$`)

// ────────────────────────────────────────────────────────────
// Request / response types
// ────────────────────────────────────────────────────────────

type registerRequest struct {
	Email       string `json:"email" binding:"required,email"`
	Username    string `json:"username" binding:"required,min=2,max=30"`
	DisplayName string `json:"display_name"`
	Password    string `json:"password" binding:"required,min=6"`
}

type loginRequest struct {
	Login    string `json:"login" binding:"required"` // email or username
	Password string `json:"password" binding:"required"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type changePasswordRequest struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=6"`
}

type forgotPasswordRequest struct {
	Email string `json:"email" binding:"required,email"`
}

type resetPasswordRequest struct {
	Token       string `json:"token" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=6"`
}

type verifyEmailRequest struct {
	Token string `json:"token" binding:"required"`
}

type updateProfileRequest struct {
	DisplayName    *string `json:"display_name"`
	Bio            *string `json:"bio"`
	AvatarObjectID *string `json:"avatar_object_id"`
	AvatarDataURL  *string `json:"avatar_data_url"`
}

type authResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	User         any    `json:"user"`
}

// ────────────────────────────────────────────────────────────
// Handlers
// ────────────────────────────────────────────────────────────

func (h *Handler) register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	if !usernameRE.MatchString(req.Username) {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "用户名只能包含小写字母、数字、下划线，且需以字母开头（2-30 位）")
		return
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.DisplayName == "" {
		req.DisplayName = req.Username
	}

	// Hash password
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to hash password")
		return
	}

	ctx := c.Request.Context()

	// Create user
	user, err := h.store.CreateUser(ctx, req.Email, req.Username, req.DisplayName, string(hash))
	if err != nil {
		if strings.Contains(err.Error(), "已注册") || strings.Contains(err.Error(), "already") {
			errorResponse(c, http.StatusConflict, CodeConflict, err.Error())
			return
		}
		if strings.Contains(err.Error(), "已占用") || strings.Contains(err.Error(), "taken") {
			errorResponse(c, http.StatusConflict, CodeConflict, err.Error())
			return
		}
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create user")
		return
	}

	// Provision the per-user system folder used for inline post images.
	// Best-effort — driveTree also ensures it on read, so a transient
	// failure here doesn't lock the user out of posting.
	if _, err := h.store.EnsurePostImagesFolder(ctx, user.ID); err != nil {
		log.Printf("register: ensure post images folder for %s: %v", user.ID, err)
	}

	emailCfg := h.store.GetEmailSettings(ctx)
	if emailCfg.VerifyEnabled {
		// Verification required — send email and return pending state.
		// No tokens are issued until the email is verified.
		token, err := h.store.CreateEmailToken(ctx, user.ID, store.TokenTypeEmailVerification, time.Now().Add(24*time.Hour))
		if err != nil {
			log.Printf("register: create email token for %s: %v", user.ID, err)
		} else {
			siteName := h.siteNameFromSettings(ctx)
			if err := h.email.SendVerification(
				emailCfg.APIKey, emailCfg.From, emailCfg.VerifySubject, emailCfg.VerifyTemplate,
				h.appBaseURL(ctx), siteName, user.Email, token,
			); err != nil {
				log.Printf("register: send verification email to %s: %v", user.Email, err)
			}
		}
		created(c, gin.H{"pending_verification": true, "email": user.Email})
		return
	}

	// Verification not required — issue tokens immediately.
	resp, err := h.issueTokens(c, user.ID, user.Role)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create session")
		return
	}
	resp.User = user
	created(c, resp)
}

func (h *Handler) login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	login := strings.TrimSpace(req.Login)

	// Try email first, then username (both are case-insensitive)
	user, err := h.store.GetUserByEmail(ctx, login)
	if err != nil {
		user, err = h.store.GetUserByUsername(ctx, login)
		if err != nil {
			errorResponse(c, http.StatusUnauthorized, CodeUnauthorized, "invalid credentials")
			return
		}
	}

	if user.IsBanned {
		errorResponse(c, http.StatusForbidden, CodeForbidden, "account is banned")
		return
	}

	// Verify password - need to get the hash from the store
	pwHash, err := h.store.GetPasswordHash(ctx, user.ID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "authentication failed")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(pwHash), []byte(req.Password)); err != nil {
		errorResponse(c, http.StatusUnauthorized, CodeUnauthorized, "invalid credentials")
		return
	}

	// Block login when verify-on-register is enabled and email is unverified.
	emailCfg := h.store.GetEmailSettings(ctx)
	if emailCfg.VerifyEnabled && !user.EmailVerified {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{
				"code":    CodeEmailNotVerified,
				"message": "请先验证邮箱后再登录",
				"email":   user.Email,
			},
		})
		return
	}

	resp, err := h.issueTokens(c, user.ID, user.Role)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create session")
		return
	}
	resp.User = user

	ok(c, resp)
}

func (h *Handler) logout(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.RefreshToken == "" {
		// Also try to get user_id from auth context for session cleanup
		ok(c, gin.H{"logged_out": true})
		return
	}

	ctx := c.Request.Context()
	tokenHash := auth.HashToken(req.RefreshToken)

	session, err := h.store.GetSessionByTokenHash(ctx, tokenHash)
	if err == nil && session != nil {
		_ = h.store.DeleteSession(ctx, session.ID)
	}

	ok(c, gin.H{"logged_out": true})
}

func (h *Handler) refresh(c *gin.Context) {
	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "missing refresh_token")
		return
	}

	ctx := c.Request.Context()
	tokenHash := auth.HashToken(req.RefreshToken)

	// Look up the session
	session, err := h.store.GetSessionByTokenHash(ctx, tokenHash)
	if err != nil {
		errorResponse(c, http.StatusUnauthorized, CodeUnauthorized, "invalid or expired refresh token")
		return
	}

	// Get user
	user, err := h.store.GetUserByID(ctx, session.UserID)
	if err != nil {
		errorResponse(c, http.StatusUnauthorized, CodeUnauthorized, "user not found")
		return
	}

	if user.IsBanned {
		_ = h.store.DeleteSession(ctx, session.ID)
		errorResponse(c, http.StatusForbidden, CodeForbidden, "account is banned")
		return
	}

	// Delete old session
	_ = h.store.DeleteSession(ctx, session.ID)

	// Issue new tokens
	resp, err := h.issueTokens(c, user.ID, user.Role)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create session")
		return
	}
	resp.User = user

	ok(c, resp)
}

func (h *Handler) me(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := h.store.GetUserByID(ctx, getUserID(c))
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "user not found")
		return
	}
	ok(c, user)
}

func (h *Handler) updateProfile(c *gin.Context) {
	var req updateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request")
		return
	}

	ctx := c.Request.Context()
	userID := getUserID(c)

	// Get current user to fill in defaults for unchanged fields
	user, err := h.store.GetUserByID(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "user not found")
		return
	}

	displayName := user.DisplayName
	bio := user.Bio
	avatarObjID := user.AvatarObjectID

	if req.DisplayName != nil {
		displayName = *req.DisplayName
	}
	if req.Bio != nil {
		bio = *req.Bio
	}
	if req.AvatarObjectID != nil {
		avatarObjID = ptrStr(*req.AvatarObjectID)
	}

	if err := h.store.UpdateUserProfile(ctx, userID, displayName, bio, avatarObjID, req.AvatarDataURL); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update profile")
		return
	}

	// Return updated user
	updated, err := h.store.GetUserByID(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to fetch updated profile")
		return
	}
	ok(c, updated)
}

func (h *Handler) changePassword(c *gin.Context) {
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	userID := getUserID(c)

	// Verify old password
	pwHash, err := h.store.GetPasswordHash(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to verify password")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(pwHash), []byte(req.OldPassword)); err != nil {
		errorResponse(c, http.StatusUnauthorized, CodeUnauthorized, "current password is incorrect")
		return
	}

	// Hash new password
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to hash password")
		return
	}

	if err := h.store.UpdatePassword(ctx, userID, string(newHash)); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update password")
		return
	}

	ok(c, gin.H{"updated": true})
}

// sendVerificationEmail (POST /api/auth/send-verification) — requires auth.
func (h *Handler) sendVerificationEmail(c *gin.Context) {
	ctx := c.Request.Context()
	userID := getUserID(c)

	emailCfg := h.store.GetEmailSettings(ctx)
	if !emailCfg.VerifyEnabled {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "邮箱验证功能未开启")
		return
	}

	user, err := h.store.GetUserByID(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "user not found")
		return
	}
	if user.EmailVerified {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "邮箱已验证")
		return
	}

	token, err := h.store.CreateEmailToken(ctx, userID, store.TokenTypeEmailVerification, time.Now().Add(24*time.Hour))
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create token")
		return
	}
	siteName := h.siteNameFromSettings(ctx)
	if err := h.email.SendVerification(
		emailCfg.APIKey, emailCfg.From, emailCfg.VerifySubject, emailCfg.VerifyTemplate,
		h.appBaseURL(ctx), siteName, user.Email, token,
	); err != nil {
		log.Printf("sendVerificationEmail: %v", err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to send email")
		return
	}
	ok(c, gin.H{"sent": true})
}

// verifyEmail (POST /api/auth/verify-email) — public.
// On success, issues auth tokens so the user is logged in immediately.
func (h *Handler) verifyEmail(c *gin.Context) {
	var req verifyEmailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	userID, err := h.store.UseEmailToken(ctx, req.Token, store.TokenTypeEmailVerification)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "验证链接无效或已过期")
			return
		}
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "verification failed")
		return
	}

	if err := h.store.MarkEmailVerified(ctx, userID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update status")
		return
	}

	// Issue tokens so the user is logged in right after verifying.
	user, err := h.store.GetUserByID(ctx, userID)
	if err != nil {
		// Verified but couldn't load user — still success, frontend will redirect to login
		ok(c, gin.H{"verified": true})
		return
	}
	resp, err := h.issueTokens(c, user.ID, user.Role)
	if err != nil {
		ok(c, gin.H{"verified": true})
		return
	}
	resp.User = user
	ok(c, gin.H{"verified": true, "access_token": resp.AccessToken, "refresh_token": resp.RefreshToken, "user": resp.User})
}

// resendVerification (POST /api/auth/resend-verification) — public.
// Always returns 200 to avoid leaking whether the email exists.
func (h *Handler) resendVerification(c *gin.Context) {
	var req struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	emailCfg := h.store.GetEmailSettings(ctx)
	if !emailCfg.VerifyEnabled {
		ok(c, gin.H{"sent": true})
		return
	}

	addr := strings.ToLower(strings.TrimSpace(req.Email))
	user, err := h.store.GetUserByEmail(ctx, addr)
	if err == nil && !user.EmailVerified {
		token, err := h.store.CreateEmailToken(ctx, user.ID, store.TokenTypeEmailVerification, time.Now().Add(24*time.Hour))
		if err != nil {
			log.Printf("resendVerification: create token for %s: %v", user.ID, err)
		} else {
			siteName := h.siteNameFromSettings(ctx)
			if err := h.email.SendVerification(
				emailCfg.APIKey, emailCfg.From, emailCfg.VerifySubject, emailCfg.VerifyTemplate,
				h.appBaseURL(ctx), siteName, user.Email, token,
			); err != nil {
				log.Printf("resendVerification: send email to %s: %v", user.Email, err)
			}
		}
	}

	ok(c, gin.H{"sent": true})
}

// forgotPassword (POST /api/auth/forgot-password) — public.
// Always returns 200 to avoid leaking whether an email exists.
func (h *Handler) forgotPassword(c *gin.Context) {
	var req forgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	emailCfg := h.store.GetEmailSettings(ctx)
	if !emailCfg.ResetEnabled {
		// Still return 200 — don't reveal feature status
		ok(c, gin.H{"sent": true})
		return
	}

	addr := strings.ToLower(strings.TrimSpace(req.Email))
	user, err := h.store.GetUserByEmail(ctx, addr)
	if err == nil {
		token, err := h.store.CreateEmailToken(ctx, user.ID, store.TokenTypePasswordReset, time.Now().Add(time.Hour))
		if err != nil {
			log.Printf("forgotPassword: create token for %s: %v", user.ID, err)
		} else {
			siteName := h.siteNameFromSettings(ctx)
			if err := h.email.SendPasswordReset(
				emailCfg.APIKey, emailCfg.From, emailCfg.ResetSubject, emailCfg.ResetTemplate,
				h.appBaseURL(ctx), siteName, user.Email, token,
			); err != nil {
				log.Printf("forgotPassword: send email to %s: %v", user.Email, err)
			}
		}
	}

	// Always succeed — do not reveal whether the email exists
	ok(c, gin.H{"sent": true})
}

// resetPassword (POST /api/auth/reset-password) — public.
func (h *Handler) resetPassword(c *gin.Context) {
	var req resetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	// resetPassword is always functional regardless of the toggle
	// (token was already issued; we honour it)
	userID, err := h.store.UseEmailToken(ctx, req.Token, store.TokenTypePasswordReset)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "重置链接无效或已过期")
			return
		}
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "reset failed")
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to hash password")
		return
	}
	if err := h.store.UpdatePassword(ctx, userID, string(newHash)); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update password")
		return
	}

	// Invalidate all sessions after password reset
	_ = h.store.DeleteAllSessionsByUserID(ctx, userID)

	ok(c, gin.H{"reset": true})
}

// ─── Email helpers ────────────────────────────────────────────────────────────

// siteNameFromSettings returns the site name from settings, falling back to "MarsShare".
func (h *Handler) siteNameFromSettings(ctx context.Context) string {
	if v, err := h.store.GetSetting(ctx, store.SettingSiteName); err == nil && v != "" {
		return v
	}
	return "MarsShare"
}

// appBaseURL returns the base URL for email links.
// Prefers the DB setting so admins can change it without restarting the server.
func (h *Handler) appBaseURL(ctx context.Context) string {
	if v, err := h.store.GetSetting(ctx, store.SettingAppBaseURL); err == nil && v != "" {
		return v
	}
	return h.cfg.AppBaseURL
}

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

// issueTokens generates access + refresh tokens, creates a session, and returns the response.
func (h *Handler) issueTokens(c *gin.Context, userID, role string) (*authResponse, error) {
	accessToken, err := h.tokens.GenerateAccessToken(userID, role)
	if err != nil {
		return nil, err
	}

	rawRefresh, hashedRefresh, err := h.tokens.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	ctx := c.Request.Context()
	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	_, err = h.store.CreateSession(ctx, userID, hashedRefresh, c.Request.UserAgent(), c.ClientIP(), expiresAt)
	if err != nil {
		return nil, err
	}

	return &authResponse{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
	}, nil
}
