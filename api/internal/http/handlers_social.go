package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/marsshare/api/internal/model"
	"github.com/marsshare/api/internal/store"
)

// ────────────────────────────────────────────────────────────
// Feed & Discovery
// ────────────────────────────────────────────────────────────

func (h *Handler) feed(c *gin.Context) {
	ctx := c.Request.Context()
	params := getPageParams(c)
	feedType := c.DefaultQuery("type", "public")
	userID := getUserID(c)
	viewerID := ptrStr(userID)

	var result *model.PageResult[model.Post]
	var err error

	switch feedType {
	case "following":
		if userID == "" {
			errorResponse(c, http.StatusUnauthorized, CodeUnauthorized, "authentication required for following feed")
			return
		}
		result, err = h.store.ListFollowingFeed(ctx, userID, params)
	default:
		result, err = h.store.ListPublicFeed(ctx, viewerID, params)
	}
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load feed")
		return
	}
	ok(c, result)
}

func (h *Handler) trending(c *gin.Context) {
	ctx := c.Request.Context()
	limit := getPageParams(c).Limit
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	viewerID := ptrStr(getUserID(c))
	posts, err := h.store.ListTrending(ctx, viewerID, limit)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load trending")
		return
	}
	ok(c, gin.H{"items": posts})
}

func (h *Handler) search(c *gin.Context) {
	ctx := c.Request.Context()
	query := strings.TrimSpace(c.Query("q"))
	searchType := c.DefaultQuery("type", "posts")
	params := getPageParams(c)
	viewerID := ptrStr(getUserID(c))

	if query == "" {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "search query is required")
		return
	}

	switch searchType {
	case "users":
		result, err := h.store.SearchUsers(ctx, query, params)
		if err != nil {
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "search failed")
			return
		}
		ok(c, result)
	default: // "posts"
		result, err := h.store.SearchPosts(ctx, query, viewerID, params)
		if err != nil {
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "search failed")
			return
		}
		ok(c, result)
	}
}

func (h *Handler) topicFeed(c *gin.Context) {
	ctx := c.Request.Context()
	slug := c.Param("slug")
	params := getPageParams(c)
	viewerID := ptrStr(getUserID(c))

	result, err := h.store.ListTopicFeed(ctx, slug, viewerID, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load topic feed")
		return
	}
	ok(c, result)
}

func (h *Handler) getTopic(c *gin.Context) {
	ctx := c.Request.Context()
	slug := strings.TrimSpace(c.Param("slug"))
	if slug == "" {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "slug is required")
		return
	}
	viewerID := ptrStr(getUserID(c))
	topic, err := h.store.GetTopicBySlug(ctx, slug, viewerID)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "topic not found")
		return
	}
	ok(c, topic)
}

func (h *Handler) followTopic(c *gin.Context) {
	ctx := c.Request.Context()
	slug := strings.TrimSpace(c.Param("slug"))
	userID := getUserID(c)
	topic, err := h.store.GetTopicBySlug(ctx, slug, &userID)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "topic not found")
		return
	}
	if err := h.store.FollowTopic(ctx, userID, topic.ID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to follow topic")
		return
	}
	ok(c, gin.H{"following": true})
}

func (h *Handler) unfollowTopic(c *gin.Context) {
	ctx := c.Request.Context()
	slug := strings.TrimSpace(c.Param("slug"))
	userID := getUserID(c)
	topic, err := h.store.GetTopicBySlug(ctx, slug, &userID)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "topic not found")
		return
	}
	if err := h.store.UnfollowTopic(ctx, userID, topic.ID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to unfollow topic")
		return
	}
	ok(c, gin.H{"following": false})
}

// searchSuggest returns short topic and user suggestion lists for the given
// query, used by the navbar search dropdown's onFocus/onChange flows.
func (h *Handler) searchSuggest(c *gin.Context) {
	ctx := c.Request.Context()
	query := strings.TrimSpace(c.Query("q"))

	topics, err := h.store.SuggestTopics(ctx, query, 8)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to suggest topics")
		return
	}

	users := make([]model.User, 0)
	if query != "" {
		userResult, err := h.store.SearchUsers(ctx, query, model.PageParams{Limit: 5})
		if err == nil && userResult != nil {
			users = userResult.Items
		}
	}

	ok(c, gin.H{"topics": topics, "users": users})
}

