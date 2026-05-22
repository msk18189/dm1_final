'use client'
import { useState, useEffect } from 'react'
import { GitFork, Star, Clock, Activity, TrendingUp } from 'lucide-react'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { getForksAnalytics, getForks } from '@/lib/api'

interface Props { repoId: number }

function StatCard({ icon, label, value, sub, accent }: any) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 flex flex-col gap-2">
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>{icon}</div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs font-semibold text-white/60">{label}</p>
      {sub && <p className="text-[10px] text-white/30">{sub}</p>}
    </motion.div>
  )
}

export default function ForksPanel({ repoId }: Props) {
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
        <StatCard icon={<GitFork className="h-4 w-4 text-indigo-300" />} label="Total Forks" value={(summary?.total_forks ?? 0).toLocaleString()} accent="bg-indigo-500/10" />
        <StatCard icon={<Activity className="h-4 w-4 text-emerald-300" />} label="Active Forks" value={(summary?.active_forks ?? 0).toLocaleString()} sub="≤ 30 days" accent="bg-emerald-500/10" />
        <StatCard icon={<Clock className="h-4 w-4 text-rose-300" />} label="Stale Forks" value={(summary?.stale_forks ?? 0).toLocaleString()} sub="90+ days" accent="bg-rose-500/10" />
        <StatCard icon={<Star className="h-4 w-4 text-amber-300" />} label="Starred Forks" value={(summary?.starred_forks ?? 0).toLocaleString()} accent="bg-amber-500/10" />
        <StatCard icon={<Star className="h-4 w-4 text-yellow-300" />} label="Avg Fork Stars" value={summary?.avg_fork_stars ?? 0} accent="bg-yellow-500/10" />
        <StatCard icon={<TrendingUp className="h-4 w-4 text-violet-300" />} label="Adoption Rate" value={`${summary?.adoption_rate ?? 0}%`} sub="active forks" accent="bg-violet-500/10" />
      </div>

      {growth.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Fork Growth Trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={growth} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#ffffff50' }} />
              <YAxis tick={{ fontSize: 11, fill: '#ffffff50' }} />
              <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid #ffffff10', borderRadius: 12 }} />
              <Bar dataKey="new_forks" name="New Forks" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-white">Fork Ecosystem</h3>
          <div className="flex gap-1.5">
            {['all', 'active', 'stale'].map(f => (
              <button key={f} onClick={() => { setFilter(f); setPage(1) }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-all ${filter === f ? 'bg-indigo-600 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]'}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.05]">
                {['Fork', 'Owner', 'Stars', 'Language', 'Activity', 'Last Push'].map(h => (
                  <th key={h} className="pb-2 text-left font-semibold text-white/35 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {forks?.data?.map((f: any) => (
                <tr key={f.full_name} className="hover:bg-white/[0.02]">
                  <td className="py-2.5 pr-4 font-mono text-white/70 max-w-[200px] truncate">{f.full_name}</td>
                  <td className="py-2.5 pr-4 text-white/50">{f.owner}</td>
                  <td className="py-2.5 pr-4 text-white/70 flex items-center gap-1"><Star className="h-2.5 w-2.5 text-amber-400" /> {f.stars}</td>
                  <td className="py-2.5 pr-4 text-white/40">{f.language || '—'}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${f.activity === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-white/30'}`}>
                      {f.activity}
                    </span>
                  </td>
                  <td className="py-2.5 text-white/35 text-[10px]">{f.pushed_at ? new Date(f.pushed_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {!forks?.data?.length && (
                <tr><td colSpan={6} className="py-10 text-center text-white/30 text-sm">No forks found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {forks?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/[0.04]">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30">← Prev</button>
            <span className="text-xs text-white/30">Page {page} of {forks?.pages}</span>
            <button disabled={page >= forks?.pages} onClick={() => setPage(p => p + 1)} className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
