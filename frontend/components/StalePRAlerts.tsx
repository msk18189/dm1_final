'use client'

import { motion } from 'framer-motion'
import { AlertTriangle, Lightbulb } from 'lucide-react'
import { severityColor } from '@/lib/format'

interface StaleAlert {
  number: number
  title: string
  author: string
  age_days: number
  severity: string
  reasons: string[]
  recommended_actions: string[]
}

export default function StalePRAlerts({ data }: { data: StaleAlert[] }) {
  if (!data?.length) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover card-glow h-full">
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-palette-teal" />
          <h3 className="section-title">Stale PR Alerts</h3>
        </div>
        <p className="text-sm text-midnight-400">No PRs need attention right now.</p>
      </motion.div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover card-glow h-full">
      <div className="mb-4 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-palette-amber" />
        <h3 className="section-title">Stale PR Alerts</h3>
      </div>
      <div className="space-y-4">
        {data.map((alert) => (
          <div
            key={alert.number}
            className={`border rounded-lg p-4 ${severityColor(alert.severity)}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-white">
                  #{alert.number} — {alert.title}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {alert.author} · {alert.age_days} days open · {alert.severity} priority
                </p>
              </div>
            </div>
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-300 mb-1">Why flagged</p>
                <ul className="text-sm text-gray-400 space-y-1">
                  {alert.reasons.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-300 mb-1 flex items-center gap-1">
                  <Lightbulb className="w-3 h-3" /> Recommended actions
                </p>
                <ul className="text-sm text-palette-emerald space-y-1 font-medium">
                  {alert.recommended_actions.map((a, i) => (
                    <li key={i}>→ {a}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
