import { useState } from 'react'
import { downloadObjectFile, getPreviewUrl } from '../lib/api'
import type { DriveNode } from '../types'
import { X, Paperclip } from './icons'
import { useT } from '../lib/i18n'
import { useToast } from '../lib/notify'

interface Props {
  node: DriveNode
  onClose: () => void
}

export default function FilePreview({ node, onClose }: Props) {
  const t = useT()
  const { showToast } = useToast()
  const mime = node.mime_type || ''
  const objectId = node.object_id ? String(node.object_id) : ''
  const [downloading, setDownloading] = useState(false)

  // Whether the current mime type can be rendered inline.
  const isPreviewable =
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime === 'application/pdf'

  // Direct URL with token — no blob fetch needed.
  const previewUrl = objectId && isPreviewable ? getPreviewUrl(objectId) : ''

  const handleDownload = async () => {
    if (!objectId || downloading) return
    setDownloading(true)
    try {
      await downloadObjectFile(objectId, node.name)
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message || t('common.downloadFailed') })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-surface rounded shadow-elevation-16 w-full max-w-3xl max-h-[80vh] mx-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider">
          <h3 className="font-medium text-surface-on truncate">{node.name}</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || !objectId}
              className="px-4 py-1.5 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
            >
              {downloading ? t('common.downloading') : t('common.download')}
            </button>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1.5 hover:bg-surface-variant rounded-full text-surface-on-variant transition-colors"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {isPreviewable && previewUrl && mime.startsWith('image/') && (
            <img src={previewUrl} alt={node.name} className="max-w-full mx-auto rounded-lg" />
          )}
          {isPreviewable && previewUrl && mime.startsWith('video/') && (
            <video src={previewUrl} controls className="max-w-full mx-auto rounded-lg" />
          )}
          {isPreviewable && previewUrl && mime.startsWith('audio/') && (
            <audio src={previewUrl} controls className="w-full mt-8" />
          )}
          {isPreviewable && previewUrl && mime === 'application/pdf' && (
            <iframe src={previewUrl} className="w-full h-[60vh] rounded-lg" />
          )}
          {!isPreviewable && (
            <div className="flex flex-col items-center justify-center py-12 text-surface-on-variant">
              <Paperclip className="h-12 w-12 mb-4" aria-hidden />
              <p className="text-lg font-medium">{node.name}</p>
              <p className="text-sm mt-1">{mime || t('drive.preview.unknownMime')}</p>
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading || !objectId}
                className="mt-4 px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {downloading ? t('common.downloading') : t('share.downloadFile')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