// listHotSearches returns the public hot search board (visible entries only).
func (h *Handler) listHotSearches(c *gin.Context) {
	ctx := c.Request.Context()
	limit := 20
	if l := c.Query("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 50 {
			limit = v
		}
	}
	items, err := h.store.ListHotSearches(ctx, limit, false)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load hot searches")
		return
	}
	ok(c, gin.H{"items": items})
}

func (h *Handler) userProfile(c *gin.Context) {
	ctx := c.Request.Context()
	username := c.Param("username")
	viewerID := ptrStr(getUserID(c))

	user, err := h.store.GetUserProfile(ctx, username, viewerID)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "user not found")
		return
	}

	// Also get user's posts
	params := getPageParams(c)
	posts, err := h.store.ListUserPosts(ctx, user.ID, viewerID, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load user posts")
		return
	}

	ok(c, gin.H{
		"user":  user,
		"posts": posts,
	})
}

// ────────────────────────────────────────────────────────────
// Posts
// ────────────────────────────────────────────────────────────

type createPostRequest struct {
	Content       string   `json:"content" binding:"required"`
	Visibility    string   `json:"visibility"`
	AttachmentIDs []string `json:"attachment_ids"`
}

func (h *Handler) createPost(c *gin.Context) {
	var req createPostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	userID := getUserID(c)

	visibility := req.Visibility
	if visibility == "" {
		visibility = "public"
	}

	post, err := h.store.CreatePost(ctx, userID, req.Content, visibility, nil)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create post")
		return
	}

	// Extract and link topics
	_ = h.store.ExtractAndLinkTopics(ctx, post.ID, req.Content)

	// Notify @mentioned users (best-effort)
	go h.store.NotifyMentions(context.Background(), req.Content, userID, post.ID)

	// Create attachments if provided. The IDs are drive node IDs owned by the user;
	// we resolve them to the underlying object and preserve the original file name.
	for i, nodeID := range req.AttachmentIDs {
		node, err := h.store.GetDriveNode(ctx, nodeID, userID)
		if err != nil || node == nil || node.ObjectID == nil || node.Kind != "file" {
			continue
		}
		_ = h.store.CreatePostAttachment(ctx, post.ID, *node.ObjectID, &node.ID, node.Name, node.MimeType, node.SizeBytes, i)
	}

	// Reload the post so attachments are populated in the response.
	if full, err := h.store.GetPostByID(ctx, post.ID, &userID); err == nil {
		created(c, full)
		return
	}

	created(c, post)
}

func (h *Handler) getPost(c *gin.Context) {
	ctx := c.Request.Context()
	postID := c.Param("id")
	viewerID := ptrStr(getUserID(c))

	post, err := h.store.GetPostByID(ctx, postID, viewerID)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "post not found")
		return
	}

	// Record a view, deduped by viewer key within 24h. Fire-and-forget so the
	// response isn't blocked by the counter update.
	key := viewerKeyFor(c)
	go func() {
		_, _ = h.store.RecordPostView(context.Background(), postID, key)
	}()

	ok(c, post)
}

func (h *Handler) deletePost(c *gin.Context) {
	ctx := c.Request.Context()
	postID := c.Param("id")
	userID := getUserID(c)

	if err := h.store.DeletePost(ctx, postID, userID); err != nil {
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "unauthorized") {
			errorResponse(c, http.StatusForbidden, CodeForbidden, "you can only delete your own posts")
			return
		}
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to delete post")
		return
	}
	ok(c, gin.H{"deleted": true})
}

type updatePostRequest struct {
	Content       string   `json:"content" binding:"required"`
	Visibility    string   `json:"visibility"`
	AttachmentIDs []string `json:"attachment_ids"`
}

func (h *Handler) updatePost(c *gin.Context) {
	var req updatePostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	postID := c.Param("id")
	userID := getUserID(c)
	isAdmin := getUserRole(c) == "admin"

	post, err := h.store.UpdatePost(ctx, postID, userID, isAdmin, store.UpdatePostInput{
		Content:       req.Content,
		Visibility:    req.Visibility,
		AttachmentIDs: req.AttachmentIDs,
	})
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "not allowed") {
			errorResponse(c, http.StatusForbidden, CodeForbidden, "you can only edit your own posts")
			return
		}
		if strings.Contains(msg, "not editable") {
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "post is not editable")
			return
		}
		log.Printf("update post %s: %v", postID, err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to update post")
		return
	}

	// Re-extract topics so newly added/removed hashtags update the index.
	_ = h.store.ExtractAndLinkTopics(ctx, post.ID, post.Content)

	ok(c, post)
}

