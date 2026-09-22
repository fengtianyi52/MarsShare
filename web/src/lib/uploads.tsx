import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { uploadFileXHR } from './api'
import { tStatic } from './i18n'

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

export type UploadStatus = 'pending' | 'uploading' | 'success' | 'error' | 'canceled'

export interface UploadTask {
  id: string
  file: File
  parentId: string | null
  status: UploadStatus
  progress: number // 0..1
  loaded: number
  total: number
  error?: string
  startedAt?: number
  completedAt?: number
}

interface UploadContextValue {
  tasks: UploadTask[]
  enqueue: (parentId: string | null, files: File[] | FileList) => void
  cancel: (id: string) => void
  remove: (id: string) => void
  retry: (id: string) => void
  clearCompleted: () => void
  // 统计
  activeCount: number
  pendingCount: number
  totalCount: number
  isPanelVisible: boolean
  showPanel: () => void
  hidePanel: () => void
}

const UploadContext = createContext<UploadContextValue | null>(null)

const MAX_CONCURRENT = 3

let taskSeq = 0
const nextId = () => `${Date.now().toString(36)}-${(taskSeq++).toString(36)}`

// ────────────────────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────────────────────

export function UploadProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [isPanelVisible, setPanelVisible] = useState(false)

  // AbortController per task — kept in a ref to survive re-renders.
  const controllersRef = useRef(new Map<string, AbortController>())

  const updateTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  // Start an upload for a task. Marks status, wires progress and AbortController.
  const startUpload = useCallback(
    (task: UploadTask) => {
      const controller = new AbortController()
      controllersRef.current.set(task.id, controller)

      updateTask(task.id, {
        status: 'uploading',
        startedAt: Date.now(),
        loaded: 0,
        total: task.file.size,
      })

      uploadFileXHR(task.parentId, task.file, {
        signal: controller.signal,
        onProgress: ({ loaded, total, percent }) => {
          updateTask(task.id, { loaded, total, progress: percent })
        },
      })
        .then(() => {
          controllersRef.current.delete(task.id)
          updateTask(task.id, {
            status: 'success',
            progress: 1,
            completedAt: Date.now(),
          })
          // Refresh drive trees so the new file shows up everywhere.
          queryClient.invalidateQueries({ queryKey: ['driveTree'] })
          queryClient.invalidateQueries({ queryKey: ['driveTrash'] })
        })
        .catch((err: Error) => {
          controllersRef.current.delete(task.id)
          if (err.name === 'AbortError') {
            updateTask(task.id, { status: 'canceled', completedAt: Date.now() })
          } else {
            updateTask(task.id, {
              status: 'error',
              error: err.message || tStatic('common.uploadFailed'),
              completedAt: Date.now(),
            })
          }
        })
    },
    [queryClient, updateTask],
  )

  // Scheduler: whenever tasks change, start as many pending uploads as the
  // concurrency limit allows.
  useEffect(() => {
    const active = tasks.filter((t) => t.status === 'uploading').length
    if (active >= MAX_CONCURRENT) return
    const slots = MAX_CONCURRENT - active
    const next = tasks.filter((t) => t.status === 'pending').slice(0, slots)
    if (next.length === 0) return
    next.forEach(startUpload)
    // startUpload mutates tasks via updateTask, which will trigger this effect
    // again until either no pending tasks remain or all slots are full.
  }, [tasks, startUpload])

  const enqueue = useCallback(
    (parentId: string | null, files: File[] | FileList) => {
      const list = Array.from(files)
      if (list.length === 0) return
      const newTasks: UploadTask[] = list.map((file) => ({
        id: nextId(),
        file,
        parentId,
        status: 'pending',
        progress: 0,
        loaded: 0,
        total: file.size,
      }))
      setTasks((prev) => [...prev, ...newTasks])
      setPanelVisible(true)
    },
    [],
  )

  const cancel = useCallback((id: string) => {
    const controller = controllersRef.current.get(id)
    if (controller) {
      controller.abort()
      return
    }
    // Pending task that hasn't started yet — just mark canceled.
    setTasks((prev) =>
      prev.map((t) => (t.id === id && t.status === 'pending' ? { ...t, status: 'canceled' } : t)),
    )
  }, [])

  const remove = useCallback((id: string) => {
    const controller = controllersRef.current.get(id)
    if (controller) controller.abort()
    controllersRef.current.delete(id)
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const retry = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id && (t.status === 'error' || t.status === 'canceled')
          ? { ...t, status: 'pending', progress: 0, loaded: 0, error: undefined, completedAt: undefined }
          : t,
      ),
    )
  }, [])

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== 'success' && t.status !== 'canceled'))
  }, [])

  // Warn the user if they try to close the tab while uploads are in progress.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const inFlight = tasks.some((t) => t.status === 'uploading' || t.status === 'pending')
      if (!inFlight) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [tasks])

  const value = useMemo<UploadContextValue>(() => {
    const activeCount = tasks.filter((t) => t.status === 'uploading').length
    const pendingCount = tasks.filter((t) => t.status === 'pending').length
    return {
      tasks,
      enqueue,
      cancel,
      remove,
      retry,
      clearCompleted,
      activeCount,
      pendingCount,
      totalCount: tasks.length,
      isPanelVisible,
      showPanel: () => setPanelVisible(true),
      hidePanel: () => setPanelVisible(false),
    }
  }, [tasks, enqueue, cancel, remove, retry, clearCompleted, isPanelVisible])

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
}

export function useUploads(): UploadContextValue {
  const ctx = useContext(UploadContext)
  if (!ctx) throw new Error('useUploads must be used within UploadProvider')
  return ctx
}
