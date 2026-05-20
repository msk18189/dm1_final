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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover card-glow h-full flex flex-col">
      <div className="mb-4 flex items-center gap-2 shrink-0">
        <AlertTriangle className="h-5 w-5 text-palette-amber" />
        <h3 className="section-title">Stale PR Alerts</h3>
      </div>
      <div className="space-y-4 overflow-y-auto max-h-[260px] pr-2 scrollbar-thin">
        {data.map((alert) => (
          <div
            key={alert.number}
            className={`border rounded-lg p-4 ${severityColor(alert.severity)}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-midnight-50">
                  #{alert.number} — {alert.title}
                </p>
                <p className="text-xs text-midnight-200 mt-1 font-medium">
                  {alert.author} · {alert.age_days} days open · <span className="capitalize font-bold text-midnight-50">{alert.severity}</span> priority
                </p>
              </div>
            </div>
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-bold text-midnight-50 uppercase tracking-wider mb-1">Why flagged</p>
                <ul className="text-sm text-midnight-100 space-y-1 font-medium">
                  {alert.reasons.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-bold text-midnight-50 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Lightbulb className="w-3 h-3 text-palette-emerald" /> Recommended actions
                </p>
                <ul className="text-sm text-palette-teal-dark space-y-1 font-semibold">
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
