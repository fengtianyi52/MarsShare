import type {
  AdminDashboard,
  AuthResponse,
  ChangePasswordReq,
  Comment,
  CreateCommentReq,
  CreateFolderReq,
  CreatePostReq,
  CreateRedeemBatchReq,
  CreateReportReq,
  CreateShareReq,
  CreateStoragePolicyReq,
  CreditWalletReq,
  DriveNode,
  LoginReq,
  MembershipPlan,
  Notification,
  PageResult,
  Post,
  PostAttachment,
  PurchaseMembershipReq,
  RedeemBatch,
  RedeemCode,
  RedeemCodeReq,
  RegisterReq,
  Report,
  RepostReq,
  ShareLink,
  StoragePolicy,
  Topic,
  UpdateNodeReq,
  UpdateProfileReq,
  UpsertSettingReq,
  User,
  UserProfileData,
  VerifySharePasswordReq,
  WalletLedger,
} from '../types'
import { tStatic } from './i18n'

// ApiError carries both a human-readable message and the backend error code.
export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly data: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
  }
}

const TOKEN_KEY = 'marsshare_access_token'
const REFRESH_KEY = 'marsshare_refresh_token'

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

let refreshPromise: Promise<AuthResponse> | null = null

async function refreshTokens(): Promise<AuthResponse> {
  const refreshToken = localStorage.getItem(REFRESH_KEY)
  if (!refreshToken) throw new Error('No refresh token')

  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!res.ok) {
    clearTokens()
    throw new Error('Token refresh failed')
  }
  const data = normalizeAuthResponse(await res.json())
  setTokens(data.access_token, data.refresh_token)
  return data
}

// Peeks at the JSON body of a non-ok response without consuming it for the
// caller. Returns the parsed body and a fresh Response that the rest of the
// pipeline can still read from.
async function readErrorBody(res: Response): Promise<{ body: any; res: Response }> {
  const text = await res.text()
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    body = { error: { message: res.statusText } }
  }
  // Rebuild a Response so callers further down still see the same payload.
  return { body, res: new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers }) }
}

// Fired when the backend returns a BANNED error for the current account.
// AuthProvider listens for this and forces an immediate logout + redirect.
export const BANNED_EVENT = 'marsshare:account-banned'

function emitBanned(message: string) {
  clearTokens()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BANNED_EVENT, { detail: { message } }))
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  let res = await fetch(url, { ...options, headers })

  if (res.status === 401 && token) {
    // Peek at the body first: if the server explicitly says BANNED, do not
    // attempt to refresh — refresh will also fail, but more importantly we
    // want to surface the ban reason and force-logout immediately rather
    // than masking it as "Session expired".
    const peeked = await readErrorBody(res)
    res = peeked.res
    if (peeked.body?.error?.code === 'BANNED') {
      const msg = peeked.body?.error?.message || tStatic('auth.accountBanned')
      emitBanned(msg)
      throw new ApiError(msg, 'BANNED', peeked.body?.error ?? {})
    }

    try {
      if (!refreshPromise) {
        refreshPromise = refreshTokens()
      }
      const authData = await refreshPromise
      refreshPromise = null
      headers.Authorization = `Bearer ${authData.access_token}`
      res = await fetch(url, { ...options, headers })
    } catch {
      refreshPromise = null
      clearTokens()
      throw new Error('Session expired')
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }))
    const msg = body?.error?.message || body?.message || `HTTP ${res.status}`
    const code = body?.error?.code ?? ''
    if (code === 'BANNED') {
      emitBanned(msg || tStatic('auth.accountBanned'))
    }
    const err = new ApiError(msg, code, body?.error ?? {})
    throw err
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

