import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import { useUploads, type UploadTask } from '../lib/uploads'
import {
  Upload,
  X,
  Check,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  RotateCcw,
} from './icons'
import { useT } from '../lib/i18n'
import { useConfirm } from '../lib/notify'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

type TFn = ReturnType<typeof useT>

function statusLabel(task: UploadTask, t: TFn): string {
  switch (task.status) {
    case 'pending':
      return t('drive.upload.status.pending')
    case 'uploading':
      return `${Math.round(task.progress * 100)}% · ${formatBytes(task.loaded)} / ${formatBytes(task.total)}`
    case 'success':
      return t('drive.upload.status.success')
    case 'error':
      return task.error || t('common.uploadFailed')
    case 'canceled':
      return t('drive.upload.status.canceled')
  }
}

function TaskRow({ task }: { task: UploadTask }) {
  const t = useT()
  const { cancel, remove, retry } = useUploads()
  const isActive = task.status === 'uploading' || task.status === 'pending'
  const isDone = task.status === 'success'
  const isFailed = task.status === 'error' || task.status === 'canceled'

  return (
    <div className="px-4 py-3 border-b border-divider last:border-b-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="flex-1 truncate text-sm text-surface-on" title={task.file.name}>
          {task.file.name}
        </span>
        {isDone && <Check className="h-4 w-4 text-success shrink-0" aria-hidden />}
        {isFailed && <AlertTriangle className="h-4 w-4 text-error shrink-0" aria-hidden />}
        {isActive && (
          <button
            onClick={() => cancel(task.id)}
            aria-label={t('drive.upload.cancelUpload')}
            className="p-1 text-surface-on-variant hover:text-error hover:bg-error/10 rounded transition-colors"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {isFailed && (
          <>
            <button
              onClick={() => retry(task.id)}
              aria-label={t('common.retry')}
              className="p-1 text-surface-on-variant hover:text-primary hover:bg-primary/10 rounded transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              onClick={() => remove(task.id)}
              aria-label={t('common.remove')}
              className="p-1 text-surface-on-variant hover:text-error hover:bg-error/10 rounded transition-colors"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        )}
        {isDone && (
          <button
            onClick={() => remove(task.id)}
            aria-label={t('common.remove')}
            className="p-1 text-surface-on-variant hover:text-error hover:bg-error/10 rounded transition-colors"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-surface-variant rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full transition-all duration-200',
            isFailed ? 'bg-error' : isDone ? 'bg-success' : 'bg-primary',
          )}
          style={{ width: `${Math.max(2, Math.round(task.progress * 100))}%` }}
        />
      </div>

      <p className={clsx(
        'text-xs mt-1',
        isFailed ? 'text-error' : 'text-surface-on-variant',
      )}>
        {statusLabel(task, t)}
      </p>
    </div>
  )
}

export default function GlobalUploadPanel() {
  const t = useT()
  const { showConfirm } = useConfirm()
  const {
    tasks,
    activeCount,
    pendingCount,
    isPanelVisible,
    hidePanel,
    clearCompleted,
  } = useUploads()
  const [collapsed, setCollapsed] = useState(false)

  if (!isPanelVisible || tasks.length === 0) return null

  const inFlight = activeCount + pendingCount
  const completed = tasks.filter((task) => task.status === 'success').length
  const failed = tasks.filter((task) => task.status === 'error').length

  let headerText = ''
  if (inFlight > 0) {
    headerText = pendingCount > 0
      ? t('drive.upload.headerUploadingWithPending', { active: activeCount, pending: pendingCount })
      : t('drive.upload.headerUploading', { active: activeCount })
  } else if (failed > 0) {
    headerText = t('drive.upload.headerCompletedFailed', { completed, failed })
  } else {
    headerText = t('drive.upload.headerCompleted', { completed })
  }

  return (
    <AnimatePresence>
      <motion.div
        key="upload-panel"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.2 }}
        className="fixed bottom-4 right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] bg-surface rounded-lg shadow-elevation-16 border border-outline-variant overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 bg-surface-variant/40">
          <Upload className="h-4 w-4 text-primary shrink-0" aria-hidden />
          <span className="flex-1 text-sm font-medium text-surface-on truncate">{headerText}</span>
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? t('common.expand') : t('common.collapse')}
            className="p-1 text-surface-on-variant hover:text-primary hover:bg-primary/10 rounded transition-colors"
          >
            {collapsed
              ? <ChevronUp className="h-4 w-4" aria-hidden />
              : <ChevronDown className="h-4 w-4" aria-hidden />
            }
          </button>
          <button
            onClick={async () => {
              if (inFlight > 0) {
                const ok = await showConfirm({
                  message: t('drive.upload.confirmClosePanel'),
                  danger: true,
                })
                if (!ok) return
              }
              hidePanel()
            }}
            aria-label={t('common.closePanel')}
            className="p-1 text-surface-on-variant hover:text-error hover:bg-error/10 rounded transition-colors"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Task list */}
        {!collapsed && (
          <>
            <div className="max-h-80 overflow-y-auto scrollbar-thin">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
            {(completed > 0 || failed > 0) && inFlight === 0 && (
              <div className="px-4 py-2 border-t border-divider bg-surface-variant/20">
                <button
                  onClick={clearCompleted}
                  className="text-xs text-primary hover:underline uppercase tracking-wider font-medium"
                >
                  {t('drive.upload.clearCompleted')}
                </button>
              </div>
            )}
          </>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