func (h *Handler) getPostRevisions(c *gin.Context) {
	ctx := c.Request.Context()
	postID := c.Param("id")
	revisions, err := h.store.ListPostRevisions(ctx, postID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load revisions")
		return
	}
	ok(c, gin.H{"items": revisions})
}

// ────────────────────────────────────────────────────────────
// Comments
// ────────────────────────────────────────────────────────────

type addCommentRequest struct {
	Content       string   `json:"content" binding:"required"`
	ParentID      *string  `json:"parent_id"`
	AttachmentIDs []string `json:"attachment_ids"`
}

type repostRequest struct {
	Content string `json:"content"`
}

func (h *Handler) addComment(c *gin.Context) {
	var req addCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	postID := c.Param("id")
	userID := getUserID(c)

	comment, err := h.store.CreateComment(ctx, postID, userID, req.Content, req.ParentID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to add comment")
		return
	}

	// Create attachments if provided. The IDs are drive node IDs owned by the user.
	for i, nodeID := range req.AttachmentIDs {
		node, err := h.store.GetDriveNode(ctx, nodeID, userID)
		if err != nil || node == nil || node.ObjectID == nil || node.Kind != "file" {
			continue
		}
		_ = h.store.CreateCommentAttachment(ctx, comment.ID, *node.ObjectID, &node.ID, node.Name, node.MimeType, node.SizeBytes, i)
	}

	// Notify post author
	post, postErr := h.store.GetPostByID(ctx, postID, nil)
	if postErr == nil && post.AuthorID != userID {
		_ = h.store.CreateNotification(ctx, post.AuthorID, "comment", &userID, &postID, "your post received a new comment")
	}

	// Notify @mentioned users (best-effort)
	go h.store.NotifyMentions(context.Background(), req.Content, userID, postID)

	created(c, comment)
}

func (h *Handler) deleteComment(c *gin.Context) {
	ctx := c.Request.Context()
	commentID := c.Param("id")
	userID := getUserID(c)
	isAdmin := getUserRole(c) == "admin"

	err := h.store.DeleteComment(ctx, commentID, userID, isAdmin)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			errorResponse(c, http.StatusNotFound, CodeNotFound, "comment not found")
			return
		}
		if strings.Contains(err.Error(), "not allowed") {
			errorResponse(c, http.StatusForbidden, CodeForbidden, "you can only delete your own comments")
			return
		}
		log.Printf("delete comment %s: %v", commentID, err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to delete comment")
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) listComments(c *gin.Context) {
	ctx := c.Request.Context()
	postID := c.Param("id")
	params := getPageParams(c)

	sort := store.CommentSort{
		By:    c.DefaultQuery("sort", "created_at"),
		Order: c.DefaultQuery("order", "desc"),
	}

	var viewerID *string
	if uid := getUserID(c); uid != "" {
		viewerID = &uid
	}

	result, err := h.store.ListComments(ctx, postID, viewerID, sort, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load comments")
		return
	}
	ok(c, result)
}

// ────────────────────────────────────────────────────────────
// Comment Reactions
// ────────────────────────────────────────────────────────────

func (h *Handler) likeComment(c *gin.Context) {
	ctx := c.Request.Context()
	commentID := c.Param("id")
	userID := getUserID(c)

	if err := h.store.LikeComment(ctx, userID, commentID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to like comment")
		return
	}
	ok(c, gin.H{"liked": true})
}

func (h *Handler) unlikeComment(c *gin.Context) {
	ctx := c.Request.Context()
	commentID := c.Param("id")
	userID := getUserID(c)

	if err := h.store.UnlikeComment(ctx, userID, commentID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to unlike comment")
		return
	}
	ok(c, gin.H{"liked": false})
}

// ────────────────────────────────────────────────────────────
// Reactions
// ────────────────────────────────────────────────────────────

