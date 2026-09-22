package model

import "time"

// ────────────────────────────────────────────────────────────
// Users & Auth
// ────────────────────────────────────────────────────────────

type User struct {
	ID                 string     `json:"id"`
	Email              string     `json:"email,omitempty"`
	Username           string     `json:"username"`
	DisplayName        string     `json:"display_name"`
	Bio                string     `json:"bio"`
	Role               string     `json:"role"`
	AvatarObjectID     *string    `json:"avatar_object_id,omitempty"`
	AvatarDataURL      string     `json:"avatar_data_url,omitempty"`
	WalletBalanceCents int64      `json:"wallet_balance_cents,omitempty"`
	StorageUsedBytes   int64      `json:"storage_used_bytes,omitempty"`
	StorageQuotaBytes  int64      `json:"storage_quota_bytes,omitempty"`
	UploadLimitBytes   int64      `json:"upload_limit_bytes,omitempty"`
	MembershipPlanID   *string    `json:"membership_plan_id,omitempty"`
	MembershipEndsAt   *time.Time `json:"membership_ends_at,omitempty"`
	IsBanned           bool       `json:"is_banned,omitempty"`
	IsMuted            bool       `json:"is_muted,omitempty"`
	MutedUntil         *time.Time `json:"muted_until,omitempty"`
	EmailVerified      bool       `json:"email_verified"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	// Computed / joined fields (not stored directly)
	IsVIP          bool `json:"is_vip"`
	FollowerCount  int  `json:"follower_count,omitempty"`
	FollowingCount int  `json:"following_count,omitempty"`
	PostCount      int  `json:"post_count,omitempty"`
	IsFollowing    bool `json:"is_following,omitempty"`
}

// ComputeIsVIP returns true if the user currently has an active membership.
// Call this after scanning a User from the DB.
func (u *User) ComputeIsVIP() {
	u.IsVIP = u.MembershipEndsAt != nil && u.MembershipEndsAt.After(time.Now())
}

type Session struct {
	ID               string    `json:"id"`
	UserID           string    `json:"user_id"`
	RefreshTokenHash string    `json:"refresh_token_hash"`
	UserAgent        string    `json:"user_agent"`
	IPAddress        string    `json:"ip_address"`
	ExpiresAt        time.Time `json:"expires_at"`
	CreatedAt        time.Time `json:"created_at"`
}

// ────────────────────────────────────────────────────────────
// Social
// ────────────────────────────────────────────────────────────

type Post struct {
	ID           string     `json:"id"`
	AuthorID     string     `json:"author_id"`
	Content      string     `json:"content"`
	Visibility   string     `json:"visibility"`
	Status       string     `json:"status"`
	RepostOfID   *string    `json:"repost_of_id,omitempty"`
	LikeCount    int        `json:"like_count"`
	CommentCount int        `json:"comment_count"`
	RepostCount  int        `json:"repost_count"`
	ViewCount    int        `json:"view_count"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	EditedAt     *time.Time `json:"edited_at,omitempty"`
	// Joined
	Author      *User            `json:"author,omitempty"`
	Attachments []PostAttachment `json:"attachments,omitempty"`
	Topics      []Topic          `json:"topics,omitempty"`
	IsLiked     bool             `json:"is_liked,omitempty"`
	IsReposted  bool             `json:"is_reposted,omitempty"`
	RepostOf    *Post            `json:"repost_of,omitempty"`
}

// PostRevision is a snapshot of a post taken right before an edit.
type PostRevision struct {
	ID          string                  `json:"id"`
	PostID      string                  `json:"post_id"`
	EditorID    string                  `json:"editor_id"`
	Content     string                  `json:"content"`
	Visibility  string                  `json:"visibility"`
	Attachments []PostRevisionAttachment `json:"attachments"`
	CreatedAt   time.Time               `json:"created_at"`
	// Joined
	Editor *User `json:"editor,omitempty"`
}

// PostRevisionAttachment is the JSON-shape stored inside post_revisions.attachments.
type PostRevisionAttachment struct {
	ObjectID    string  `json:"object_id"`
	DriveNodeID *string `json:"drive_node_id,omitempty"`
	Name        string  `json:"name"`
	MimeType    string  `json:"mime_type"`
	SizeBytes   int64   `json:"size_bytes"`
}