function toId(value: unknown): string {
  return value == null ? '' : String(value)
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function centsToAmount(value: unknown): number {
  return toNumber(value) / 100
}

function normalizeUser(raw: any): User {
  const avatarDataUrl = raw?.avatar_data_url || undefined
  const membershipEndsAt = raw?.membership_ends_at ?? raw?.membership_expires_at ?? null
  // Backend sends is_vip computed; fall back to comparing membership_ends_at to now
  // for old responses that don't include the field yet.
  const isVIP = typeof raw?.is_vip === 'boolean'
    ? raw.is_vip
    : Boolean(membershipEndsAt && new Date(membershipEndsAt).getTime() > Date.now())
  return {
    id: toId(raw?.id),
    username: raw?.username ?? '',
    email: raw?.email ?? '',
    display_name: raw?.display_name ?? raw?.username ?? '',
    avatar_url: raw?.avatar_url || avatarDataUrl || undefined,
    avatar_data_url: avatarDataUrl,
    avatar_object_id: raw?.avatar_object_id ?? null,
    bio: raw?.bio ?? '',
    role: raw?.role ?? 'user',
    membership_expires_at: raw?.membership_expires_at ?? membershipEndsAt,
    membership_ends_at: membershipEndsAt,
    is_vip: isVIP,
    storage_used: toNumber(raw?.storage_used ?? raw?.storage_used_bytes),
    storage_limit: toNumber(raw?.storage_limit ?? raw?.storage_quota_bytes),
    storage_used_bytes: toNumber(raw?.storage_used_bytes ?? raw?.storage_used),
    storage_quota_bytes: toNumber(raw?.storage_quota_bytes ?? raw?.storage_limit),
    upload_limit_bytes: toNumber(raw?.upload_limit_bytes),
    follower_count: toNumber(raw?.follower_count),
    following_count: toNumber(raw?.following_count),
    post_count: toNumber(raw?.post_count),
    is_following: Boolean(raw?.is_following),
    is_banned: Boolean(raw?.is_banned),
    is_muted: Boolean(raw?.is_muted),
    muted_until: raw?.muted_until ?? null,
    email_verified: Boolean(raw?.email_verified),
    created_at: raw?.created_at ?? '',
    updated_at: raw?.updated_at ?? '',
  }
}

function normalizeTopic(raw: any): Topic {
  // Backend stores Title as `#xxx#`; the UI prefers a bare label so the
  // rendering side can prepend its own `#` (and avoid double-hash output).
  const rawTitle = (raw?.title ?? raw?.name ?? raw?.slug ?? '') as string
  const name = rawTitle.replace(/^#+/, '').replace(/#+$/, '')
  return {
    id: toId(raw?.id),
    name,
    slug: raw?.slug ?? '',
    description: raw?.description ?? '',
    post_count: toNumber(raw?.post_count),
    follower_count: toNumber(raw?.follower_count),
    cover_url: raw?.cover_url ?? '',
    is_following: raw?.is_following != null ? Boolean(raw.is_following) : undefined,
    is_banned: raw?.is_banned != null ? Boolean(raw.is_banned) : undefined,
    created_at: raw?.created_at ?? '',
  }
}

function normalizeHotSearch(raw: any): import('../types').HotSearch {
  return {
    id: toId(raw?.id),
    keyword: raw?.keyword ?? '',
    link_type: raw?.link_type ?? 'topic',
    link_value: raw?.link_value ?? '',
    score: typeof raw?.score === 'number' ? raw.score : Number(raw?.score ?? 0),
    pinned_rank: raw?.pinned_rank == null ? null : toNumber(raw.pinned_rank),
    hidden: Boolean(raw?.hidden),
    source: raw?.source ?? 'auto',
    updated_at: raw?.updated_at ?? '',
    created_at: raw?.created_at ?? '',
  }
}

function normalizeAttachment(raw: any): PostAttachment {
  const fileName = raw?.file_name ?? raw?.name ?? ''
  const fileSize = toNumber(raw?.file_size ?? raw?.size_bytes)
  return {
    id: toId(raw?.id),
    post_id: toId(raw?.post_id),
    object_id: toId(raw?.object_id),
    drive_node_id: raw?.drive_node_id ? toId(raw.drive_node_id) : null,
    file_name: fileName,
    file_size: fileSize,
    mime_type: raw?.mime_type ?? '',
    sort_order: toNumber(raw?.sort_order),
    url: raw?.url,
    is_deleted: Boolean(raw?.is_deleted),
  }
}

function normalizePost(raw: any): Post {
  return {
    id: toId(raw?.id),
    author: normalizeUser(raw?.author ?? {}),
    author_id: raw?.author_id ? toId(raw.author_id) : undefined,
    content: raw?.content ?? '',
    visibility: raw?.visibility ?? 'public',
    status: raw?.status ?? 'published',
    like_count: toNumber(raw?.like_count),
    comment_count: toNumber(raw?.comment_count),
    repost_count: toNumber(raw?.repost_count),
    view_count: toNumber(raw?.view_count),
    is_liked: Boolean(raw?.is_liked),
    is_reposted: Boolean(raw?.is_reposted),
    original_post: raw?.original_post
      ? normalizePost(raw.original_post)
      : raw?.repost_of
        ? normalizePost(raw.repost_of)
        : null,
    attachments: toArray<any>(raw?.attachments).map(normalizeAttachment),
    topics: toArray<any>(raw?.topics).map(normalizeTopic),
    created_at: raw?.created_at ?? '',
    updated_at: raw?.updated_at ?? raw?.created_at ?? '',
    edited_at: raw?.edited_at ?? null,
  }
}

function normalizePostRevision(raw: any): import('../types').PostRevision {
  return {
    id: toId(raw?.id),
    post_id: toId(raw?.post_id),
    editor: normalizeUser(raw?.editor ?? {}),
    content: raw?.content ?? '',
    visibility: raw?.visibility ?? 'public',
    attachments: toArray<any>(raw?.attachments).map((a: any) => ({
      object_id: toId(a?.object_id),
      drive_node_id: a?.drive_node_id ? toId(a.drive_node_id) : null,
      name: a?.name ?? '',
      mime_type: a?.mime_type ?? '',
      size_bytes: toNumber(a?.size_bytes),
    })),
    created_at: raw?.created_at ?? '',
  }
}

function normalizeComment(raw: any): Comment {
  return {
    id: toId(raw?.id),
    post_id: toId(raw?.post_id),
    author: normalizeUser(raw?.author ?? {}),
    content: raw?.content ?? '',
    parent_id: raw?.parent_id ? toId(raw.parent_id) : null,
    replies: toArray<any>(raw?.replies).map(normalizeComment),
    reply_to_user: raw?.reply_to_user ? normalizeUser(raw.reply_to_user) : null,
    like_count: toNumber(raw?.like_count),
    is_liked: Boolean(raw?.is_liked),
    attachments: toArray<any>(raw?.attachments).map(normalizeAttachment),
    created_at: raw?.created_at ?? '',
  }
}

function normalizeNotification(raw: any): Notification {
  return {
    id: toId(raw?.id),
    type: raw?.type ?? 'system',
    actor: raw?.actor ? normalizeUser(raw.actor) : null,
    post_id: raw?.post_id ? toId(raw.post_id) : null,
    comment_id: raw?.comment_id ? toId(raw.comment_id) : null,
    message: raw?.message ?? '',
    is_read: Boolean(raw?.is_read ?? raw?.read_at),
    created_at: raw?.created_at ?? '',
  }
}

function normalizeDriveNode(raw: any): DriveNode {
  return {
    id: toId(raw?.id),
    owner_id: raw?.owner_id ? toId(raw.owner_id) : raw?.user_id ? toId(raw.user_id) : undefined,
    parent_id: raw?.parent_id ? toId(raw.parent_id) : null,
    name: raw?.name ?? '',
    is_folder: Boolean(raw?.is_folder ?? raw?.kind === 'folder'),
    object_id: raw?.object_id ? toId(raw.object_id) : null,
    size: toNumber(raw?.size ?? raw?.size_bytes),
    mime_type: raw?.mime_type ?? '',
    children: toArray<any>(raw?.children).map(normalizeDriveNode),
    is_trashed: Boolean(raw?.is_trashed),
    is_system: Boolean(raw?.is_system),
    trashed_at: raw?.trashed_at ?? null,
    created_at: raw?.created_at ?? '',
    updated_at: raw?.updated_at ?? '',
  }
}

function normalizeShareLink(raw: any): ShareLink {
  return {
    id: toId(raw?.id),
    node_id: raw?.node_id || raw?.drive_node_id ? toId(raw?.node_id ?? raw?.drive_node_id) : null,
    node: raw?.node ? normalizeDriveNode(raw.node) : null,
    token: raw?.token ?? '',
    password: raw?.password ?? null,
    expires_at: raw?.expires_at ?? null,
    download_count: toNumber(raw?.download_count),
    max_downloads: raw?.max_downloads == null ? null : toNumber(raw.max_downloads),
    created_at: raw?.created_at ?? '',
    has_password: Boolean(raw?.has_password),
    node_deleted: Boolean(raw?.node_deleted),
  }
}

function normalizeMembershipPlan(raw: any): MembershipPlan {
  const storageLimit = toNumber(raw?.storage_limit ?? raw?.storage_quota_bytes)
  const uploadLimit = toNumber(raw?.upload_limit ?? raw?.upload_limit_bytes)
  const features = [
    tStatic('wallet.storageFeature', { size: Math.max(storageLimit / 1024 / 1024 / 1024, 0).toFixed(0) }),
    tStatic('wallet.uploadFeature', { size: Math.max(uploadLimit / 1024 / 1024, 0).toFixed(0) }),
  ]
  return {
    id: toId(raw?.id),
    name: raw?.name ?? '',
    description: raw?.description ?? raw?.slug ?? '',
    price: centsToAmount(raw?.price ?? raw?.price_cents),
    duration_days: toNumber(raw?.duration_days),
    storage_limit: storageLimit,
    upload_limit: uploadLimit,
    features,
  }
}

function normalizeAdminMembershipPlan(raw: any): import('../types').AdminMembershipPlan {
  return {
    id: toId(raw?.id),
    name: raw?.name ?? '',
    slug: raw?.slug ?? '',
    price_cents: toNumber(raw?.price_cents),
    duration_days: toNumber(raw?.duration_days),
    storage_policy_id: raw?.storage_policy_id ? toId(raw.storage_policy_id) : null,
    storage_quota_bytes: toNumber(raw?.storage_quota_bytes),
    upload_limit_bytes: toNumber(raw?.upload_limit_bytes),
    is_active: Boolean(raw?.is_active),
    sort_order: toNumber(raw?.sort_order),
  }
}

function normalizeWalletLedger(raw: any): WalletLedger {
  const amount = centsToAmount(raw?.amount ?? raw?.amount_cents)
  return {
    id: toId(raw?.id),
    user_id: toId(raw?.user_id),
    amount,
    balance_after: centsToAmount(raw?.balance_after),
    type: amount >= 0 ? 'credit' : 'debit',
    description: raw?.description ?? raw?.note ?? raw?.type ?? '',
    created_at: raw?.created_at ?? '',
  }
}

function normalizeUserMembership(raw: any): import('../types').UserMembership {
  const duration = toNumber(raw?.duration_days)
  const consumed = toNumber(raw?.consumed_days)
  const remaining = toNumber(raw?.remaining_days, Math.max(duration - consumed, 0))
  return {
    id: toId(raw?.id),
    user_id: toId(raw?.user_id),
    plan_id: toId(raw?.plan_id),
    plan_name: raw?.plan_name ?? '',
    plan_slug: raw?.plan_slug ?? '',
    plan_storage_bytes: toNumber(raw?.plan_storage_bytes),
    plan_upload_limit_bytes: toNumber(raw?.plan_upload_limit_bytes),
    duration_days: duration,
    consumed_days: consumed,
    remaining_days: remaining,
    is_active: raw?.is_active != null ? Boolean(raw.is_active) : remaining > 0,
    source_type: raw?.source_type ?? '',
    source_id: raw?.source_id ?? '',
    started_at: raw?.started_at ?? '',
    ends_at: raw?.ends_at ?? '',
    created_at: raw?.created_at ?? '',
  }
}

function normalizeRedeemBatch(raw: any): RedeemBatch {
  return {
    id: toId(raw?.id),
    name: raw?.name ?? '',
    amount: centsToAmount(raw?.amount ?? raw?.amount_cents),
    count: toNumber(raw?.count ?? raw?.total_count),
    used_count: toNumber(raw?.used_count ?? raw?.redeemed_count),
    expires_at: raw?.expires_at ?? null,
    created_at: raw?.created_at ?? '',
  }
}

function normalizeRedeemCode(raw: any): RedeemCode {
  return {
    id: toId(raw?.id),
    batch_id: toId(raw?.batch_id),
    code: raw?.code ?? '',
    amount: centsToAmount(raw?.amount ?? raw?.amount_cents),
    is_used: Boolean(raw?.is_used ?? raw?.redeemed_at),
    used_by: raw?.used_by ? toId(raw.used_by) : raw?.redeemed_by ? toId(raw.redeemed_by) : null,
    used_at: raw?.used_at ?? raw?.redeemed_at ?? null,
    expires_at: raw?.expires_at ?? null,
  }
}

function normalizeReport(raw: any): Report {
  return {
    id: toId(raw?.id),
    reporter: normalizeUser(raw?.reporter ?? {}),
    target_type: raw?.target_type ?? 'post',
    target_id: toId(raw?.target_id),
    reason: raw?.reason ?? '',
    status: raw?.status ?? 'pending',
    resolved_by: raw?.resolved_by ? toId(raw.resolved_by) : null,
    resolved_at: raw?.resolved_at ?? null,
    created_at: raw?.created_at ?? '',
    target_post_id: raw?.target_post_id ? toId(raw.target_post_id) : null,
    target_username: raw?.target_username ?? null,
    target_deleted: Boolean(raw?.target_deleted),
  }
}

function normalizeStoragePolicy(raw: any): StoragePolicy {
  const allowedMimeTypes = raw?.allowed_mime_types ?? '*'
  const allowedTypes = Array.isArray(raw?.allowed_types)
    ? raw.allowed_types
    : typeof allowedMimeTypes === 'string' && allowedMimeTypes !== '*'
      ? allowedMimeTypes.split(',').map((item: string) => item.trim()).filter(Boolean)
      : []

  return {
    id: toId(raw?.id),
    name: raw?.name ?? '',
    type: raw?.type ?? 'local',
    is_default: Boolean(raw?.is_default),
    is_enabled: Boolean(raw?.is_enabled ?? true),
    max_file_size: toNumber(raw?.max_file_size ?? raw?.max_file_size_bytes),
    allowed_types: allowedTypes,
    endpoint: raw?.endpoint ?? '',
    bucket: raw?.bucket ?? '',
    region: raw?.region ?? '',
    local_path: raw?.local_path ?? '',
    base_url: raw?.base_url ?? '',
    dir_naming_rule: raw?.dir_naming_rule ?? '{uid}/{date}',
    file_naming_rule: raw?.file_naming_rule ?? '{random}{ext}',
    is_private: Boolean(raw?.is_private ?? true),
    proxy_download: Boolean(raw?.proxy_download),
    url_expire_seconds: toNumber(raw?.url_expire_seconds, 3600),
    created_at: raw?.created_at ?? '',
    updated_at: raw?.updated_at ?? '',
  }
}

function normalizePageResult<T>(raw: any, itemNormalizer: (item: any) => T): PageResult<T> {
  return {
    items: toArray<any>(raw?.items).map(itemNormalizer),
    next_cursor: raw?.next_cursor || undefined,
    total: raw?.total ? toNumber(raw.total) : undefined,
  }
}

function normalizeAuthResponse(raw: any): AuthResponse {
  return {
    access_token: raw?.access_token ?? '',
    refresh_token: raw?.refresh_token ?? '',
    user: normalizeUser(raw?.user ?? {}),
  }
}

function toStoragePolicyPayload(data: Partial<CreateStoragePolicyReq>) {
  return {
    name: data.name ?? '',
    type: data.type ?? 'local',
    is_enabled: data.is_enabled ?? true,
    is_default: Boolean(data.is_default),
    endpoint: data.endpoint ?? '',
    bucket: data.bucket ?? '',
    region: data.region ?? '',
    access_key: data.access_key ?? '',
    secret_key: data.secret_key ?? '',
    local_path: data.local_path ?? '',
    dir_naming_rule: data.dir_naming_rule || '{uid}/{date}',
    file_naming_rule: data.file_naming_rule || '{random}{ext}',
    max_file_size_bytes: toNumber(data.max_file_size),
    allowed_mime_types: (data.allowed_types ?? []).length > 0 ? data.allowed_types!.join(', ') : '*',
    is_private: data.is_private ?? true,
    proxy_download: data.proxy_download ?? false,
    base_url: data.base_url ?? '',
    url_expire_seconds: toNumber(data.url_expire_seconds, 3600),
  }
}

export const login = async (data: LoginReq) =>
  normalizeAuthResponse(await apiFetch<any>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }))

