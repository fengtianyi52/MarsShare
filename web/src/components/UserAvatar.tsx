import clsx from 'clsx'

interface Props {
  src?: string
  dataUrl?: string
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-xl',
}

export default function UserAvatar({ src, dataUrl, name, size = 'md', className }: Props) {
  const letter = (name || '?')[0].toUpperCase()
  const effective = dataUrl || src

  if (effective) {
    return (
      <img
        src={effective}
        alt={name}
        className={clsx('rounded-full object-cover', sizeMap[size], className)}
      />
    )
  }

  return (
    <div
      className={clsx(
        'rounded-full bg-primary-container text-primary-on-container flex items-center justify-center font-medium',
        sizeMap[size],
        className,
      )}
    >
      {letter}
    </div>
  )
}
