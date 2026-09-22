import { useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  getHotSearches,
  getSearchSuggest,
  searchPosts,
  searchUsers,
} from '../lib/api'
import AppShell from '../components/layout/AppShell'
import PostCard from '../components/PostCard'
import UserAvatar from '../components/UserAvatar'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import VipBadge from '../components/VipBadge'
import BannedBadge from '../components/BannedBadge'
import { useT } from '../lib/i18n'
import { Search, Flame, MessageCircle, User as UserIcon } from '../components/icons'

type Tab = 'posts' | 'users' | 'topics'

export default function SearchResultsPage() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') || '').trim()
  const tab = ((params.get('type') as Tab) || 'posts') as Tab
  const sentinelRef = useRef<HTMLDivElement>(null)

  const TABS: { key: Tab; label: string }[] = [
    { key: 'posts', label: t('search.tab.posts') },
    { key: 'users', label: t('search.tab.users') },
    { key: 'topics', label: t('search.tab.topics') },
  ]

  const setTab = (next: Tab) => {
    const updated = new URLSearchParams(params)
    updated.set('type', next)
    setParams(updated)
  }

  // ── Posts (infinite) ────────────────────────────────────
  const postsQuery = useInfiniteQuery({
    queryKey: ['searchPosts', q],
    queryFn: ({ pageParam }) => searchPosts(q, pageParam),
    getNextPageParam: (last) => last.next_cursor || undefined,
    initialPageParam: undefined as string | undefined,
    enabled: q.length > 0 && tab === 'posts',
  })

  // ── Users (infinite) ────────────────────────────────────
  const usersQuery = useInfiniteQuery({
    queryKey: ['searchUsers', q],
    queryFn: ({ pageParam }) => searchUsers(q, pageParam),
    getNextPageParam: (last) => last.next_cursor || undefined,
    initialPageParam: undefined as string | undefined,
    enabled: q.length > 0 && tab === 'users',
  })

  // ── Topics (single shot via suggest) ────────────────────
  const topicsQuery = useQuery({
    queryKey: ['searchTopics', q],
    queryFn: () => getSearchSuggest(q),
    enabled: q.length > 0 && tab === 'topics',
  })

  // ── Empty state: hot searches ───────────────────────────
  const { data: hotSearches = [] } = useQuery({
    queryKey: ['hotSearches'],
    queryFn: getHotSearches,
    enabled: q.length === 0,
  })

  // ── Infinite scroll trigger ─────────────────────────────
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        if (tab === 'posts' && postsQuery.hasNextPage && !postsQuery.isFetchingNextPage) {
          postsQuery.fetchNextPage()
        } else if (tab === 'users' && usersQuery.hasNextPage && !usersQuery.isFetchingNextPage) {
          usersQuery.fetchNextPage()
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [tab, postsQuery, usersQuery])

  const posts = useMemo(
    () => postsQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [postsQuery.data],
  )
  const users = useMemo(
    () => usersQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [usersQuery.data],
  )
  const topics = topicsQuery.data?.topics ?? []

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-4">
          <Search className="h-5 w-5 text-primary" aria-hidden />
          {q ? t('search.titleWithQuery', { query: q }) : t('search.title')}
        </h1>

        {q.length === 0 ? (
          <div className="bg-surface rounded shadow-elevation-1 p-6">
            <h2 className="inline-flex items-center gap-2 text-sm font-medium text-surface-on-variant mb-3">
              <Flame className="h-4 w-4 text-error" aria-hidden />
              {t('search.hotList')}
            </h2>
            {hotSearches.length === 0 ? (
              <p className="text-sm text-surface-on-variant">{t('search.empty.hot')}</p>
            ) : (
              <div className="space-y-1">
                {hotSearches.slice(0, 10).map((h, idx) => {
                  const to =
                    h.link_type === 'topic'
                      ? `/topics/${h.link_value}`
                      : `/search?q=${encodeURIComponent(h.link_value || h.keyword)}`
                  return (
                    <Link
                      key={h.id}
                      to={to}
                      className="flex items-center gap-3 px-3 py-2 rounded hover:bg-surface-variant"
                    >
                      <span
                        className={clsx(
                          'w-5 text-center text-xs font-bold tabular-nums',
                          idx < 3 ? 'text-error' : 'text-surface-on-variant',
                        )}
                      >
                        {idx + 1}
                      </span>
                      <span className="flex-1 truncate text-sm text-surface-on">{h.keyword}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-divider mb-4">
              {TABS.map((tabItem) => {
                const active = tabItem.key === tab
                return (
                  <button
                    key={tabItem.key}
                    type="button"
                    onClick={() => setTab(tabItem.key)}
                    className={clsx(
                      'relative px-4 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'text-primary'
                        : 'text-surface-on-variant hover:text-surface-on',
                    )}
                  >
                    {tabItem.label}
                    {active && (
                      <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary" />
                    )}
                  </button>
                )
              })}
            </div>

            {tab === 'posts' && (
              <div>
                {postsQuery.isLoading ? (
                  <LoadingSpinner className="py-12" />
                ) : posts.length === 0 ? (
                  <EmptyState
                    icon={<MessageCircle className="h-14 w-14" />}
                    title={t('search.empty.noPosts')}
                  />
                ) : (
                  <div className="space-y-4">
                    {posts.map((post) => (
                      <PostCard key={post.id} post={post} />
                    ))}
                  </div>
                )}
                <div ref={sentinelRef} className="py-4">
                  {postsQuery.isFetchingNextPage && <LoadingSpinner />}
                </div>
              </div>
            )}

            {tab === 'users' && (
              <div>
                {usersQuery.isLoading ? (
                  <LoadingSpinner className="py-12" />
                ) : users.length === 0 ? (
                  <EmptyState
                    icon={<UserIcon className="h-14 w-14" />}
                    title={t('search.empty.noUsers')}
                  />
                ) : (
                  <div className="space-y-2">
                    {users.map((u) => (
                      <Link
                        key={u.id}
                        to={`/u/${u.username}`}
                        className="flex items-center gap-3 bg-surface rounded p-3 shadow-elevation-1 hover:shadow-elevation-2 transition-shadow"
                      >
                        <UserAvatar src={u.avatar_url} name={u.display_name || u.username} size="md" />
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
                    ))}
                  </div>
                )}
                <div ref={sentinelRef} className="py-4">
                  {usersQuery.isFetchingNextPage && <LoadingSpinner />}
                </div>
              </div>
            )}

            {tab === 'topics' && (
              <div>
                {topicsQuery.isLoading ? (
                  <LoadingSpinner className="py-12" />
                ) : topics.length === 0 ? (
                  <EmptyState icon={<Flame className="h-14 w-14" />} title={t('search.empty.noTopics')} />
                ) : (
                  <div className="space-y-2">
                    {topics.map((topic) => (
                      <Link
                        key={topic.id}
                        to={`/topics/${topic.slug}`}
                        className="flex items-center justify-between bg-surface rounded p-4 shadow-elevation-1 hover:shadow-elevation-2 transition-shadow"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-primary truncate">#{topic.name}</p>
                          {topic.description && (
                            <p className="mt-0.5 text-xs text-surface-on-variant truncate">
                              {topic.description}
                            </p>
                          )}
                        </div>
                        <div className="text-right text-xs text-surface-on-variant tabular-nums shrink-0 ml-3">
                          <p>{topic.post_count} {t('topic.postSuffix')}</p>
                          <p>{topic.follower_count} {t('topic.followerCount')}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
