'use client'

import { motion } from 'framer-motion'
import { SlidersHorizontal } from 'lucide-react'

export interface DashboardFiltersState {
  days: number | null
  author: string
  state: string
}

interface DashboardFiltersProps {
  authors: string[]
  filters: DashboardFiltersState
  onChange: (filters: DashboardFiltersState) => void
  onApply: () => void
}

export default function DashboardFilters({
  authors,
  filters,
  onChange,
  onApply,
}: DashboardFiltersProps) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover mb-8">
      <div className="mb-4 flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-palette-orange" />
        <h3 className="section-title">Filters</h3>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-midnight-500">
            Date range
          </label>
          <select
            value={filters.days ?? ''}
            onChange={(e) =>
              onChange({
                ...filters,
                days: e.target.value ? Number(e.target.value) : null,
              })
            }
            className="input-field text-sm"
          >
            <option value="">All time</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="180">Last 180 days</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-midnight-500">
            Author
          </label>
          <select
            value={filters.author}
            onChange={(e) => onChange({ ...filters, author: e.target.value })}
            className="input-field text-sm"
          >
            <option value="all">All authors</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-midnight-500">
            PR state
          </label>
          <select
            value={filters.state}
            onChange={(e) => onChange({ ...filters, state: e.target.value })}
            className="input-field text-sm"
          >
            <option value="ALL">All states</option>
            <option value="OPEN">Open</option>
            <option value="MERGED">Merged</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <div className="flex items-end">
          <button type="button" onClick={onApply} className="btn-primary w-full text-sm">
            Apply filters
          </button>
        </div>
      </div>
    </motion.div>
  )
}