type Comment struct {
	ID          string           `json:"id"`
	PostID      string           `json:"post_id"`
	AuthorID    string           `json:"author_id"`
	ParentID    *string          `json:"parent_id,omitempty"`
	Content     string           `json:"content"`
	LikeCount   int              `json:"like_count"`
	IsLiked     bool             `json:"is_liked"`
	CreatedAt   time.Time        `json:"created_at"`
	Author      *User            `json:"author,omitempty"`
	Attachments []PostAttachment `json:"attachments,omitempty"`
	// Replies is the flat list of all descendant comments under this top-level
	// comment, ordered by created_at ASC. Only populated on top-level comments
	// (ParentID == nil) returned by ListComments.
	Replies []Comment `json:"replies,omitempty"`
	// ReplyToUser is the author of the direct parent comment (for the
	// "回复 @XXX" prefix used in 楼中楼 display). Only set when ParentID is
	// not nil and the parent isn't the top-level root of the thread.
	ReplyToUser *User `json:"reply_to_user,omitempty"`
}

type Topic struct {
	ID            string    `json:"id"`
	Slug          string    `json:"slug"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	PostCount     int       `json:"post_count"`
	FollowerCount int       `json:"follower_count"`
	CoverURL      string    `json:"cover_url"`
	IsBanned      bool      `json:"is_banned,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	IsFollowing   bool      `json:"is_following,omitempty"`
}

// HotSearch represents a single entry on the hot search board.
type HotSearch struct {
	ID         string    `json:"id"`
	Keyword    string    `json:"keyword"`
	LinkType   string    `json:"link_type"`  // 'topic' | 'search' | 'url'
	LinkValue  string    `json:"link_value"` // topic slug / search keyword / external url
	Score      float64   `json:"score"`
	PinnedRank *int      `json:"pinned_rank,omitempty"`
	Hidden     bool      `json:"hidden"`
	Source     string    `json:"source"` // 'auto' | 'manual'
	UpdatedAt  time.Time `json:"updated_at"`
	CreatedAt  time.Time `json:"created_at"`
}

type Notification struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	Type      string     `json:"type"`
	ActorID   *string    `json:"actor_id,omitempty"`
	PostID    *string    `json:"post_id,omitempty"`
	Message   string     `json:"message"`
	ReadAt    *time.Time `json:"read_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	Actor     *User      `json:"actor,omitempty"`
}

// ────────────────────────────────────────────────────────────
// Storage & Drive
// ────────────────────────────────────────────────────────────

type StoragePolicy struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	Type             string    `json:"type"`
	IsEnabled        bool      `json:"is_enabled"`
	IsDefault        bool      `json:"is_default"`
	Endpoint         string    `json:"endpoint,omitempty"`
	Bucket           string    `json:"bucket,omitempty"`
	Region           string    `json:"region,omitempty"`
	AccessKey        string    `json:"-"`
	SecretKey        string    `json:"-"`
	LocalPath        string    `json:"local_path,omitempty"`
	DirNamingRule    string    `json:"dir_naming_rule"`
	FileNamingRule   string    `json:"file_naming_rule"`
	MaxFileSizeBytes int64     `json:"max_file_size_bytes"`
	AllowedMimeTypes string    `json:"allowed_mime_types"`
	IsPrivate        bool      `json:"is_private"`
	ProxyDownload    bool      `json:"proxy_download"`
	BaseURL          string    `json:"base_url,omitempty"`
	URLExpireSeconds int       `json:"url_expire_seconds"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type Object struct {
	ID               string    `json:"id"`
	OwnerID          string    `json:"owner_id"`
	PolicyID         string    `json:"policy_id"`
	ObjectKey        string    `json:"object_key"`
	SHA256           string    `json:"sha256"`
	MimeType         string    `json:"mime_type"`
	SizeBytes        int64     `json:"size_bytes"`
	Status           string    `json:"status"`
	PreviewStatus    string    `json:"preview_status"`
	PreviewObjectKey *string   `json:"preview_object_key,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

// AdminObjectListItem is one row of the admin file management list. It
// joins the object with its owner / policy / reference counts so the UI
// can show "Bob owns this 5 MiB image, referenced by 2 drive nodes and 1
// post" without N+1 lookups.
type AdminObjectListItem struct {
	Object
	OwnerUsername    string `json:"owner_username"`
	OwnerDisplayName string `json:"owner_display_name"`
	PolicyName       string `json:"policy_name"`
	DriveRefCount    int    `json:"drive_ref_count"`
	PostRefCount     int    `json:"post_ref_count"`
}

type DriveNode struct {
	ID        string      `json:"id"`
	UserID    string      `json:"user_id"`
	ParentID  *string     `json:"parent_id,omitempty"`
	ObjectID  *string     `json:"object_id,omitempty"`
	Kind      string      `json:"kind"`
	Name      string      `json:"name"`
	SizeBytes int64       `json:"size_bytes"`
	MimeType  string      `json:"mime_type,omitempty"`
	IsTrashed bool        `json:"is_trashed"`
	// TrashedAt records when the node entered the recycle bin. NULL when
	// the node is live. The recycle bin UI uses this for ordering and
	// "deleted N days ago" labels.
	TrashedAt *time.Time `json:"trashed_at,omitempty"`
	// IsSystem marks nodes that are managed by the platform (currently the
	// per-user "帖子图片" folder). System nodes — and any file directly
	// inside them — cannot be renamed, moved, copied, shared or deleted by
	// the user. Files inside the system folder also do not consume the
	// user's storage quota.
	IsSystem  bool        `json:"is_system"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
	Children  []DriveNode `json:"children,omitempty"`
}

