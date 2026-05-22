'use client'

import { motion } from 'framer-motion'
import { Brain } from 'lucide-react'
import { riskColor } from '@/lib/format'

interface PRRiskItem {
  number: number
  title: string
  author: string
  risk_score: number
  bottleneck_probability: number
  predicted_delay_days: number | null
  predicted_delay_display?: { value: number; unit: string }
  predicted_review_wait_hours: number | null
  score_source?: string
  _panel_note?: string
}

interface PRRiskPanelProps {
  data: PRRiskItem[]
  page?: number
  totalPages?: number
  onPageChange?: (newPage: number) => void
  totalResults?: number
}

export default function PRRiskPanel({
  data,
  page = 1,
  totalPages,
  onPageChange,
  totalResults,
}: PRRiskPanelProps) {
  if (!data?.length) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover card-glow h-full">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="h-5 w-5 text-palette-orange" />
          <h3 className="section-title text-primary">PR Risk & Delay Predictions</h3>
        </div>
        <p className="text-sm text-muted">No open PRs with ML predictions yet.</p>
      </motion.div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover card-glow h-full flex flex-col justify-between">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-palette-rose" />
            <h3 className="text-lg font-bold text-primary">PR Risk & Delay Predictions</h3>
          </div>
          {totalResults !== undefined && (
            <span className="text-xs text-muted font-medium">
              Total: {totalResults.toLocaleString()} records
            </span>
          )}
        </div>
        <p className="text-xs text-secondary mb-4">
          {data[0]?._panel_note ||
            (data[0]?.score_source === 'heuristic'
              ? 'Rule-based risk estimates from PR age, reviews, and size (same signals as stale alerts). Train ML models for full predictions.'
              : 'ML-powered risk scores for open PRs — higher risk may need attention')}
        </p>
        <div className="overflow-x-auto rounded-xl border border-warm-200">
          <table className="w-full">
            <thead>
              <tr className="border-b border-warm-200 bg-warm-50/50">
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-secondary">#</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-secondary">Title</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-secondary">Author</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-secondary">Risk</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-secondary">Bottleneck</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-secondary">Est. delay</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-secondary">Est. review wait</th>
              </tr>
            </thead>
            <tbody>
              {data.map((pr) => (
                <tr key={pr.number} className="border-b border-warm-100 transition hover:bg-warm-50/40">
                  <td className="px-3 py-2 font-mono text-xs text-muted">#{pr.number}</td>
                  <td className="px-3 py-2 text-xs text-primary max-w-xs truncate">{pr.title}</td>
                  <td className="px-3 py-2 text-xs text-secondary">{pr.author}</td>
                  <td className={`px-3 py-2 text-xs font-bold ${riskColor(pr.risk_score)}`}>
                    {pr.risk_score}%
                  </td>
                  <td className="px-3 py-2 text-xs text-secondary">{pr.bottleneck_probability}%</td>
                  <td className="px-3 py-2 text-xs text-secondary">
                    {pr.predicted_delay_display
                      ? `${pr.predicted_delay_display.value} ${pr.predicted_delay_display.unit}`
                      : pr.predicted_delay_days != null
                      ? `${pr.predicted_delay_days} days`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-secondary">
                    {pr.predicted_review_wait_hours != null
                      ? `${pr.predicted_review_wait_hours} hrs`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages !== undefined && onPageChange && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between border-t border-warm-200 pt-4">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-secondary">
            Page <span className="font-semibold text-primary">{page}</span> of{' '}
            <span className="font-semibold text-primary">{totalPages}</span>
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </motion.div>
  )
}
