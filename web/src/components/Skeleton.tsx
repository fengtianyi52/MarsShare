import clsx from 'clsx'

function Line({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'h-3 rounded-full bg-surface-variant animate-pulse',
        className,
      )}
    />
  )
}

function Avatar({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizeMap = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-16 w-16' }
  return (
    <div
      className={clsx(
        'rounded-full bg-surface-variant animate-pulse',
        sizeMap[size],
        className,
      )}
    />
  )
}

function PostCard() {
  return (
    <div className="bg-surface rounded-2xl shadow-elevation-1 p-4 space-y-3">
      {/* Author row */}
      <div className="flex items-center gap-3">
        <Avatar />
        <div className="flex-1 space-y-1.5">
          <Line className="w-28 h-3.5" />
          <Line className="w-20 h-2.5" />
        </div>
      </div>
      {/* Content lines */}
      <div className="space-y-2">
        <Line className="w-full" />
        <Line className="w-5/6" />
        <Line className="w-3/4" />
      </div>
      {/* Action bar */}
      <div className="flex items-center gap-4 pt-2 border-t border-outline-variant/50">
        <Line className="w-12 h-3" />
        <Line className="w-12 h-3" />
        <Line className="w-12 h-3" />
      </div>
    </div>
  )
}

function List({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <PostCard key={i} />
      ))}
    </div>
  )
}

const Skeleton = { Line, Avatar, PostCard, List }
export default Skeleton
