import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getPublicShare, verifySharePassword, downloadPublicShare } from '../lib/api'
import FileIcon from '../components/FileIcon'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import { LinkIcon, Lock, Trash2 } from '../components/icons'
import { useT } from '../lib/i18n'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export default function PublicSharePage() {
  const t = useT()
  const { token } = useParams<{ token: string }>()
  const [password, setPassword] = useState('')
  const [verified, setVerified] = useState(false)

  const { data: share, isLoading, error } = useQuery({
    queryKey: ['share', token],
    queryFn: () => getPublicShare(token!),
    enabled: !!token,
    retry: false,
  })

  const verifyMut = useMutation({
    mutationFn: () => verifySharePassword(token!, { password }),
    onSuccess: () => setVerified(true),
  })

  const needsPassword = share && share.password && !verified
  const dlUrl = downloadPublicShare(token!)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  if (error || !share) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <EmptyState icon={<LinkIcon className="h-14 w-14" />} title={t('share.invalidOrExpired')} />
      </div>
    )
  }

  if (share.node_deleted || !share.node) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <EmptyState
          icon={<Trash2 className="h-14 w-14" />}
          title={t('share.fileDeleted')}
          description={t('share.fileDeletedHint')}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-lg font-bold text-primary">MarsShare</h1>
          <p className="text-sm text-surface-on-variant mt-1">{t('share.public.title')}</p>
        </div>

        <div className="bg-surface rounded shadow-elevation-2 p-6">
          {needsPassword ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center">
                <Lock className="h-10 w-10 text-primary" aria-hidden />
                <p className="text-sm text-surface-on mt-2">{t('share.passwordNeeded')}</p>
              </div>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('share.extractPassword')}
                type="password"
                className="w-full bg-surface rounded px-4 py-2.5 text-sm border border-outline focus:outline-none focus:border-primary focus:border-2"
                onKeyDown={(e) => e.key === 'Enter' && verifyMut.mutate()}
              />
              {verifyMut.isError && (
                <p className="text-xs text-error">{t('share.passwordWrong')}</p>
              )}
              <button
                onClick={() => verifyMut.mutate()}
                disabled={!password || verifyMut.isPending}
                className="w-full py-2.5 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {verifyMut.isPending ? t('share.verifying') : t('share.verifyPassword')}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-surface-variant/60 rounded">
                <FileIcon
                  mimeType={share.node?.mime_type || ''}
                  isFolder={share.node?.is_folder}
                  className="h-7 w-7"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-on truncate">
                    {share.node?.name || t('share.fileGeneric')}
                  </p>
                  <p className="text-xs text-surface-on-variant">
                    {share.node?.size ? formatBytes(share.node.size) : ''}
                  </p>
                </div>
              </div>

              {share.expires_at && (
                <p className="text-xs text-surface-on-variant text-center">
                  {t('share.expireAt', { date: new Date(share.expires_at).toLocaleDateString('zh-CN') })}
                </p>
              )}

              <div className="flex gap-3">
                <a
                  href={dlUrl}
                  className="flex-1 py-2.5 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider text-center shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all"
                >
                  {t('share.downloadFile')}
                </a>
              </div>

              <p className="text-xs text-surface-on-variant text-center">
                {share.max_downloads
                  ? t('share.downloadCountMax', { count: share.download_count, max: share.max_downloads })
                  : t('share.downloadCount', { count: share.download_count })}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
