'use client'
import { useState, useEffect } from 'react'
import { GitFork, Star, Clock, Activity, TrendingUp } from 'lucide-react'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { getForksAnalytics, getForks } from '@/lib/api'
import { formatTelemetry } from '@/lib/format'

interface Props { repoId: number; syncStatus?: any }

function StatCard({ icon, label, value, sub, accent }: any) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-warm-200 bg-white p-5 flex flex-col gap-2 shadow-sm">
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>{icon}</div>
      <p className="text-2xl font-bold text-primary">{value}</p>
      <p className="text-xs font-semibold text-secondary">{label}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </motion.div>
  )
}

export default function ForksPanel({ repoId, syncStatus }: Props) {
  const [analytics, setAnalytics] = useState<any>(null)
  const [forks, setForks] = useState<any>(null)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getForksAnalytics(repoId).then(setAnalytics).catch(console.error).finally(() => setLoading(false))
  }, [repoId])

  useEffect(() => {
    getForks(repoId, page, 20, filter).then(setForks).catch(console.error)
  }, [repoId, page, filter])

  useEffect(() => {
    if (forks?.data) {
      console.log(`[Telemetry][Frontend] Rendered ${forks.data.length} forks in filter ${filter}`)
    }
  }, [forks, filter])

  const summary = analytics?.summary
  const growth = analytics?.growth_trend ?? []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={<GitFork className="h-4 w-4 text-indigo-500" />} label="Total Forks" value={syncStatus ? formatTelemetry(syncStatus.synced_forks || syncStatus.total_forks, syncStatus.expected_forks) : (summary ? formatTelemetry(summary.synced_forks || summary.total_forks, summary.expected_forks) : '—')} accent="bg-indigo-50" />
        <StatCard icon={<Activity className="h-4 w-4 text-emerald-600" />} label="Active Forks" value={(summary?.active_forks ?? 0).toLocaleString()} sub="≤ 30 days" accent="bg-emerald-50" />
        <StatCard icon={<Clock className="h-4 w-4 text-rose-500" />} label="Stale Forks" value={(summary?.stale_forks ?? 0).toLocaleString()} sub="90+ days" accent="bg-rose-50" />
        <StatCard icon={<Star className="h-4 w-4 text-amber-600" />} label="Starred Forks" value={(summary?.starred_forks ?? 0).toLocaleString()} accent="bg-amber-50" />
        <StatCard icon={<Star className="h-4 w-4 text-amber-500" />} label="Avg Fork Stars" value={summary?.avg_fork_stars ?? 0} accent="bg-amber-50" />
        <StatCard icon={<TrendingUp className="h-4 w-4 text-violet-500" />} label="Adoption Rate" value={`${summary?.adoption_rate ?? 0}%`} sub="active forks" accent="bg-violet-50" />
      </div>

      {growth.length > 0 && (
        <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-primary mb-4">Fork Growth Trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={growth} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#4B5563' }} />
              <YAxis tick={{ fontSize: 11, fill: '#4B5563' }} />
              <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #E8DDD0', borderRadius: 12, color: '#1A1A1A' }} />
              <Bar dataKey="new_forks" name="New Forks" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-primary">Fork Ecosystem</h3>
          <div className="flex gap-1.5">
            {['all', 'active', 'stale'].map(f => (
              <button key={f} onClick={() => { setFilter(f); setPage(1) }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-all ${filter === f ? 'bg-indigo-600 text-white' : 'text-secondary hover:text-primary hover:bg-warm-50 bg-white border border-warm-200'}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-warm-200">
                {['Fork', 'Owner', 'Stars', 'Language', 'Activity', 'Last Push'].map(h => (
                  <th key={h} className="pb-2 text-left font-semibold text-secondary pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-100">
              {forks?.data?.map((f: any) => (
                <tr key={f.full_name} className="hover:bg-warm-50/50">
                  <td className="py-2.5 pr-4 font-mono text-primary font-medium max-w-[200px] truncate">{f.full_name}</td>
                  <td className="py-2.5 pr-4 text-secondary">{f.owner}</td>
                  <td className="py-2.5 pr-4 text-secondary flex items-center gap-1"><Star className="h-2.5 w-2.5 text-amber-500" /> {f.stars}</td>
                  <td className="py-2.5 pr-4 text-secondary">{f.language || '—'}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${f.activity === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-warm-100 text-secondary'}`}>
                      {f.activity}
                    </span>
                  </td>
                  <td className="py-2.5 text-muted text-[10px]">{f.pushed_at ? new Date(f.pushed_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {!forks?.data?.length && (
                <tr><td colSpan={6} className="py-10 text-center text-muted text-sm">No forks found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {forks?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-warm-200">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">← Prev</button>
            <span className="text-xs text-secondary">Page <span className="font-semibold text-primary">{page}</span> of <span className="font-semibold text-primary">{forks?.pages}</span></span>
            <button disabled={page >= forks?.pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
