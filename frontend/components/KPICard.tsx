'use client'

import { motion } from 'framer-motion'
import { ReactNode } from 'react'
import type { PaletteKey } from '@/lib/theme'

interface KPICardProps {
  title: string
  value: string | number
  icon: ReactNode
  trend?: number
  unit?: string
  accent?: PaletteKey
}

const accentStyles: Record<
  PaletteKey,
  { glow: string; icon: string; title: string; value: string }
> = {
  emerald: {
    glow: 'bg-palette-emerald-light',
    icon: 'border-palette-emerald/30 text-palette-emerald bg-palette-emerald-light',
    title: 'text-palette-emerald-text',
    value: 'text-palette-emerald-dark',
  },
  teal: {
    glow: 'bg-palette-teal-light',
    icon: 'border-palette-teal/30 text-palette-teal bg-palette-teal-light',
    title: 'text-palette-teal-text',
    value: 'text-palette-teal-dark',
  },
  rose: {
    glow: 'bg-palette-rose-light',
    icon: 'border-palette-rose/30 text-palette-rose bg-palette-rose-light',
    title: 'text-palette-rose-text',
    value: 'text-palette-rose-dark',
  },
  amber: {
    glow: 'bg-palette-amber-light',
    icon: 'border-palette-amber/30 text-palette-amber bg-palette-amber-light',
    title: 'text-palette-amber-text',
    value: 'text-palette-amber-dark',
  },
  orange: {
    glow: 'bg-palette-orange-light',
    icon: 'border-palette-orange/30 text-palette-orange bg-palette-orange-light',
    title: 'text-palette-orange-text',
    value: 'text-palette-orange-dark',
  },
  lime: {
    glow: 'bg-palette-lime-light',
    icon: 'border-palette-lime/30 text-palette-lime bg-palette-lime-light',
    title: 'text-palette-lime-text',
    value: 'text-palette-lime-dark',
  },
}

export default function KPICard({
  title,
  value,
  icon,
  trend,
  unit,
  accent = 'emerald',
}: KPICardProps) {
  const a = accentStyles[accent]
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="card card-hover card-glow relative overflow-hidden"
    >
      <div className={`absolute -right-4 -top-4 h-20 w-20 rounded-full blur-2xl opacity-80 ${a.glow}`} />
      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <p className={`text-[11px] font-bold uppercase tracking-wider ${a.title}`}>{title}</p>
          <div className="mt-3 flex items-baseline gap-2">
            <h3 className={`text-3xl font-bold tracking-tight ${a.value}`}>
              {typeof value === 'number' && value % 1 !== 0 ? value.toFixed(1) : value}
            </h3>
            {unit && <span className="text-sm text-secondary">{unit}</span>}
          </div>
          {trend !== undefined && (
            <p
              className={`mt-2 text-xs font-medium ${trend >= 0 ? 'text-palette-teal' : 'text-palette-rose'}`}
            >
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
            </p>
          )}
        </div>
        <div className={`rounded-xl border p-2.5 ${a.icon}`}>{icon}</div>
      </div>
    </motion.div>
  )
}