type PostAttachment struct {
	ID          string  `json:"id"`
	PostID      string  `json:"post_id"`
	ObjectID    string  `json:"object_id"`
	DriveNodeID *string `json:"drive_node_id,omitempty"`
	Name        string  `json:"name"`
	MimeType    string  `json:"mime_type"`
	SizeBytes   int64   `json:"size_bytes"`
	SortOrder   int     `json:"sort_order"`
	// URL is the resolved direct/CDN URL for this attachment when the
	// underlying storage policy has a `base_url` configured (typically a
	// CDN domain or an nginx reverse proxy in front of local storage).
	// Empty when the policy has no base_url — clients should fall back to
	// the authenticated /api/files/{object_id}/preview endpoint.
	URL string `json:"url,omitempty"`
	// IsDeleted is true when the attachment's source file is no longer
	// available — either the owning drive_node has been trashed/purged, or
	// the underlying object was hard-deleted by an admin (objects.status =
	// 'deleted'). The frontend renders these as a greyed-out placeholder
	// instead of a download button.
	IsDeleted bool `json:"is_deleted"`
}

type ShareLink struct {
	ID            string     `json:"id"`
	OwnerID       string     `json:"owner_id"`
	DriveNodeID   *string    `json:"drive_node_id,omitempty"`
	Token         string     `json:"token"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	DownloadCount int        `json:"download_count"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	HasPassword   bool       `json:"has_password"`
	Node          *DriveNode `json:"node,omitempty"`
	// NodeDeleted reports whether the share's source file has been
	// trashed or hard-deleted. The public viewer renders a "文件已被删除"
	// state when this is true.
	NodeDeleted bool `json:"node_deleted"`
}

// ────────────────────────────────────────────────────────────
// Billing & Membership
// ────────────────────────────────────────────────────────────

type MembershipPlan struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	Slug              string  `json:"slug"`
	PriceCents        int64   `json:"price_cents"`
	DurationDays      int     `json:"duration_days"`
	StoragePolicyID   *string `json:"storage_policy_id,omitempty"`
	StorageQuotaBytes int64   `json:"storage_quota_bytes"`
	UploadLimitBytes  int64   `json:"upload_limit_bytes"`
	IsActive          bool    `json:"is_active"`
	SortOrder         int     `json:"sort_order"`
}

type WalletLedger struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	Type          string    `json:"type"`
	AmountCents   int64     `json:"amount_cents"`
	BalanceAfter  int64     `json:"balance_after"`
	ReferenceType string    `json:"reference_type"`
	ReferenceID   string    `json:"reference_id"`
	Note          string    `json:"note"`
	CreatedAt     time.Time `json:"created_at"`
}

