import clsx from 'clsx'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export default function LoadingSpinner({ size = 'md', className }: Props) {
  const sizeClasses = { sm: 'h-5 w-5', md: 'h-8 w-8', lg: 'h-12 w-12' }
  return (
    <div className={clsx('flex items-center justify-center', className)}>
      <div
        className={clsx(
          sizeClasses[size],
          'animate-spin rounded-full border-2 border-divider border-t-primary',
        )}
      />
    </div>
  )
}