export type RegisterResult =
  | { pending_verification: true; email: string }
  | (AuthResponse & { pending_verification?: false })

export const register = async (data: RegisterReq): Promise<RegisterResult> => {
  const raw = await apiFetch<any>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) })
  if (raw?.pending_verification) {
    return { pending_verification: true, email: raw.email ?? data.email }
  }
  return { ...normalizeAuthResponse(raw), pending_verification: false }
}

export const logout = () =>
  apiFetch<void>('/api/auth/logout', { method: 'POST' })

export const forgotPassword = (email: string) =>
  apiFetch<{ sent: boolean }>('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })

export const resetPassword = (token: string, new_password: string) =>
  apiFetch<{ reset: boolean }>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, new_password }),
  })

export const verifyEmail = async (token: string) => {
  const raw = await apiFetch<any>('/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
  return {
    verified: Boolean(raw?.verified),
    authResponse: raw?.access_token ? normalizeAuthResponse(raw) : null,
  }
}

export const resendVerification = (email: string) =>
  apiFetch<{ sent: boolean }>('/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })

export const sendVerificationEmail = () =>
  apiFetch<{ sent: boolean }>('/api/auth/send-verification', { method: 'POST' })

export interface MentionUser {
  id: string
  username: string
  display_name: string
  avatar_url?: string
  avatar_object_id?: string | null
  is_banned: boolean
}

export const mentionSearch = async (q: string): Promise<MentionUser[]> => {
  if (!q.trim()) return []
  const data = await apiFetch<{ users: any[] }>(`/api/users/mention?q=${encodeURIComponent(q)}`)
  return (data.users ?? []).map((u: any) => ({
    id: u.id ?? '',
    username: u.username ?? '',
    display_name: u.display_name ?? u.username ?? '',
    avatar_url: u.avatar_url || u.avatar_data_url || undefined,
    avatar_object_id: u.avatar_object_id ?? null,
    is_banned: Boolean(u.is_banned),
  }))
}

export const refreshAuth = () => refreshTokens()

export const getMe = async () =>
  normalizeUser(await apiFetch<any>('/api/me'))

export const updateProfile = async (data: UpdateProfileReq) =>
  normalizeUser(await apiFetch<any>('/api/me', {
    method: 'PATCH',
    body: JSON.stringify({
      display_name: data.display_name,
      bio: data.bio,
      ...(data.avatar_object_id !== undefined ? { avatar_object_id: data.avatar_object_id } : {}),
      ...(data.avatar_data_url !== undefined ? { avatar_data_url: data.avatar_data_url } : {}),
    }),
  }))

export const changePassword = (data: ChangePasswordReq) =>
  apiFetch<void>('/api/auth/password', { method: 'POST', body: JSON.stringify(data) })

export const getPublicFeed = async (cursor?: string, limit = 20) =>
  normalizePageResult(await apiFetch<any>(`/api/feed?type=public&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), normalizePost)

export const getFeed = async (cursor?: string, limit = 20) =>
  normalizePageResult(await apiFetch<any>(`/api/feed?type=following&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), normalizePost)

export const getTrending = async () => {
  const raw = await apiFetch<any>('/api/trending')
  return { items: toArray<any>(raw?.items).map(normalizePost) }
}

export const searchPosts = async (q: string, cursor?: string) =>
  normalizePageResult(await apiFetch<any>(`/api/search?q=${encodeURIComponent(q)}&type=posts${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), normalizePost)

export const searchUsers = async (q: string, cursor?: string) =>
  normalizePageResult(await apiFetch<any>(`/api/search?q=${encodeURIComponent(q)}&type=users${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), normalizeUser)

export const getTopicFeed = async (slug: string, cursor?: string) =>
  normalizePageResult(await apiFetch<any>(`/api/topics/${slug}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`), normalizePost)

export const getTopicInfo = async (slug: string): Promise<Topic> =>
  normalizeTopic(await apiFetch<any>(`/api/topics/${encodeURIComponent(slug)}/info`))

export const followTopic = (slug: string) =>
  apiFetch<void>(`/api/topics/${encodeURIComponent(slug)}/follow`, { method: 'POST' })

export const unfollowTopic = (slug: string) =>
  apiFetch<void>(`/api/topics/${encodeURIComponent(slug)}/follow`, { method: 'DELETE' })

export const getSearchSuggest = async (q: string): Promise<import('../types').SearchSuggest> => {
  const raw = await apiFetch<any>(`/api/search/suggest?q=${encodeURIComponent(q)}`)
  return {
    topics: toArray<any>(raw?.topics).map(normalizeTopic),
    users: toArray<any>(raw?.users).map(normalizeUser),
  }
}

export const getHotSearches = async (): Promise<import('../types').HotSearch[]> => {
  const raw = await apiFetch<any>('/api/hot-searches')
  return toArray<any>(raw?.items).map(normalizeHotSearch)
}

export const getUserProfile = async (username: string) => {
  const raw = await apiFetch<any>(`/api/users/${username}`)
  return normalizeUser(raw?.user ?? raw)
}

export const getUserProfileDetails = async (username: string): Promise<UserProfileData> => {
  const raw = await apiFetch<any>(`/api/users/${username}`)
  return {
    user: normalizeUser(raw?.user ?? {}),
    posts: normalizePageResult(raw?.posts ?? { items: [] }, normalizePost),
  }
}

export const follow = (userId: string) =>
  apiFetch<void>(`/api/follows/${userId}`, { method: 'POST' })

export const unfollow = (userId: string) =>
  apiFetch<void>(`/api/follows/${userId}`, { method: 'DELETE' })

export const listMyFollowers = async (cursor?: string, limit = 30): Promise<PageResult<User>> =>
  normalizePageResult(
    await apiFetch<any>(`/api/me/followers?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    normalizeUser,
  )

export const listMyFollowing = async (cursor?: string, limit = 30): Promise<PageResult<User>> =>
  normalizePageResult(
    await apiFetch<any>(`/api/me/following?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    normalizeUser,
  )

export const createPost = async (data: CreatePostReq) =>
  normalizePost(await apiFetch<any>('/api/posts', { method: 'POST', body: JSON.stringify(data) }))

export interface UpdatePostReq {
  content: string
  visibility?: Post['visibility']
  attachment_ids?: string[]
}

export const updatePost = async (id: string, data: UpdatePostReq) =>
  normalizePost(await apiFetch<any>(`/api/posts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }))

export const getPost = async (id: string) =>
  normalizePost(await apiFetch<any>(`/api/posts/${id}`))

export const getPostRevisions = async (id: string) => {
  const raw = await apiFetch<any>(`/api/posts/${id}/revisions`)
  return toArray<any>(raw?.items).map(normalizePostRevision)
}

export const deletePost = (id: string) =>
  apiFetch<void>(`/api/posts/${id}`, { method: 'DELETE' })

export const likePost = (id: string) =>
  apiFetch<void>(`/api/posts/${id}/reactions`, { method: 'POST' })

export const unlikePost = (id: string) =>
  apiFetch<void>(`/api/posts/${id}/reactions`, { method: 'DELETE' })

export const repost = async (id: string, data: RepostReq) =>
  normalizePost(await apiFetch<any>(`/api/posts/${id}/repost`, {
    method: 'POST',
    body: JSON.stringify(data),
  }))

export const getComments = async (
  postId: string,
  cursor?: string,
  sortBy: 'created_at' | 'like_count' = 'created_at',
  order: 'asc' | 'desc' = 'desc',
) =>
  normalizePageResult(
    await apiFetch<any>(
      `/api/posts/${postId}/comments?sort=${sortBy}&order=${order}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
    normalizeComment,
  )

export const addComment = async (postId: string, data: CreateCommentReq) =>
  normalizeComment(await apiFetch<any>(`/api/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify(data) }))

export const deleteComment = (id: string) =>
  apiFetch<void>(`/api/comments/${id}`, { method: 'DELETE' })

export const likeComment = (id: string) =>
  apiFetch<void>(`/api/comments/${id}/reactions`, { method: 'POST' })

export const unlikeComment = (id: string) =>
  apiFetch<void>(`/api/comments/${id}/reactions`, { method: 'DELETE' })

export const transferAttachmentToDrive = (attachmentId: string) =>
  apiFetch<void>(`/api/drive/transfer/attachments/${attachmentId}`, { method: 'POST' })

export const createReport = (data: CreateReportReq) =>
  apiFetch<void>('/api/reports', { method: 'POST', body: JSON.stringify(data) })

export const getNotifications = async (cursor?: string) =>
  normalizePageResult(await apiFetch<any>(`/api/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`), normalizeNotification)

export const markRead = (id: string) =>
  apiFetch<void>(`/api/notifications/${id}/read`, { method: 'POST' })

export const markAllRead = () =>
  apiFetch<void>('/api/notifications/read-all', { method: 'POST' })

export const getUnreadCount = async () => {
  const raw = await apiFetch<any>('/api/notifications/unread-count')
  return { count: toNumber(raw?.count ?? raw?.unread_count) }
}

export const getDriveTree = async () => {
  const raw = await apiFetch<any>('/api/drive/tree')
  return { items: toArray<any>(raw?.items).map(normalizeDriveNode) }
}

export const createFolder = async (data: CreateFolderReq) =>
  normalizeDriveNode(await apiFetch<any>('/api/drive/folders', { method: 'POST', body: JSON.stringify(data) }))

export const updateNode = (id: string, data: UpdateNodeReq) =>
  apiFetch<void>(`/api/drive/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

// Rename a node. Sends only the name field so the server doesn't move it.
export const renameNode = (id: string, name: string) =>
  apiFetch<void>(`/api/drive/nodes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })

// Move a node. Pass null to move to root.
export const moveNode = (id: string, parentId: string | null) =>
  apiFetch<void>(`/api/drive/nodes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ parent_id: parentId }),
  })

// Copy a node into a new parent (null = root). Folders are copied recursively.
export const copyNode = (id: string, parentId: string | null) =>
  apiFetch<unknown>(`/api/drive/nodes/${id}/copy`, {
    method: 'POST',
    body: JSON.stringify({ parent_id: parentId }),
  })

export const deleteNode = (id: string) =>
  apiFetch<void>(`/api/drive/nodes/${id}`, { method: 'DELETE' })

export const restoreNode = (id: string) =>
  apiFetch<void>(`/api/drive/nodes/${id}/restore`, { method: 'POST' })

export const getTrash = async () => {
  const raw = await apiFetch<any>('/api/drive/trash')
  return { items: toArray<any>(raw?.items).map(normalizeDriveNode) }
}

export const uploadFile = async (parentId: string | null, file: File) => {
  const form = new FormData()
  form.append('file', file)
  if (parentId) form.append('parent_id', parentId)
  const raw = await apiFetch<any>('/api/uploads', { method: 'POST', body: form })
  return { object: raw?.object, node: normalizeDriveNode(raw?.node) }
}

export interface UploadProgressEvent {
  loaded: number
  total: number
  percent: number
}

export interface UploadXHROptions {
  onProgress?: (e: UploadProgressEvent) => void
  signal?: AbortSignal
  // purpose hints the backend to route this upload through a special path.
  // "post_image" sends the file into the user's system "帖子图片" folder
  // (no quota consumed, parent_id is ignored). Omit for normal uploads.
  purpose?: 'post_image'
}

// uploadFileXHR uses XMLHttpRequest so we get real upload progress events
// (the fetch API does not expose request body progress). It honors the same
// auth/refresh flow as apiFetch by reusing getAccessToken().
export const uploadFileXHR = (
  parentId: string | null,
  file: File,
  opts: UploadXHROptions = {},
): Promise<{ object: unknown; node: DriveNode }> => {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    if (parentId) form.append('parent_id', parentId)
    if (opts.purpose) form.append('purpose', opts.purpose)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/uploads', true)

    const token = getAccessToken()
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }

    if (opts.onProgress) {
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return
        opts.onProgress!({
          loaded: ev.loaded,
          total: ev.total,
          percent: ev.total > 0 ? ev.loaded / ev.total : 0,
        })
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText || '{}')
          resolve({ object: data?.object, node: normalizeDriveNode(data?.node) })
        } catch (err) {
          reject(new Error('invalid response: ' + (err as Error).message))
        }
        return
      }
      let message = `HTTP ${xhr.status}`
      try {
        const body = JSON.parse(xhr.responseText || '{}')
        message = body?.error?.message || body?.message || message
      } catch {
        /* ignore parse error */
      }
      reject(new Error(message))
    }

    xhr.onerror = () => reject(new Error('network error'))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))

    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort()
        return
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(form)
  })
}

