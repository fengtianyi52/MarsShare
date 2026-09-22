import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { followTopic, getTopicFeed, getTopicInfo, unfollowTopic } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import AppShell from '../components/layout/AppShell'
import PostCard from '../components/PostCard'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import { MessageCircle } from '../components/icons'

export default function TopicPage() {
  const t = useT()
  const { slug } = useParams<{ slug: string }>()
  const { isAuthenticated } = useAuth()
  const qc = useQueryClient()
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const topicQuery = useQuery({
    queryKey: ['topicInfo', slug],
    queryFn: () => getTopicInfo(slug!),
    enabled: !!slug,
  })

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['topic', slug],
    queryFn: ({ pageParam }) => getTopicFeed(slug!, pageParam),
    getNextPageParam: (last) => last.next_cursor || undefined,
    initialPageParam: undefined as string | undefined,
    enabled: !!slug,
  })

  const followMut = useMutation({
    mutationFn: (next: boolean) => (next ? followTopic(slug!) : unfollowTopic(slug!)),
    onMutate: (next: boolean) => {
      qc.setQueryData(['topicInfo', slug], (prev: any) =>
        prev
          ? {
              ...prev,
              is_following: next,
              follower_count: Math.max(0, (prev.follower_count || 0) + (next ? 1 : -1)),
            }
          : prev,
      )
    },
    onError: (_e, next) => {
      qc.setQueryData(['topicInfo', slug], (prev: any) =>
        prev
          ? {
              ...prev,
              is_following: !next,
              follower_count: Math.max(0, (prev.follower_count || 0) + (next ? -1 : 1)),
            }
          : prev,
      )
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['topicInfo', slug] }),
  })

  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const topic = topicQuery.data
  const posts = data?.pages.flatMap((p) => p.items) ?? []
  const headerName = topic?.name || slug || ''

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Topic header */}
        <div className="bg-surface rounded shadow-elevation-1 mb-6 overflow-hidden">
          <div
            className={clsx(
              'h-28 w-full',
              topic?.cover_url
                ? 'bg-cover bg-center'
                : 'bg-gradient-to-br from-primary/70 to-primary',
            )}
            style={topic?.cover_url ? { backgroundImage: `url(${topic.cover_url})` } : undefined}
          />
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-primary truncate">#{headerName}</h1>
                {topic?.description && (
                  <p className="mt-1 text-sm text-surface-on-variant">{topic.description}</p>
                )}
                <div className="mt-2 flex items-center gap-4 text-xs text-surface-on-variant">
                  <span>
                    <span className="font-semibold text-surface-on">{topic?.post_count ?? 0}</span> {t('topic.postCount')}
                  </span>
                  <span>
                    <span className="font-semibold text-surface-on">{topic?.follower_count ?? 0}</span> {t('topic.followerCount')}
                  </span>
                </div>
              </div>
              {isAuthenticated && topic && (
                <button
                  type="button"
                  disabled={followMut.isPending}
                  onClick={() => followMut.mutate(!topic.is_following)}
                  className={clsx(
                    'shrink-0 px-4 py-2 text-xs font-medium uppercase tracking-wider rounded transition-all',
                    topic.is_following
                      ? 'bg-surface-variant text-surface-on hover:bg-error/10 hover:text-error'
                      : 'bg-primary text-primary-on shadow-elevation-1 hover:shadow-elevation-2',
                  )}
                >
                  {topic.is_following ? t('topic.followed') : t('topic.follow')}
                </button>
              )}
            </div>
          </div>
        </div>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : posts.length === 0 ? (
          <EmptyState icon={<MessageCircle className="h-14 w-14" />} title={t('topic.empty')} />
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}

        <div ref={loadMoreRef} className="py-4">
          {isFetchingNextPage && <LoadingSpinner size="sm" />}
        </div>
      </div>
    </AppShell>
  )
}
