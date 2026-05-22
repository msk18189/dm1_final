'use client'
import { useEffect, useState } from 'react'
import { Heart, Shield, Zap, GitPullRequest, CircleDot, GitBranch, MessageCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { getRepoHealth } from '@/lib/api'

interface Props { repoId: number; repoLabel: string }

const gradeColors: Record<string, string> = {
  A: 'text-emerald-700', B: 'text-indigo-700', C: 'text-amber-700', D: 'text-orange-700', F: 'text-rose-700',
}
const gradeRing: Record<string, string> = {
  A: 'border-emerald-200 bg-emerald-50',
  B: 'border-indigo-200 bg-indigo-50',
  C: 'border-amber-200 bg-amber-50',
  D: 'border-orange-200 bg-orange-50',
  F: 'border-rose-200 bg-rose-50',
}

const componentIcons: Record<string, React.ReactNode> = {
  pull_requests: <GitPullRequest className="h-3.5 w-3.5" />,
  ci_cd: <Zap className="h-3.5 w-3.5" />,
  branches: <GitBranch className="h-3.5 w-3.5" />,
  issues: <CircleDot className="h-3.5 w-3.5" />,
  community: <MessageCircle className="h-3.5 w-3.5" />,
  visibility: <Shield className="h-3.5 w-3.5" />,
}

const componentMaxes: Record<string, number> = {
  pull_requests: 20, ci_cd: 25, branches: 15, issues: 20, community: 10, visibility: 10,
}

function ScoreBar({ name, score, max }: { name: string; score: number; max: number }) {
  const pct = max > 0 ? (score / max) * 100 : 0
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 55 ? 'bg-indigo-500' : pct >= 35 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 w-32 shrink-0 text-xs text-secondary">
        <span className="text-secondary">{componentIcons[name]}</span>
        <span className="capitalize">{name.replace('_', ' ')}</span>
      </div>
      <div className="flex-1 h-2 bg-warm-100 rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }}
          className={`h-full rounded-full ${color}`} />
      </div>
      <span className="text-xs font-bold text-primary w-16 text-right">{score} / {max}</span>
    </div>
  )
}

export default function RepoHealthPanel({ repoId, repoLabel }: Props) {
  const [health, setHealth] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getRepoHealth(repoId).then(setHealth).catch(console.error).finally(() => setLoading(false))
  }, [repoId])

  const grade = health?.grade ?? '—'
  const score = health?.score ?? 0
  const components = health?.components ?? {}

  const radarData = Object.entries(components).map(([key, val]) => ({
    subject: key.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    score: val as number,
    max: componentMaxes[key] ?? 20,
  }))

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 rounded-full border-2 border-indigo-400 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header score card */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-warm-200 bg-white p-6 flex flex-col lg:flex-row items-center gap-8 shadow-sm">
        {/* Grade ring */}
        <div className={`flex h-28 w-28 shrink-0 items-center justify-center rounded-full border-4 ${gradeRing[grade] ?? gradeRing.F}`}>
          <div className="text-center">
            <p className={`text-5xl font-black ${gradeColors[grade] ?? 'text-muted'}`}>{grade}</p>
            <p className="text-xs text-secondary mt-0.5">{score}/100</p>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-primary mb-1">Repository Health Score</h2>
          <p className="text-sm text-secondary mb-4">{repoLabel}</p>
          <div className="space-y-2.5">
            {Object.entries(components).map(([key, val]) => (
              <ScoreBar key={key} name={key} score={val as number} max={componentMaxes[key] ?? 20} />
            ))}
          </div>
        </div>

        {/* Radar chart */}
        {radarData.length > 0 && (
          <div className="shrink-0 w-64 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius={90}>
                <PolarGrid stroke="#e8ddd0" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: '#4B5563' }} />
                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e8ddd0', borderRadius: 12, fontSize: 11, color: '#1A1A1A' }} />
                <Radar name="Score" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </motion.div>

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-warm-200 bg-white p-4 shadow-sm">
          <Shield className="h-4 w-4 text-indigo-500 mb-2" />
          <p className="text-xs text-secondary mb-0.5">Visibility</p>
          <p className="text-sm font-bold text-primary capitalize">{health?.visibility ?? 'unknown'}</p>
        </div>
        <div className="rounded-2xl border border-warm-200 bg-white p-4 shadow-sm">
          <Heart className="h-4 w-4 text-rose-500 mb-2" />
          <p className="text-xs text-secondary mb-0.5">Sync Status</p>
          <p className="text-sm font-bold text-primary">{health?.sync_status ?? '—'}</p>
        </div>
        <div className="rounded-2xl border border-warm-200 bg-white p-4 shadow-sm">
          <Zap className="h-4 w-4 text-amber-500 mb-2" />
          <p className="text-xs text-secondary mb-0.5">Last Synced</p>
          <p className="text-sm font-bold text-primary">
            {health?.last_synced ? new Date(health.last_synced).toLocaleDateString() : 'Never'}
          </p>
        </div>
      </div>
    </div>
  )
}
