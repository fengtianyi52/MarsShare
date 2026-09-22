import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getUserProfileDetails } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import AppShell from '../components/layout/AppShell'
import UserAvatar from '../components/UserAvatar'
import VipBadge from '../components/VipBadge'
import BannedBadge from '../components/BannedBadge'
import FollowButton from '../components/FollowButton'
import PostCard from '../components/PostCard'
import MarkdownRenderer from '../components/MarkdownRenderer'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import ReportDialog from '../components/ReportDialog'
import { User as UserIcon, FileText, Flag } from '../components/icons'

export default function UserProfilePage() {
  const t = useT()
  const { username } = useParams<{ username: string }>()
  const { user: me } = useAuth()
  const [reportOpen, setReportOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['userProfile', username],
    queryFn: () => getUserProfileDetails(username!),
    enabled: !!username,
  })

  const profile = data?.user
  const posts = data?.posts.items ?? []
  const isSelf = me?.username === username

  if (isLoading) {
    return <AppShell><LoadingSpinner className="py-20" /></AppShell>
  }

  if (!profile) {
    return <AppShell><EmptyState icon={<UserIcon className="h-14 w-14" />} title={t('user.notFound')} /></AppShell>
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-surface rounded shadow-elevation-1 p-6 mb-6">
          <div className="flex items-start gap-4">
            <UserAvatar src={profile.avatar_url} name={profile.display_name} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-surface-on">{profile.display_name}</h1>
                <VipBadge user={profile} size="md" />
                <BannedBadge user={profile} size="md" />
              </div>
              <p className="text-sm text-surface-on-variant">@{profile.username}</p>

              {profile.bio && (
                <MarkdownRenderer content={profile.bio} className="text-sm text-surface-on mt-2" />
              )}

              <div className="flex items-center gap-4 mt-3 text-sm">
                <span><strong>{profile.post_count}</strong> <span className="text-surface-on-variant">{t('post.postCount')}</span></span>
                {isSelf ? (
                  <Link
                    to="/me/followers"
                    className="hover:text-primary transition-colors"
                  >
                    <strong>{profile.follower_count}</strong>{' '}
                    <span className="text-surface-on-variant">{t('follow.followers')}</span>
                  </Link>
                ) : (
                  <span>
                    <strong>{profile.follower_count}</strong>{' '}
                    <span className="text-surface-on-variant">{t('follow.followers')}</span>
                  </span>
                )}
                {isSelf ? (
                  <Link
                    to="/me/following"
                    className="hover:text-primary transition-colors"
                  >
                    <strong>{profile.following_count}</strong>{' '}
                    <span className="text-surface-on-variant">{t('follow.following')}</span>
                  </Link>
                ) : (
                  <span>
                    <strong>{profile.following_count}</strong>{' '}
                    <span className="text-surface-on-variant">{t('follow.following')}</span>
                  </span>
                )}
              </div>
            </div>
            {!isSelf && me && (
              <div className="flex flex-col items-end gap-2">
                <FollowButton userId={profile.id} isFollowing={Boolean(profile.is_following)} />
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="inline-flex items-center gap-1 text-xs text-surface-on-variant hover:text-error"
                  title={t('user.reportUser')}
                >
                  <Flag className="h-3.5 w-3.5" aria-hidden />
                  {t('user.report')}
                </button>
              </div>
            )}
          </div>
        </div>

        <h2 className="text-sm font-medium text-surface-on-variant mb-3">{t('post.postCount')}</h2>
        {posts.length === 0 ? (
          <EmptyState icon={<FileText className="h-14 w-14" />} title={t('user.emptyPosts')} />
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>

      <ReportDialog
        open={reportOpen}
        targetType="user"
        targetId={profile.id}
        targetLabel={`@${profile.username}`}
        onClose={() => setReportOpen(false)}
      />
    </AppShell>
  )
}
