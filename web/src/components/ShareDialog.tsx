import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createShare } from '../lib/api'
import type { DriveNode } from '../types'
import { Paperclip } from './icons'
import { useT } from '../lib/i18n'

interface Props {
  node: DriveNode
  open: boolean
  onClose: () => void
}

export default function ShareDialog({ node, open, onClose }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [usePassword, setUsePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [shareUrl, setShareUrl] = useState('')

  const shareMut = useMutation({
    mutationFn: () => createShare({
      node_id: node.id,
      password: usePassword ? password : undefined,
      expires_at: expiresAt || undefined,
    }),
    onSuccess: (link) => {
      setShareUrl(`${window.location.origin}/share/${link.token}`)
      qc.invalidateQueries({ queryKey: ['shares'] })
    },
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-surface rounded shadow-elevation-16 w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-medium text-surface-on mb-4">{t('share.title')}</h2>
        <p className="inline-flex items-center gap-1.5 text-sm text-surface-on-variant mb-4">
          <Paperclip className="h-4 w-4" aria-hidden />
          <span className="truncate">{node.name}</span>
        </p>

        {shareUrl ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 bg-surface-variant rounded px-3 py-2 text-sm"
              />
              <button
                onClick={() => navigator.clipboard.writeText(shareUrl)}
                className="px-4 py-2 bg-primary text-primary-on rounded text-sm font-medium hover:bg-primary/90"
              >
                {t('common.copy')}
              </button>
            </div>
            {usePassword && (
              <p className="text-xs text-surface-on-variant">{t('share.extractPasswordLabel', { password })}</p>
            )}
            <button
              onClick={() => { setShareUrl(''); onClose() }}
              className="w-full py-2 text-sm text-surface-on-variant hover:bg-surface-variant rounded"
            >
              {t('common.close')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={usePassword}
                onChange={(e) => setUsePassword(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-surface-on">{t('share.passwordProtect')}</span>
            </label>
            {usePassword && (
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('share.setExtractPassword')}
                className="w-full bg-surface-variant rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            )}
            <div>
              <label className="text-sm text-surface-on-variant block mb-1">{t('share.expireLabel')}</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full bg-surface-variant rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
            {shareMut.isError && (
              <p className="text-xs text-error">
                {(shareMut.error as Error).message || t('share.createFailed')}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm text-surface-on-variant hover:bg-surface-variant rounded">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => shareMut.mutate()}
                disabled={shareMut.isPending || (usePassword && !password)}
                className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {shareMut.isPending ? t('share.creating') : t('share.createLink')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
