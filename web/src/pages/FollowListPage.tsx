import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { listMyFollowers, listMyFollowing } from '../lib/api'
import AppShell from '../components/layout/AppShell'
import UserAvatar from '../components/UserAvatar'
import VipBadge from '../components/VipBadge'
import BannedBadge from '../components/BannedBadge'
import FollowButton from '../components/FollowButton'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { Users, UserPlus } from '../components/icons'

interface Props {
  variant: 'followers' | 'following'
}

export default function FollowListPage({ variant }: Props) {
  const t = useT()
  const { user: me } = useAuth()
  const sentinelRef = useRef<HTMLDivElement>(null)

  const isFollowers = variant === 'followers'
  const title = isFollowers ? t('follow.myFollowers') : t('follow.myFollowing')
  const emptyTitle = isFollowers ? t('follow.noFollowers') : t('follow.noFollowing')

  const query = useInfiniteQuery({
    queryKey: [isFollowers ? 'myFollowers' : 'myFollowing'],
    queryFn: ({ pageParam }) =>
      isFollowers ? listMyFollowers(pageParam) : listMyFollowing(pageParam),
    getNextPageParam: (last) => last.next_cursor || undefined,
    initialPageParam: undefined as string | undefined,
  })

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          query.fetchNextPage()
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [query])

  const users = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  )

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-4">
          {isFollowers ? (
            <Users className="h-5 w-5 text-primary" aria-hidden />
          ) : (
            <UserPlus className="h-5 w-5 text-primary" aria-hidden />
          )}
          {title}
        </h1>

        {query.isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : users.length === 0 ? (
          <EmptyState
            icon={isFollowers ? <Users className="h-14 w-14" /> : <UserPlus className="h-14 w-14" />}
            title={emptyTitle}
          />
        ) : (
          <div className="space-y-2">
            {users.map((u) => {
              const isSelf = me?.id === u.id
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-3 bg-surface rounded p-3 shadow-elevation-1"
                >
                  <Link to={`/u/${u.username}`} className="flex items-center gap-3 flex-1 min-w-0">
                    <UserAvatar
                      src={u.avatar_url}
                      dataUrl={u.avatar_data_url}
                      name={u.display_name || u.username}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="inline-flex items-center gap-1 text-sm font-medium text-surface-on truncate">
                        {u.display_name || u.username}
                        <VipBadge user={u} />
                        <BannedBadge user={u} />
                      </p>
                      <p className="truncate text-xs text-surface-on-variant">@{u.username}</p>
                      {u.bio && (
                        <p className="mt-0.5 truncate text-xs text-surface-on-variant">{u.bio}</p>
                      )}
                    </div>
                  </Link>
                  {!isSelf && (
                    <FollowButton userId={u.id} isFollowing={Boolean(u.is_following)} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div ref={sentinelRef} className="py-4">
          {query.isFetchingNextPage && <LoadingSpinner />}
        </div>
      </div>
    </AppShell>
  )
}