// Membership is one purchased membership row. Multiple may be stacked per
// user; the highest-tier active row is what determines the user's current
// plan and quotas. Days are consumed by the daily worker, top-tier first.
type Membership struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	PlanID        string    `json:"plan_id"`
	StartedAt     time.Time `json:"started_at"`
	EndsAt        time.Time `json:"ends_at"`
	DurationDays  int       `json:"duration_days"`
	ConsumedDays  int       `json:"consumed_days"`
	RemainingDays int       `json:"remaining_days"`
	SourceType    string    `json:"source_type"`
	SourceID      string    `json:"source_id,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	// Joined plan info (populated by ListUserMemberships).
	PlanName        string `json:"plan_name,omitempty"`
	PlanSlug        string `json:"plan_slug,omitempty"`
	PlanStorage     int64  `json:"plan_storage_bytes,omitempty"`
	PlanUploadLimit int64  `json:"plan_upload_limit_bytes,omitempty"`
	IsActive        bool   `json:"is_active"`
}

type RedeemBatch struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	AmountCents   int64     `json:"amount_cents"`
	TotalCount    int       `json:"total_count"`
	RedeemedCount int       `json:"redeemed_count"`
	CreatedBy     string    `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
}

type RedeemCode struct {
	ID          string     `json:"id"`
	BatchID     string     `json:"batch_id"`
	Code        string     `json:"code"`
	AmountCents int64      `json:"amount_cents"`
	RedeemedBy  *string    `json:"redeemed_by,omitempty"`
	RedeemedAt  *time.Time `json:"redeemed_at,omitempty"`
}

// StripeOrder represents a single Stripe Checkout Session created by a user.
// `Kind` is either "recharge" (credit wallet) or "membership" (also activate
// the linked plan after payment). The webhook handler is the source of
// truth for `Status` transitions.
type StripeOrder struct {
	ID            string     `json:"id"`
	UserID        string     `json:"user_id"`
	SessionID     string     `json:"session_id"`
	PaymentIntent string     `json:"payment_intent,omitempty"`
	Kind          string     `json:"kind"`
	PlanID        *string    `json:"plan_id,omitempty"`
	AmountCents   int64      `json:"amount_cents"`
	Currency      string     `json:"currency"`
	Status        string     `json:"status"`
	PaidAt        *time.Time `json:"paid_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`

	// Populated by the admin list query.
	Username    string  `json:"username,omitempty"`
	UserEmail   string  `json:"user_email,omitempty"`
	DisplayName string  `json:"display_name,omitempty"`
	PlanName    *string `json:"plan_name,omitempty"`
}

// ────────────────────────────────────────────────────────────
// Reports
// ────────────────────────────────────────────────────────────

type Report struct {
	ID         string     `json:"id"`
	ReporterID string     `json:"reporter_id"`
	TargetType string     `json:"target_type"`
	TargetID   string     `json:"target_id"`
	Reason     string     `json:"reason"`
	Status     string     `json:"status"`
	ResolvedBy *string    `json:"resolved_by,omitempty"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	Reporter   *User      `json:"reporter,omitempty"`
	// Target preview fields populated by the admin list query for one-click
	// navigation to the offending content.
	TargetPostID   *string `json:"target_post_id,omitempty"`   // post id (for post / comment targets)
	TargetUsername *string `json:"target_username,omitempty"`  // for user targets
	TargetDeleted  bool    `json:"target_deleted,omitempty"`   // true if the target row no longer exists
}

// ────────────────────────────────────────────────────────────
// Pagination
// ────────────────────────────────────────────────────────────

type PageParams struct {
	Cursor string
	Limit  int
}

type PageResult[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
	Total      int    `json:"total,omitempty"`
}

// ────────────────────────────────────────────────────────────
// Admin dashboard
// ────────────────────────────────────────────────────────────

type AdminDashboard struct {
	UserCount         int   `json:"user_count"`
	PostCount         int   `json:"post_count"`
	FileCount         int   `json:"file_count"`
	TotalStorageBytes int64 `json:"total_storage_bytes"`
	PendingReports    int   `json:"pending_reports"`
}
