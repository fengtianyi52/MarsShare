import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUploads } from '../lib/uploads'
import { Upload, X } from './icons'
import { useT } from '../lib/i18n'

interface Props {
  parentId: string | null
  open: boolean
  onClose: () => void
}

export default function UploadModal({ parentId, open, onClose }: Props) {
  const t = useT()
  const { enqueue } = useUploads()
  const [pickedFiles, setPickedFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    setPickedFiles((prev) => [...prev, ...Array.from(newFiles)])
  }, [])

  const removeFile = (index: number) => {
    setPickedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleClose = () => {
    setPickedFiles([])
    onClose()
  }

  const handleSubmit = () => {
    if (pickedFiles.length === 0) return
    enqueue(parentId, pickedFiles)
    setPickedFiles([])
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={handleClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="bg-surface rounded shadow-elevation-16 w-full max-w-lg mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <h2 className="text-lg font-medium text-surface-on mb-4">{t('drive.upload.title')}</h2>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded p-8 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-primary bg-primary/10' : 'border-outline hover:border-primary/60'
              }`}
            >
              <Upload className="h-10 w-10 text-primary mx-auto mb-2" aria-hidden />
              <p className="text-sm text-surface-on-variant">{t('drive.upload.drop')}</p>
              <p className="text-xs text-surface-on-variant mt-1">{t('drive.upload.multiHint')}</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </div>

            {/* File list */}
            {pickedFiles.length > 0 && (
              <div className="mt-4 space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
                {pickedFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm bg-surface-variant/40 rounded px-2 py-1.5">
                    <span className="truncate flex-1" title={file.name}>{file.name}</span>
                    <span className="text-xs text-surface-on-variant shrink-0">
                      {file.size < 1024 * 1024
                        ? `${(file.size / 1024).toFixed(1)} KB`
                        : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
                    </span>
                    <button
                      onClick={() => removeFile(i)}
                      aria-label={t('common.remove')}
                      className="p-0.5 text-surface-on-variant hover:text-error rounded"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-primary hover:bg-primary/10 rounded uppercase tracking-wider font-medium transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSubmit}
                disabled={pickedFiles.length === 0}
                className="px-6 py-2 bg-primary text-primary-on rounded text-sm font-medium uppercase tracking-wider shadow-elevation-1 hover:shadow-elevation-2 hover:bg-primary-dark transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {t('drive.upload.queue')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