export const downloadFile = (id: string): string => `/api/files/${id}/download`
export const previewFile = (id: string): string => `/api/files/${id}/preview`

// Auth-aware download: fetches the file with the bearer token, then triggers
// a browser download via a blob URL. Use this whenever you need to download a
// file from an authenticated endpoint (the plain `<a href>` approach won't
// send the Authorization header).
export async function downloadObjectFile(objectId: string, filename: string) {
  const token = getAccessToken()
  const res = await fetch(`/api/files/${objectId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    throw new Error(tStatic('common.downloadFailedHTTP', { status: res.status }))
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// getPreviewUrl returns a URL for the preview endpoint that embeds the access
// token as a query parameter. This lets <img src="..."> load authenticated
// assets without a fetch+blob-URL dance, which avoids all blob revocation issues.
// The token is short-lived (access tokens expire quickly) and the preview
// endpoint is media-only, so URL-visible tokens are an acceptable trade-off.
export function getPreviewUrl(objectId: string): string {
  const token = getAccessToken()
  const base = `/api/files/${objectId}/preview`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

// Auth-aware preview: fetches the file with the bearer token and returns a
// blob URL suitable for use in <img>/<video>/<iframe> src attributes. Caller
// is responsible for revoking the URL via URL.revokeObjectURL when done.
// Prefer getPreviewUrl() for <img> tags to avoid blob lifecycle issues.
export async function fetchPreviewBlobUrl(objectId: string): Promise<string> {
  const token = getAccessToken()
  const res = await fetch(`/api/files/${objectId}/preview`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    throw new Error(tStatic('common.previewFailedHTTP', { status: res.status }))
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

export const createShare = async (data: CreateShareReq) => {
  const payload: Record<string, unknown> = {
    drive_node_id: data.node_id,
  }
  if (data.password) payload.password = data.password
  if (data.expires_at) {
    // datetime-local inputs return "YYYY-MM-DDTHH:MM" (no timezone). The
    // backend parses RFC3339, so convert via Date#toISOString.
    const parsed = new Date(data.expires_at)
    if (!Number.isNaN(parsed.getTime())) {
      payload.expires_at = parsed.toISOString()
    }
  }
  return normalizeShareLink(await apiFetch<any>('/api/shares', {
    method: 'POST',
    body: JSON.stringify(payload),
  }))
}

export const listShares = async () => {
  const raw = await apiFetch<any>('/api/shares')
  return toArray<any>(raw?.items ?? raw).map(normalizeShareLink)
}

export const revokeShare = (id: string) =>
  apiFetch<void>(`/api/shares/${id}`, { method: 'DELETE' })

// The public-share endpoint returns {share, node, node_deleted, has_password}.
// We flatten it into a single ShareLink so callers can do `share.node`,
// `share.node_deleted`, etc. without an extra layer of indirection.
function normalizePublicShareResponse(raw: any): ShareLink {
  const merged = {
    ...(raw?.share ?? {}),
    node: raw?.node ?? null,
    node_deleted: raw?.node_deleted,
    has_password: raw?.has_password,
  }
  return normalizeShareLink(merged)
}

export const getPublicShare = async (token: string) =>
  normalizePublicShareResponse(await apiFetch<any>(`/api/shares/public/${token}`))

export const verifySharePassword = async (token: string, data: VerifySharePasswordReq) =>
  normalizePublicShareResponse(await apiFetch<any>(`/api/shares/public/${token}/verify`, { method: 'POST', body: JSON.stringify(data) }))

export const purgeNode = (id: string) =>
  apiFetch<void>(`/api/drive/nodes/${id}/purge`, { method: 'POST' })

export const emptyTrash = () =>
  apiFetch<void>(`/api/drive/trash/empty`, { method: 'POST' })

// ─── Admin: file management ────────────────────────────────────────────────
export interface AdminFileItem {
  id: string
  owner_id: string
  policy_id: string
  object_key: string
  sha256: string
  mime_type: string
  size_bytes: number
  status: string
  preview_status: string
  created_at: string
  owner_username: string
  owner_display_name: string
  policy_name: string
  drive_ref_count: number
  post_ref_count: number
}

export interface AdminFileListParams {
  query?: string
  mime_prefix?: string
  status?: string
  cursor?: string
  limit?: number
}

export const adminListFiles = async (params: AdminFileListParams = {}) => {
  const qs = new URLSearchParams()
  if (params.query) qs.set('query', params.query)
  if (params.mime_prefix) qs.set('mime_prefix', params.mime_prefix)
  if (params.status) qs.set('status', params.status)
  if (params.cursor) qs.set('cursor', params.cursor)
  if (params.limit) qs.set('limit', String(params.limit))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiFetch<{ items: AdminFileItem[]; next_cursor?: string }>(`/api/admin/files${suffix}`)
}

export const adminDeleteFile = (id: string) =>
  apiFetch<void>(`/api/admin/files/${id}`, { method: 'DELETE' })

export const downloadPublicShare = (token: string): string =>
  `/api/shares/public/${token}/download`

export const getWallet = async () => {
  const raw = await apiFetch<any>('/api/billing/wallet')
  return {
    balance: centsToAmount(raw?.balance ?? raw?.balance_cents),
    ledger: toArray<any>(raw?.ledger).map(normalizeWalletLedger),
    memberships: toArray<any>(raw?.memberships).map(normalizeUserMembership),
  }
}

export const getPlans = async () => {
  const raw = await apiFetch<any>('/api/billing/plans')
  return toArray<any>(raw?.items ?? raw).map(normalizeMembershipPlan)
}

export const purchaseMembership = (data: PurchaseMembershipReq) =>
  apiFetch<void>('/api/billing/memberships/purchase', { method: 'POST', body: JSON.stringify(data) })

export const redeemCode = (data: RedeemCodeReq) =>
  apiFetch<void>('/api/billing/redeem', { method: 'POST', body: JSON.stringify(data) })

// ─── Stripe ────────────────────────────────────────────────────────────────
import type { StripeCheckoutReq, StripeCheckoutResp, StripeConfig, StripeOrder } from '../types'

export const getStripeConfig = () =>
  apiFetch<StripeConfig>('/api/billing/stripe/config')

export const createStripeCheckout = (data: StripeCheckoutReq) =>
  apiFetch<StripeCheckoutResp>('/api/billing/stripe/checkout', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const getStripeOrder = (sessionId: string) =>
  apiFetch<StripeOrder>(`/api/billing/stripe/orders/${encodeURIComponent(sessionId)}`)

export const getAdminStripeOrders = (status?: string, cursor?: string) => {
  const qs = new URLSearchParams()
  if (status) qs.set('status', status)
  if (cursor) qs.set('cursor', cursor)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiFetch<{ items: StripeOrder[]; next_cursor?: string }>(`/api/admin/stripe/orders${suffix}`)
}

export const getDashboard = () =>
  apiFetch<AdminDashboard>('/api/admin/dashboard')

export const getUsers = async (cursor?: string, q = '') =>
  normalizePageResult(await apiFetch<any>(`/api/admin/users?query=${encodeURIComponent(q)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), normalizeUser)

export const setBan = (userId: string, banned: boolean) =>
  apiFetch<void>(`/api/admin/users/${userId}/ban`, { method: 'POST', body: JSON.stringify({ banned }) })

export const setMute = (userId: string, muted: boolean, mutedUntil?: string | null) =>
  apiFetch<void>(`/api/admin/users/${userId}/mute`, { method: 'POST', body: JSON.stringify({ muted, muted_until: mutedUntil ?? null }) })

export const getPosts = async (status?: string, cursor?: string) =>
  normalizePageResult(await apiFetch<any>(`/api/admin/posts?${status ? `status=${encodeURIComponent(status)}&` : ''}${cursor ? `cursor=${encodeURIComponent(cursor)}` : ''}`), normalizePost)

export const setPostStatus = (postId: string, status: string) =>
  apiFetch<void>(`/api/admin/posts/${postId}/status`, { method: 'POST', body: JSON.stringify({ status }) })

export const getReports = async (status?: string, cursor?: string) =>
  normalizePageResult(await apiFetch<any>(`/api/admin/reports?${status ? `status=${encodeURIComponent(status)}&` : ''}${cursor ? `cursor=${encodeURIComponent(cursor)}` : ''}`), normalizeReport)

export const resolveReport = (id: string, resolution: string) =>
  apiFetch<void>(`/api/admin/reports/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) })

export const getSettings = () =>
  apiFetch<Record<string, string>>('/api/admin/settings')

export const upsertSetting = (data: UpsertSettingReq) =>
  apiFetch<void>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(data) })

// Admin: full membership plan CRUD (returns ALL plans, including inactive).
export const getAdminMembershipPlans = async () => {
  const raw = await apiFetch<any>('/api/admin/membership-plans')
  return toArray<any>(raw?.items).map(normalizeAdminMembershipPlan)
}

export const createAdminMembershipPlan = async (data: import('../types').UpsertAdminMembershipPlanReq) =>
  normalizeAdminMembershipPlan(await apiFetch<any>('/api/admin/membership-plans', {
    method: 'POST',
    body: JSON.stringify(data),
  }))

export const updateAdminMembershipPlan = async (id: string, data: import('../types').UpsertAdminMembershipPlanReq) =>
  normalizeAdminMembershipPlan(await apiFetch<any>(`/api/admin/membership-plans/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }))

