import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listShares, revokeShare } from '../lib/api'
import AppShell from '../components/layout/AppShell'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import FileIcon from '../components/FileIcon'
import {
  LinkIcon,
  Download,
  Trash2,
  Lock,
  CheckCircle2,
  AlertTriangle,
} from '../components/icons'
import { useT } from '../lib/i18n'
import { useConfirm } from '../lib/notify'

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export default function MySharesPage() {
  const t = useT()
  const { showConfirm } = useConfirm()
  const qc = useQueryClient()
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  const formatDate = (value: string | null): string => {
    if (!value) return t('common.permanent')
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    return d.toLocaleString('zh-CN', { hour12: false })
  }

  const { data: shares = [], isLoading } = useQuery({
    queryKey: ['shares'],
    queryFn: listShares,
  })

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeShare(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shares'] })
      setToast({ kind: 'success', msg: t('share.revoked') })
      window.setTimeout(() => setToast(null), 2500)
    },
    onError: (err: Error) => {
      setToast({ kind: 'error', msg: err.message || t('share.revokeFailed') })
      window.setTimeout(() => setToast(null), 2500)
    },
  })

  const handleCopy = async (token: string) => {
    const url = `${window.location.origin}/share/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setToast({ kind: 'success', msg: t('common.copySuccess') })
    } catch {
      setToast({ kind: 'error', msg: t('common.copyFailed') })
    }
    window.setTimeout(() => setToast(null), 2500)
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="inline-flex items-center gap-2 text-xl font-bold text-surface-on mb-4">
          <LinkIcon className="h-5 w-5 text-primary" aria-hidden />
          {t('share.myShares')}
        </h1>

        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : shares.length === 0 ? (
          <EmptyState
            icon={<LinkIcon className="h-14 w-14" />}
            title={t('share.noShares')}
            description={t('share.noSharesDesc')}
          />
        ) : (
          <div className="bg-surface rounded shadow-elevation-1 overflow-hidden">
            {shares.map((s, idx) => {
              const node = s.node
              const url = `${window.location.origin}/share/${s.token}`
              return (
                <div
                  key={s.id}
                  className={
                    'flex items-center gap-3 p-4 ' +
                    (idx > 0 ? 'border-t border-divider' : '')
                  }
                >
                  <FileIcon
                    mimeType={node?.mime_type || ''}
                    isFolder={node?.is_folder}
                    className="h-8 w-8 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="inline-flex items-center gap-1.5 text-sm font-medium text-surface-on truncate">
                      {node?.name || t('share.deletedFile')}
                      {s.has_password && (
                        <Lock className="h-3 w-3 text-warning" aria-hidden />
                      )}
                    </p>
                    <p className="text-xs text-surface-on-variant truncate">
                      {node?.size ? formatBytes(node.size) : ''}
                      {node?.size ? ' · ' : ''}
                      {t('share.createdAt', { date: formatDate(s.created_at) })}
                    </p>
                    <p className="text-xs text-surface-on-variant truncate">
                      {t('share.expireTo', { date: formatDate(s.expires_at) })}
                    </p>
                    <p className="text-[11px] text-surface-on-variant mt-0.5 truncate">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {url}
                      </a>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="inline-flex items-center gap-1 text-sm font-semibold text-primary tabular-nums">
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      {s.download_count}
                    </p>
                    <p className="text-[10px] text-surface-on-variant">{t('share.downloadSuffix')}</p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopy(s.token)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded"
                    >
                      <LinkIcon className="h-3.5 w-3.5" aria-hidden />
                      {t('common.copy')}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await showConfirm({
                          message: t('share.revokeOne', { name: node?.name || '' }),
                          danger: true,
                        })
                        if (ok) revokeMut.mutate(s.id)
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-error hover:bg-error/10 rounded"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      {t('share.revoke')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 px-4 py-2.5 rounded shadow-elevation-8 bg-surface text-surface-on border"
          style={{
            borderColor:
              toast.kind === 'success' ? 'rgb(34 197 94 / 0.4)' : 'rgb(239 68 68 / 0.4)',
          }}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <AlertTriangle className="h-4 w-4 text-error" aria-hidden />
          )}
          <span className="text-sm">{toast.msg}</span>
        </div>
      )}
    </AppShell>
  )
}
