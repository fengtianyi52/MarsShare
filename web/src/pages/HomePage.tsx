import { useInfiniteQuery } from '@tanstack/react-query'
import { getPublicFeed } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import AppShell from '../components/layout/AppShell'
import PostCard from '../components/PostCard'
import PostComposer from '../components/PostComposer'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import { FileText } from '../components/icons'
import { useEffect, useRef } from 'react'

export default function HomePage() {
  const t = useT()
  const { isAuthenticated } = useAuth()
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['publicFeed'],
    queryFn: ({ pageParam }) => getPublicFeed(pageParam),
    getNextPageParam: (last) => last.next_cursor || undefined,
    initialPageParam: undefined as string | undefined,
  })

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 },
    )
    if (loadMoreRef.current) observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const posts = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-6">
        {isAuthenticated && <PostComposer />}

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : posts.length === 0 ? (
          <EmptyState icon={<FileText className="h-14 w-14" />} title={t('post.emptyFeed')} description={t('post.emptyFeedDesc')} />
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
