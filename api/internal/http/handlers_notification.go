package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) listNotifications(c *gin.Context) {
	ctx := c.Request.Context()
	userID := getUserID(c)
	params := getPageParams(c)

	result, err := h.store.ListNotifications(ctx, userID, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load notifications")
		return
	}
	ok(c, result)
}

func (h *Handler) markNotificationRead(c *gin.Context) {
	ctx := c.Request.Context()
	notifID := c.Param("id")
	userID := getUserID(c)

	if err := h.store.MarkNotificationRead(ctx, notifID, userID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to mark notification as read")
		return
	}
	ok(c, gin.H{"read": true})
}

func (h *Handler) markAllNotificationsRead(c *gin.Context) {
	ctx := c.Request.Context()
	userID := getUserID(c)

	if err := h.store.MarkAllNotificationsRead(ctx, userID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to mark all notifications as read")
		return
	}
	ok(c, gin.H{"read_all": true})
}

func (h *Handler) unreadNotificationCount(c *gin.Context) {
	ctx := c.Request.Context()
	userID := getUserID(c)

	count, err := h.store.CountUnreadNotifications(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to count unread notifications")
		return
	}
	ok(c, gin.H{"unread_count": count})
}
