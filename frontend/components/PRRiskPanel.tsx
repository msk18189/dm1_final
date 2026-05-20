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

export default function PRRiskPanel({ data }: { data: PRRiskItem[] }) {
  if (!data?.length) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover card-glow h-full">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="h-5 w-5 text-palette-orange" />
          <h3 className="section-title">PR Risk & Delay Predictions</h3>
        </div>
        <p className="text-sm text-midnight-400">No open PRs with ML predictions yet.</p>
      </motion.div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover card-glow h-full">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5 text-palette-rose" />
        <h3 className="text-lg font-bold">PR Risk & Delay Predictions</h3>
      </div>
      <p className="section-subtitle mb-4">
        {data[0]?._panel_note ||
          (data[0]?.score_source === 'heuristic'
            ? 'Rule-based risk estimates from PR age, reviews, and size (same signals as stale alerts). Train ML models for full predictions.'
            : 'ML-powered risk scores for open PRs — higher risk may need attention')}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-midnight-500">#</th>
              <th className="px-3 py-2 text-left text-xs text-gray-400">Title</th>
              <th className="px-3 py-2 text-left text-xs text-gray-400">Author</th>
              <th className="px-3 py-2 text-left text-xs text-gray-400">Risk</th>
              <th className="px-3 py-2 text-left text-xs text-gray-400">Bottleneck</th>
              <th className="px-3 py-2 text-left text-xs text-gray-400">Est. delay</th>
              <th className="px-3 py-2 text-left text-xs text-gray-400">Est. review wait</th>
            </tr>
          </thead>
          <tbody>
            {data.map((pr) => (
              <tr key={pr.number} className="border-b border-brown-100 transition hover:bg-brown-50">
                <td className="px-3 py-2 text-sm text-midnight-200">{pr.number}</td>
                <td className="px-3 py-2 text-sm max-w-xs truncate">{pr.title}</td>
                <td className="px-3 py-2 text-sm">{pr.author}</td>
                <td className={`px-3 py-2 text-sm font-bold ${riskColor(pr.risk_score)}`}>
                  {pr.risk_score}%
                </td>
                <td className="px-3 py-2 text-sm">{pr.bottleneck_probability}%</td>
                <td className="px-3 py-2 text-sm">
                  {pr.predicted_delay_display
                    ? `${pr.predicted_delay_display.value} ${pr.predicted_delay_display.unit}`
                    : pr.predicted_delay_days != null
                    ? `${pr.predicted_delay_days} days`
                    : '—'}
                </td>
                <td className="px-3 py-2 text-sm">
                  {pr.predicted_review_wait_hours != null
                    ? `${pr.predicted_review_wait_hours} hrs`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
