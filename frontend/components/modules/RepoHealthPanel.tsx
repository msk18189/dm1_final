'use client'
import { useEffect, useState } from 'react'
import { Heart, Shield, Zap, GitPullRequest, CircleDot, GitBranch, MessageCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { getRepoHealth } from '@/lib/api'

interface Props { repoId: number; repoLabel: string }

const gradeColors: Record<string, string> = {
  A: 'text-emerald-400', B: 'text-indigo-400', C: 'text-amber-400', D: 'text-orange-400', F: 'text-rose-400',
}
const gradeRing: Record<string, string> = {
  A: 'border-emerald-500/40 bg-emerald-500/10',
  B: 'border-indigo-500/40 bg-indigo-500/10',
  C: 'border-amber-500/40 bg-amber-500/10',
  D: 'border-orange-500/40 bg-orange-500/10',
  F: 'border-rose-500/40 bg-rose-500/10',
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
      <div className="flex items-center gap-1.5 w-32 shrink-0 text-xs text-white/60">
        <span className="text-white/40">{componentIcons[name]}</span>
        <span className="capitalize">{name.replace('_', ' ')}</span>
      </div>
      <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }}
          className={`h-full rounded-full ${color}`} />
      </div>
      <span className="text-xs font-bold text-white/70 w-16 text-right">{score} / {max}</span>
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
        className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 flex flex-col lg:flex-row items-center gap-8">
        {/* Grade ring */}
        <div className={`flex h-28 w-28 shrink-0 items-center justify-center rounded-full border-4 ${gradeRing[grade] ?? gradeRing.F}`}>
          <div className="text-center">
            <p className={`text-5xl font-black ${gradeColors[grade] ?? 'text-white/30'}`}>{grade}</p>
            <p className="text-xs text-white/30 mt-0.5">{score}/100</p>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-white mb-1">Repository Health Score</h2>
          <p className="text-sm text-white/40 mb-4">{repoLabel}</p>
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
                <PolarGrid stroke="#ffffff0a" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: '#ffffff50' }} />
                <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid #ffffff10', borderRadius: 12, fontSize: 11 }} />
                <Radar name="Score" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
      </motion.div>

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <Shield className="h-4 w-4 text-indigo-300 mb-2" />
          <p className="text-xs text-white/40 mb-0.5">Visibility</p>
          <p className="text-sm font-bold text-white capitalize">{health?.visibility ?? 'unknown'}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <Heart className="h-4 w-4 text-rose-300 mb-2" />
          <p className="text-xs text-white/40 mb-0.5">Sync Status</p>
          <p className="text-sm font-bold text-white">{health?.sync_status ?? '—'}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <Zap className="h-4 w-4 text-amber-300 mb-2" />
          <p className="text-xs text-white/40 mb-0.5">Last Synced</p>
          <p className="text-sm font-bold text-white">
            {health?.last_synced ? new Date(health.last_synced).toLocaleDateString() : 'Never'}
          </p>
        </div>
      </div>
    </div>
  )
}