export const deleteAdminMembershipPlan = (id: string) =>
  apiFetch<void>(`/api/admin/membership-plans/${id}`, { method: 'DELETE' })

export const createRedeemBatch = async (data: CreateRedeemBatchReq) => {
  const raw = await apiFetch<any>('/api/admin/redeem-batches', {
    method: 'POST',
    body: JSON.stringify({
      name: data.name,
      amount_cents: Math.round(data.amount * 100),
      count: data.count,
    }),
  })

  return {
    batch: normalizeRedeemBatch(raw?.batch ?? raw),
    codes: toArray<any>(raw?.codes).map(normalizeRedeemCode),
  }
}

export const getRedeemBatches = async () => {
  const raw = await apiFetch<any>('/api/admin/redeem-batches')
  return toArray<any>(raw?.items ?? raw).map(normalizeRedeemBatch)
}

export const getStoragePolicies = async () => {
  const raw = await apiFetch<any>('/api/admin/storage-policies')
  return toArray<any>(raw?.items).map(normalizeStoragePolicy)
}

export const createStoragePolicy = async (data: CreateStoragePolicyReq) =>
  normalizeStoragePolicy(await apiFetch<any>('/api/admin/storage-policies', {
    method: 'POST',
    body: JSON.stringify(toStoragePolicyPayload(data)),
  }))

