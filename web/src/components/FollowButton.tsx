import { useMutation, useQueryClient } from '@tanstack/react-query'
import { follow, unfollow } from '../lib/api'
import { useT } from '../lib/i18n'
import clsx from 'clsx'

interface Props {
  userId: string
  isFollowing: boolean
}

export default function FollowButton({ userId, isFollowing }: Props) {
  const qc = useQueryClient()
  const t = useT()
  const followMut = useMutation({
    mutationFn: () => (isFollowing ? unfollow(userId) : follow(userId)),
    onSuccess: () => {
      // Profile pages are keyed by `username`, not `userId`, so invalidate by
      // prefix to refresh whichever profile this button belongs to. Also
      // invalidate following feed and the cross-page user lookup so follower
      // counts and feed contents reflect the change immediately.
      qc.invalidateQueries({ queryKey: ['userProfile'] })
      qc.invalidateQueries({ queryKey: ['feed'] })
      qc.invalidateQueries({ queryKey: ['publicFeed'] })
      qc.invalidateQueries({ queryKey: ['user'] })
    },
  })

  return (
    <button
      onClick={() => followMut.mutate()}
      disabled={followMut.isPending}
      className={clsx(
        'px-6 py-2 rounded-xl text-sm font-medium transition-all',
        isFollowing
          ? 'bg-secondary-container text-secondary-on-container hover:bg-secondary-container/80'
          : 'bg-primary text-primary-on hover:bg-primary/90',
      )}
    >
      {followMut.isPending ? '...' : isFollowing ? t('follow.followed') : t('follow.follow')}
    </button>
  )
}
