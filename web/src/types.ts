export type ID = string

export interface User {
  id: ID
  username: string
  email: string
  display_name: string
  avatar_url?: string
  avatar_data_url?: string
  avatar_object_id?: ID | null
  bio: string
  role: 'user' | 'admin' | string
  membership_expires_at: string | null
  membership_ends_at?: string | null
  is_vip: boolean
  storage_used: number
  storage_limit: number
  storage_used_bytes?: number
  storage_quota_bytes?: number
  upload_limit_bytes?: number
  follower_count: number
  following_count: number
  post_count: number
  is_following?: boolean
  is_banned: boolean
  is_muted: boolean
  muted_until?: string | null
  email_verified: boolean
  created_at: string
  updated_at: string
}

export interface Topic {
  id: ID
  name: string
  slug: string
  description: string
  post_count: number
  follower_count: number
  cover_url: string
  is_following?: boolean
  is_banned?: boolean
  created_at: string
}

export interface HotSearch {
  id: ID
  keyword: string
  link_type: 'topic' | 'search' | 'url' | string
  link_value: string
  score: number
  pinned_rank: number | null
  hidden: boolean
  source: 'auto' | 'manual' | string
  updated_at: string
  created_at: string
}

export interface SearchSuggest {
  topics: Topic[]
  users: User[]
}

export interface PostAttachment {
  id: ID
  post_id: ID
  object_id: ID
  drive_node_id: ID | null
  file_name: string
  file_size: number
  mime_type: string
  sort_order: number
  url?: string
  // True when the source file has been trashed/purged by its owner or
  // hard-deleted by an admin. The renderer shows a 已删除 placeholder.
  is_deleted?: boolean
}

export interface Post {
  id: ID
  author: User
  author_id?: ID
  content: string
  visibility: 'public' | 'followers' | 'private'
  status?: 'published' | 'hidden' | 'deleted' | string
  like_count: number
  comment_count: number
  repost_count: number
  view_count: number
  is_liked: boolean
  is_reposted: boolean
  original_post: Post | null
  attachments: PostAttachment[]
  topics: Topic[]
  created_at: string
  updated_at: string
  // null when the post has never been edited.
  edited_at: string | null
}

export interface PostRevisionAttachment {
  object_id: ID
  drive_node_id: ID | null
  name: string
  mime_type: string
  size_bytes: number
}

export interface PostRevision {
  id: ID
  post_id: ID
  editor: User
  content: string
  visibility: Post['visibility']
  attachments: PostRevisionAttachment[]
  created_at: string
}

export interface Comment {
  id: ID
  post_id: ID
  author: User
  content: string
  parent_id: ID | null
  replies: Comment[]
  /** Author of the direct parent comment (for 楼中楼 "回复 @XXX" prefix). */
  reply_to_user?: User | null
  like_count: number
  is_liked: boolean
  attachments?: PostAttachment[]
  created_at: string
}

export interface Notification {
  id: ID
  type: 'like' | 'comment' | 'follow' | 'repost' | 'system' | string
  actor: User | null
  post_id: ID | null
  comment_id: ID | null
  message: string
  is_read: boolean
  created_at: string
}

export type StoragePolicyType = 'local' | 's3' | 'oss' | 'cos' | 'qiniu' | 'upyun'

export interface StoragePolicy {
  id: ID
  name: string
  type: StoragePolicyType | string
  is_default: boolean
  is_enabled: boolean
  max_file_size: number
  allowed_types: string[]
  // 后端存储字段（access_key / secret_key 不会被后端返回）
  endpoint: string
  bucket: string
  region: string
  local_path: string
  base_url: string
  dir_naming_rule: string
  file_naming_rule: string
  is_private: boolean
  proxy_download: boolean
  url_expire_seconds: number
  created_at: string
  updated_at: string
}

export interface DriveNode {
  id: ID
  owner_id?: ID
  parent_id: ID | null
  name: string
  is_folder: boolean
  object_id: ID | null
  size: number
  mime_type: string
  children: DriveNode[]
  is_trashed: boolean
  // is_system marks platform-managed nodes (currently the per-user
  // "帖子图片" folder used for inline post images). System nodes — and
  // anything inside them — cannot be renamed, moved, copied, shared,
  // uploaded into, or deleted by the user.
  is_system?: boolean
  trashed_at: string | null
  created_at: string
  updated_at: string
}

export interface ShareLink {
  id: ID
  node_id: ID | null
  node: DriveNode | null
  token: string
  password: string | null
  expires_at: string | null
  download_count: number
  max_downloads: number | null
  created_at: string
  has_password?: boolean
  // True when the share's underlying file has been trashed or hard-purged.
  // The public viewer renders a "文件已被删除" state.
  node_deleted?: boolean
}

export interface MembershipPlan {
  id: ID
  name: string
  description: string
  price: number
  duration_days: number
  storage_limit: number
  upload_limit: number
  features: string[]
}

// Admin-facing membership plan with all editable fields preserved.
export interface AdminMembershipPlan {
  id: ID
  name: string
  slug: string
  price_cents: number
  duration_days: number
  storage_policy_id: ID | null
  storage_quota_bytes: number
  upload_limit_bytes: number
  is_active: boolean
  sort_order: number
}

