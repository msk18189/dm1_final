'use client'

import { motion } from 'framer-motion'
import { SlidersHorizontal } from 'lucide-react'

export interface DashboardFiltersState {
  days: number | null
  author: string
  state: string
  startDate?: string | null
  endDate?: string | null
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
  const presets = [null, 30, 90, 180]
  const isCustomDays = filters.days !== null && !presets.includes(filters.days) && !filters.startDate
  const isCustomRange = filters.startDate !== undefined && filters.startDate !== null

  const handleSelectChange = (val: string) => {
    if (val === 'custom-days') {
      onChange({
        ...filters,
        days: 45,
        startDate: null,
        endDate: null,
      })
    } else if (val === 'custom-range') {
      const end = new Date().toISOString().split('T')[0]
      const start = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0]
      onChange({
        ...filters,
        days: null,
        startDate: start,
        endDate: end,
      })
    } else {
      onChange({
        ...filters,
        days: val ? Number(val) : null,
        startDate: null,
        endDate: null,
      })
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover mb-8">
      <div className="mb-4 flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-palette-orange" />
        <h3 className="section-title">Filters</h3>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-midnight-500">
            Date range
          </label>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={isCustomRange ? 'custom-range' : (isCustomDays ? 'custom-days' : (filters.days ?? ''))}
              onChange={(e) => handleSelectChange(e.target.value)}
              className="input-field text-sm min-w-[140px] flex-1"
            >
              <option value="">All time</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 180 days</option>
              <option value="custom-days">Custom days...</option>
              <option value="custom-range">Customize Date...</option>
            </select>
            {isCustomDays && (
              <input
                type="number"
                min="1"
                value={filters.days ?? 45}
                onChange={(e) => {
                  const val = e.target.value ? Math.max(1, Number(e.target.value)) : 1
                  onChange({ ...filters, days: val })
                }}
                className="input-field text-sm w-20 text-center"
                placeholder="Days"
              />
            )}
            {isCustomRange && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  type="date"
                  value={filters.startDate || ''}
                  onChange={(e) => {
                    onChange({ ...filters, startDate: e.target.value })
                  }}
                  className="input-field text-sm px-2.5 py-2 w-[145px]"
                />
                <span className="text-xs text-midnight-400 font-medium">to</span>
                <input
                  type="date"
                  value={filters.endDate || ''}
                  onChange={(e) => {
                    onChange({ ...filters, endDate: e.target.value })
                  }}
                  className="input-field text-sm px-2.5 py-2 w-[145px]"
                />
              </div>
            )}
          </div>
        </div>
        <div className="w-full lg:w-auto lg:min-w-[180px]">
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-midnight-500">
            Author
          </label>
          <select
            value={filters.author}
            onChange={(e) => onChange({ ...filters, author: e.target.value })}
            className="input-field text-sm w-full"
          >
            <option value="all">All authors</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full lg:w-auto lg:min-w-[180px]">
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-midnight-500">
            PR state
          </label>
          <select
            value={filters.state}
            onChange={(e) => onChange({ ...filters, state: e.target.value })}
            className="input-field text-sm w-full"
          >
            <option value="ALL">All states</option>
            <option value="OPEN">Open</option>
            <option value="MERGED">Merged</option>
            <option value="CLOSED">Closed</option>
            <option value="STALE">Stale (&gt;30d)</option>
          </select>
        </div>
        <div className="w-full lg:w-auto lg:flex-initial">
          <button type="button" onClick={onApply} className="btn-primary w-full lg:px-8 text-sm">
            Apply filters
          </button>
        </div>
      </div>
    </motion.div>
  )
}