func (h *Handler) likePost(c *gin.Context) {
	ctx := c.Request.Context()
	postID := c.Param("id")
	userID := getUserID(c)

	if err := h.store.LikePost(ctx, userID, postID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to like post")
		return
	}

	// Notify post author
	post, postErr := h.store.GetPostByID(ctx, postID, nil)
	if postErr == nil && post.AuthorID != userID {
		_ = h.store.CreateNotification(ctx, post.AuthorID, "like", &userID, &postID, "your post received a like")
	}

	ok(c, gin.H{"liked": true})
}

func (h *Handler) unlikePost(c *gin.Context) {
	ctx := c.Request.Context()
	postID := c.Param("id")
	userID := getUserID(c)

	if err := h.store.UnlikePost(ctx, userID, postID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to unlike post")
		return
	}
	ok(c, gin.H{"liked": false})
}

// ────────────────────────────────────────────────────────────
// Repost
// ────────────────────────────────────────────────────────────

func (h *Handler) repost(c *gin.Context) {
	var req repostRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	postID := c.Param("id")
	userID := getUserID(c)

	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "repost comment is required")
		return
	}

	repost, err := h.store.Repost(ctx, userID, postID, req.Content)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to repost")
		return
	}

	// Notify original post author
	original, origErr := h.store.GetPostByID(ctx, postID, nil)
	if origErr == nil && original.AuthorID != userID {
		_ = h.store.CreateNotification(ctx, original.AuthorID, "repost", &userID, &postID, "your post was reposted")
	}

	created(c, repost)
}

// ────────────────────────────────────────────────────────────
// Follow
// ────────────────────────────────────────────────────────────

func (h *Handler) follow(c *gin.Context) {
	ctx := c.Request.Context()
	followeeID := c.Param("id")
	followerID := getUserID(c)

	if followerID == followeeID {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "cannot follow yourself")
		return
	}

	if err := h.store.Follow(ctx, followerID, followeeID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to follow user")
		return
	}

	// Notify followee
	_ = h.store.CreateNotification(ctx, followeeID, "follow", &followerID, nil, "you have a new follower")

	ok(c, gin.H{"following": true})
}

func (h *Handler) unfollow(c *gin.Context) {
	ctx := c.Request.Context()
	followeeID := c.Param("id")
	followerID := getUserID(c)

	if err := h.store.Unfollow(ctx, followerID, followeeID); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to unfollow user")
		return
	}
	ok(c, gin.H{"following": false})
}

// myFollowers returns the authenticated user's follower list. The endpoint is
// intentionally limited to "self" — there is no public route for viewing
// another user's followers.
func (h *Handler) myFollowers(c *gin.Context) {
	ctx := c.Request.Context()
	userID := getUserID(c)
	params := getPageParams(c)

	result, err := h.store.ListFollowers(ctx, userID, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load followers")
		return
	}
	ok(c, result)
}

// myFollowing returns the list of users the authenticated user follows.
// Like myFollowers, this is restricted to self.
func (h *Handler) myFollowing(c *gin.Context) {
	ctx := c.Request.Context()
	userID := getUserID(c)
	params := getPageParams(c)

	result, err := h.store.ListFollowing(ctx, userID, params)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load following")
		return
	}
	ok(c, result)
}

// ────────────────────────────────────────────────────────────
// Reports
// ────────────────────────────────────────────────────────────

type reportRequest struct {
	TargetType string `json:"target_type" binding:"required"`
	TargetID   string `json:"target_id" binding:"required"`
	Reason     string `json:"reason" binding:"required"`
}

func (h *Handler) report(c *gin.Context) {
	var req reportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	userID := getUserID(c)

	if err := h.store.CreateReport(ctx, userID, req.TargetType, req.TargetID, req.Reason); err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to create report")
		return
	}
	created(c, gin.H{"reported": true})
}

// mentionSearch (GET /api/users/mention?q=xxx) — lightweight user search for @mention autocomplete.
// Returns up to 8 users matching username or display_name.
func (h *Handler) mentionSearch(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		c.JSON(http.StatusOK, gin.H{"users": []struct{}{}})
		return
	}
	ctx := c.Request.Context()
	result, err := h.store.SearchUsers(ctx, q, model.PageParams{Limit: 8})
	if err != nil || result == nil {
		c.JSON(http.StatusOK, gin.H{"users": []struct{}{}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": result.Items})
}
