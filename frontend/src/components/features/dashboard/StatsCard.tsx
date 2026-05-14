import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'

interface StatsCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: LucideIcon
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple'
  className?: string
}

const colorMap = {
  blue: {
    icon: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
  },
  green: {
    icon: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  red: {
    icon: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
  },
  yellow: {
    icon: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
  },
  purple: {
    icon: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/20',
  },
}

export default function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'blue',
  className,
}: StatsCardProps) {
  const colors = colorMap[color]

  return (
    <div className={clsx('erp-card p-4 flex items-start gap-4', className)}>
      <div className={clsx('p-2.5 rounded-lg border', colors.bg, colors.border)}>
        <Icon className={clsx('w-5 h-5', colors.icon)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-slate-500 mb-1">{title}</div>
        <div className="text-xl font-semibold text-slate-100 truncate">{value}</div>
        {subtitle && (
          <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
        )}
      </div>
    </div>
  )
}
