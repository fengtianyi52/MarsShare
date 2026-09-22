import clsx from 'clsx'
import { Crown } from './icons'
import { useT } from '../lib/i18n'
import type { User } from '../types'

interface Props {
  user?: Pick<User, 'is_vip' | 'membership_ends_at'> | null
  // sm = inline next to a name; md = larger pill
  size?: 'sm' | 'md'
  className?: string
}

// Small "VIP" badge rendered next to a user's name when they have an active membership.
// Returns null for non-members so callers can drop it in unconditionally.
export default function VipBadge({ user, size = 'sm', className }: Props) {
  const t = useT()
  if (!user || !user.is_vip) return null
  const title = user.membership_ends_at
    ? t('user.vipExpireTitle', { date: new Date(user.membership_ends_at).toLocaleDateString() })
    : t('user.vipTitle')

  if (size === 'md') {
    return (
      <span
        title={title}
        aria-label={t('user.vipTitle')}
        className={clsx(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          'bg-primary text-primary-on shadow-elevation-1',
          className,
        )}
      >
        <Crown className="h-3 w-3" aria-hidden />
        VIP
      </span>
    )
  }

  return (
    <span
      title={title}
      aria-label={t('user.vipTitle')}
      className={clsx(
        'inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-bold leading-none align-middle',
        'bg-primary text-primary-on',
        className,
      )}
    >
      <Crown className="h-2.5 w-2.5" aria-hidden />
      VIP
    </span>
  )
}