export const updateStoragePolicy = async (id: string, data: Partial<CreateStoragePolicyReq>) =>
  normalizeStoragePolicy(await apiFetch<any>(`/api/admin/storage-policies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(toStoragePolicyPayload(data)),
  }))

export const deleteStoragePolicy = (id: string) =>
  apiFetch<void>(`/api/admin/storage-policies/${id}`, { method: 'DELETE' })

export const testStoragePolicy = (id: string) =>
  apiFetch<{ success: boolean; message: string }>(`/api/admin/storage-policies/${id}/test`, { method: 'POST' })

export const creditWallet = (data: CreditWalletReq) =>
  apiFetch<void>('/api/admin/wallet/credit', {
    method: 'POST',
    body: JSON.stringify({
      user_id: data.user_id,
      amount_cents: Math.round(data.amount * 100),
      note: data.description,
    }),
  })

export interface SetupStatus {
  setup_complete: boolean
  admin_path: string
  site_name: string
}

export interface SetupInitializeReq {
  site_name: string
  site_description: string
  admin_path: string
  admin_email: string
  admin_username: string
  admin_password: string
  storage_type: 'local' | 's3'
  local_path?: string
  s3_endpoint?: string
  s3_bucket?: string
  s3_region?: string
  s3_access_key?: string
  s3_secret_key?: string
}

export const getSetupStatus = async (): Promise<SetupStatus> => {
  const res = await fetch('/api/setup/status')
  return res.json()
}

export const setupInitialize = async (data: SetupInitializeReq): Promise<{ success: boolean; message: string }> => {
  const res = await fetch('/api/setup/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(body.error?.message || `HTTP ${res.status}`)
  }
  return res.json()
}

// ────────────────────────────────────────────────────────────
// Admin: hot search board
// ────────────────────────────────────────────────────────────

export interface AdminUpsertHotSearchReq {
  keyword: string
  link_type: 'topic' | 'search' | 'url'
  link_value: string
  pinned_rank?: number | null
  hidden?: boolean
  score?: number
}

export const adminListHotSearches = async (): Promise<import('../types').HotSearch[]> => {
  const raw = await apiFetch<any>('/api/admin/hot-searches')
  return toArray<any>(raw?.items).map(normalizeHotSearch)
}

export const adminCreateHotSearch = async (data: AdminUpsertHotSearchReq) =>
  normalizeHotSearch(
    await apiFetch<any>('/api/admin/hot-searches', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  )

export const adminUpdateHotSearch = async (id: string, data: AdminUpsertHotSearchReq) =>
  normalizeHotSearch(
    await apiFetch<any>(`/api/admin/hot-searches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  )

export const adminDeleteHotSearch = (id: string) =>
  apiFetch<void>(`/api/admin/hot-searches/${id}`, { method: 'DELETE' })

export const adminRecomputeHotSearches = () =>
  apiFetch<void>('/api/admin/hot-searches/recompute', { method: 'POST' })

// ── Admin post hard-delete ────────────────────────────────────────────
export const adminHardDeletePost = (postId: string) =>
  apiFetch<void>(`/api/admin/posts/${postId}/hard`, { method: 'DELETE' })

// ── Admin topic management ────────────────────────────────────────────
export const adminListTopics = (cursor?: string) =>
  apiFetch<{ items: Topic[]; next_cursor?: string }>(
    `/api/admin/topics${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  ).then((raw) => ({
    items: toArray<any>(raw?.items).map(normalizeTopic),
    next_cursor: raw?.next_cursor,
  }))

export const adminBanTopic = (topicId: string, banned: boolean) =>
  apiFetch<void>(`/api/admin/topics/${topicId}/ban`, {
    method: 'POST',
    body: JSON.stringify({ banned }),
  })

export const adminDeleteTopic = (topicId: string) =>
  apiFetch<{ deleted: boolean; posts_deleted: number }>(`/api/admin/topics/${topicId}`, {
    method: 'DELETE',
  })
