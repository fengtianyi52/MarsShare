import clsx from 'clsx'

interface Props {
  used: number
  total: number
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export default function StorageQuotaBar({ used, total }: Props) {
  const pct = total > 0 ? (used / total) * 100 : 0
  const isWarning = pct > 80
  const isDanger = pct > 95

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-surface-on-variant">
        <span>{formatBytes(used)} / {formatBytes(total)}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 rounded-full bg-surface-variant overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500',
            isDanger ? 'bg-error' : isWarning ? 'bg-warning' : 'bg-primary',
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}
