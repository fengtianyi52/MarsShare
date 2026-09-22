import { useQuery } from '@tanstack/react-query'
import { getTrending } from '../lib/api'
import { useT } from '../lib/i18n'
import AppShell from '../components/layout/AppShell'
import PostCard from '../components/PostCard'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import { Flame } from '../components/icons'

export default function TrendingPage() {
  const t = useT()
  const { data, isLoading } = useQuery({
    queryKey: ['trending'],
    queryFn: getTrending,
  })

  const posts = data?.items ?? []

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-4">
          <Flame className="h-5 w-5 text-error" aria-hidden />
          {t('post.hotContent')}
        </h1>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : posts.length === 0 ? (
          <EmptyState icon={<Flame className="h-14 w-14" />} title={t('post.emptyTrending')} description={t('post.emptyTrendingDesc')} />
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