export interface UpsertAdminMembershipPlanReq {
  name: string
  slug: string
  price_cents: number
  duration_days: number
  storage_policy_id: ID | null
  storage_quota_bytes: number
  upload_limit_bytes: number
  is_active: boolean
  sort_order: number
}

export interface WalletLedger {
  id: ID
  user_id: ID
  amount: number
  balance_after: number
  type: 'credit' | 'debit' | string
  description: string
  created_at: string
}

// One purchased membership row in a user's stack. Stacked memberships are
// consumed top-tier first; `is_active` is true while it still has remaining
// days, and the highest-tier active row decides the user's effective plan.
export interface UserMembership {
  id: ID
  user_id: ID
  plan_id: ID
  plan_name: string
  plan_slug: string
  plan_storage_bytes: number
  plan_upload_limit_bytes: number
  duration_days: number
  consumed_days: number
  remaining_days: number
  is_active: boolean
  source_type: string
  source_id?: string
  started_at: string
  ends_at: string
  created_at: string
}

export interface RedeemBatch {
  id: ID
  name: string
  amount: number
  count: number
  used_count: number
  expires_at: string | null
  created_at: string
}

export interface RedeemCode {
  id: ID
  batch_id: ID
  code: string
  amount: number
  is_used: boolean
  used_by: ID | null
  used_at: string | null
  expires_at: string | null
}

export interface Report {
  id: ID
  reporter: User
  target_type: 'post' | 'comment' | 'user' | string
  target_id: ID
  reason: string
  status: 'pending' | 'resolved' | 'dismissed' | string
  resolved_by: ID | null
  resolved_at: string | null
  created_at: string
  // Target preview metadata supplied by admin list endpoint.
  target_post_id?: ID | null    // post id (post / comment targets)
  target_username?: string | null // for user targets
  target_deleted?: boolean
}

export interface AdminDashboard {
  user_count: number
  post_count: number
  file_count: number
  total_storage_bytes: number
  pending_reports: number
}

export interface SystemSetting {
  key: string
  value: string
  description: string
}

export interface PageResult<T> {
  items: T[]
  next_cursor?: string
  total?: number
}

export interface UserProfileData {
  user: User
  posts: PageResult<Post>
}

export interface LoginReq {
  login: string
  password: string
}

export interface RegisterReq {
  email: string
  username: string
  display_name?: string
  password: string
}

export interface AuthResponse {
  access_token: string
  refresh_token: string
  user: User
}

export interface CreatePostReq {
  content: string
  visibility: 'public' | 'followers' | 'private'
  attachment_ids?: ID[]
}

export interface CreateCommentReq {
  content: string
  parent_id?: ID
  attachment_ids?: ID[]
}

export interface CreateFolderReq {
  parent_id: ID | null
  name: string
}

export interface UpdateNodeReq {
  name?: string
  parent_id?: ID | null
}

export interface CreateShareReq {
  node_id: ID
  password?: string
  expires_at?: string
  max_downloads?: number
}

export interface UpdateProfileReq {
  display_name?: string
  bio?: string
  avatar_url?: string
  avatar_object_id?: ID | null
  avatar_data_url?: string
}

export interface RepostReq {
  content: string
}

export interface ChangePasswordReq {
  old_password: string
  new_password: string
}

export interface CreateReportReq {
  target_type: 'post' | 'comment' | 'user'
  target_id: ID
  reason: string
}

export interface CreateRedeemBatchReq {
  name: string
  amount: number
  count: number
  expires_at?: string
}

export interface CreateStoragePolicyReq {
  name: string
  type: StoragePolicy['type']
  is_default?: boolean
  is_enabled?: boolean
  max_file_size: number
  allowed_types: string[]
  endpoint?: string
  bucket?: string
  region?: string
  access_key?: string
  secret_key?: string
  local_path?: string
  base_url?: string
  dir_naming_rule?: string
  file_naming_rule?: string
  is_private?: boolean
  proxy_download?: boolean
  url_expire_seconds?: number
}

export interface PurchaseMembershipReq {
  plan_id: ID
}

export interface RedeemCodeReq {
  code: string
}

export interface UpsertSettingReq {
  key: string
  value: string
  is_secret?: boolean
}

export interface StripeConfig {
  enabled: boolean
  publishable_key: string
  currency: string
  credit_rate: number
}

export interface StripeCheckoutReq {
  kind: 'recharge' | 'membership'
  amount_cents?: number
  plan_id?: ID
}

export interface StripeCheckoutResp {
  session_id: string
  url: string
  client_secret: string
}

export interface StripeOrder {
  id: ID
  user_id: ID
  session_id: string
  payment_intent?: string
  kind: 'recharge' | 'membership' | string
  plan_id?: ID | null
  amount_cents: number
  currency: string
  status: 'pending' | 'paid' | 'failed' | 'canceled' | string
  paid_at?: string | null
  created_at: string
  updated_at: string
  // Populated by the admin list endpoint.
  username?: string
  user_email?: string
  display_name?: string
  plan_name?: string | null
}

export interface CreditWalletReq {
  user_id: ID
  amount: number
  description: string
}

export interface VerifySharePasswordReq {
  password: string
}
