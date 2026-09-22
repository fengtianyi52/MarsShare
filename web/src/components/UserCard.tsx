import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getUserProfile } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import UserAvatar from './UserAvatar'
import VipBadge from './VipBadge'
import BannedBadge from './BannedBadge'
import FollowButton from './FollowButton'

interface Props {
  username: string
  children: React.ReactNode
}

export default function UserCard({ username, children }: Props) {
  const { user: currentUser } = useAuth()
  const t = useT()
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<'below' | 'above'>('below')
  const triggerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const { data: user, isLoading } = useQuery({
    queryKey: ['user', username],
    queryFn: () => getUserProfile(username),
    enabled: visible,
    staleTime: 60_000,
  })

  const show = useCallback(() => {
    clearTimeout(hideTimerRef.current)
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      setPosition(spaceBelow < 260 ? 'above' : 'below')
    }
    setVisible(true)
  }, [])

  const hide = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setVisible(false), 200)
  }, [])

  useEffect(() => {
    return () => clearTimeout(hideTimerRef.current)
  }, [])

  const isSelf = currentUser?.username === username

  return (
    <div
      ref={triggerRef}
      className="relative inline-block"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}

      {visible && (
        <div
          ref={cardRef}
          onMouseEnter={show}
          onMouseLeave={hide}
          className={`absolute z-50 left-0 ${position === 'below' ? 'top-full mt-2' : 'bottom-full mb-2'} bg-surface shadow-elevation-3 rounded-xl p-4 min-w-[280px] border border-outline-variant/30`}
        >
          {isLoading || !user ? (
            <div className="flex items-center gap-3 animate-pulse">
              <div className="h-12 w-12 rounded-full bg-surface-variant" />
              <div className="space-y-2 flex-1">
                <div className="h-3.5 w-24 bg-surface-variant rounded-full" />
                <div className="h-2.5 w-16 bg-surface-variant rounded-full" />
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <Link to={`/u/${user.username}`}>
                  <UserAvatar src={user.avatar_url} name={user.display_name} size="lg" />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/u/${user.username}`}
                    className="inline-flex items-center gap-1 font-semibold text-surface-on hover:text-primary text-sm truncate"
                  >
                    {user.display_name}
                    <VipBadge user={user} />
                    <BannedBadge user={user} />
                  </Link>
                  <p className="text-xs text-surface-on-variant">@{user.username}</p>
                </div>
                {!isSelf && (
                  <FollowButton userId={user.id} isFollowing={Boolean(user.is_following)} />
                )}
              </div>

              {user.bio && (
                <p className="text-sm text-surface-on-variant mt-2 line-clamp-2">
                  {user.bio}
                </p>
              )}

              <div className="flex items-center gap-4 mt-3 text-xs text-surface-on-variant">
                <span>
                  <strong className="text-surface-on">{user.following_count}</strong> {t('follow.following')}
                </span>
                <span>
                  <strong className="text-surface-on">{user.follower_count}</strong> {t('follow.followers')}
                </span>
                <span>
                  <strong className="text-surface-on">{user.post_count}</strong> {t('post.postCount')}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
