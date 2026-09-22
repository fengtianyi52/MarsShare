import { Link } from 'react-router-dom'
import type { Notification } from '../types'
import UserAvatar from './UserAvatar'
import { useT } from '../lib/i18n'
import { Heart, MessageCircle, User as UserIcon, Repeat2, Bell, type LucideIcon } from './icons'
import clsx from 'clsx'

interface Props {
  notification: Notification
  onMarkRead: (id: string) => void
}

const typeIcons: Record<string, LucideIcon> = {
  like: Heart,
  comment: MessageCircle,
  follow: UserIcon,
  repost: Repeat2,
  system: Bell,
}

const typeColors: Record<string, string> = {
  like: 'text-error',
  comment: 'text-primary',
  follow: 'text-secondary',
  repost: 'text-primary',
  system: 'text-surface-on-variant',
}

function timeAgo(dateStr: string, t: (k: any, v?: any) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('time.justNow')
  if (mins < 60) return t('time.minutesAgoShort', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('time.hoursAgoShort', { n: hrs })
  const days = Math.floor(hrs / 24)
  return t('time.daysAgoShort', { n: days })
}

// 已知的内置通知类型 — 由前端按 type 字段渲染本地化文案，
// 后端 message 字段（英/中混合）不再使用。仅 'system' 类型仍展示后端 message
// （管理员手动发送的系统通知）。
const KNOWN_TYPES = new Set(['like', 'comment', 'repost', 'follow', 'mention'])

function localizedMessage(
  n: Notification,
  t: (k: any, v?: any) => string,
): string {
  if (!KNOWN_TYPES.has(n.type)) return n.message // system / 未知类型回退到后端文案
  const name = n.actor?.display_name || ''
  const baseKey = `notifications.message.${n.type}`
  return name ? t(baseKey, { name }) : t(`${baseKey}Anon`)
}

export default function NotificationItem({ notification, onMarkRead }: Props) {
  const t = useT()
  const n = notification
  const Icon = typeIcons[n.type] || Bell
  const colorClass = typeColors[n.type] || 'text-surface-on-variant'
  const messageText = localizedMessage(n, t)

  return (
    <div
      className={clsx(
        'flex items-start gap-3 px-4 py-3 rounded cursor-pointer hover:bg-surface-variant/60 transition-colors',
        !n.is_read && 'bg-primary/5',
      )}
      onClick={() => !n.is_read && onMarkRead(n.id)}
    >
      {n.actor ? (
        <UserAvatar src={n.actor.avatar_url} name={n.actor.display_name} size="sm" />
      ) : (
        <div className={clsx('flex h-9 w-9 items-center justify-center rounded-full bg-surface-variant', colorClass)}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-surface-on inline-flex items-center gap-1.5">
          <Icon className={clsx('h-3.5 w-3.5 shrink-0', colorClass)} aria-hidden />
          <span>{messageText}</span>
        </p>
        <p className="text-xs text-surface-on-variant mt-0.5">{timeAgo(n.created_at, t)}</p>
      </div>
      {n.post_id && (
        <Link
          to={`/post/${n.post_id}`}
          className="text-xs text-primary hover:underline shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {t('notifications.view')}
        </Link>
      )}
    </div>
  )
}
