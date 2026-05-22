'use client'
import { useState, useEffect } from 'react'
import { GitBranch, Shield, Clock, Activity, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'
import { getBranchesAnalytics, getBranches } from '@/lib/api'

interface Props { repoId: number }

const FILTERS = ['all', 'active', 'protected', 'stale'] as const

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

const healthColors: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400',
  moderate: 'bg-amber-500/10 text-amber-400',
  inactive: 'bg-orange-500/10 text-orange-400',
  stale: 'bg-rose-500/10 text-rose-400',
  unknown: 'bg-white/5 text-white/30',
}

export default function BranchesPanel({ repoId }: Props) {
  const [summary, setSummary] = useState<any>(null)
  const [branches, setBranches] = useState<any>(null)
  const [filter, setFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getBranchesAnalytics(repoId).then(setSummary).catch(console.error).finally(() => setLoading(false))
  }, [repoId])

  useEffect(() => {
    getBranches(repoId, page, 20, filter).then(setBranches).catch(console.error)
  }, [repoId, page, filter])

  useEffect(() => {
    if (branches?.data) {
      console.log(`[Telemetry][Frontend] Rendered ${branches.data.length} branches in filter ${filter}`)
    }
  }, [branches, filter])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={<GitBranch className="h-4 w-4 text-indigo-300" />} label="Total Branches" value={(summary?.total_branches ?? 0).toLocaleString()} accent="bg-indigo-500/10" />
        <StatCard icon={<Activity className="h-4 w-4 text-emerald-300" />} label="Active" value={(summary?.active_branches ?? 0).toLocaleString()} sub="≤ 7 days" accent="bg-emerald-500/10" />
        <StatCard icon={<Shield className="h-4 w-4 text-violet-300" />} label="Protected" value={(summary?.protected_branches ?? 0).toLocaleString()} accent="bg-violet-500/10" />
        <StatCard icon={<Clock className="h-4 w-4 text-amber-300" />} label="Inactive" value={(summary?.inactive_branches ?? 0).toLocaleString()} sub="30+ days" accent="bg-amber-500/10" />
        <StatCard icon={<AlertTriangle className="h-4 w-4 text-rose-300" />} label="Stale" value={(summary?.stale_branches ?? 0).toLocaleString()} sub="90+ days" accent="bg-rose-500/10" />
        <StatCard icon={<AlertTriangle className="h-4 w-4 text-orange-300" />} label="Stale Rate" value={`${summary?.stale_rate ?? 0}%`} accent="bg-orange-500/10" />
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-white">Branch List</h3>
          <div className="flex gap-1.5">
            {FILTERS.map(f => (
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
                {['Branch', 'Health', 'Protected', 'Last Commit', 'Author', 'Days Stale'].map(h => (
                  <th key={h} className="pb-2 text-left font-semibold text-white/35 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {branches?.data?.map((b: any) => (
                <tr key={b.name} className="hover:bg-white/[0.02]">
                  <td className="py-2.5 pr-4 font-mono text-white/80 max-w-[200px] truncate">{b.name}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${healthColors[b.health] ?? healthColors.unknown}`}>
                      {b.health}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4">
                    {b.protected ? <Shield className="h-3.5 w-3.5 text-violet-400" /> : <span className="text-white/20">—</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-white/40 max-w-[200px] truncate" title={b.last_commit_message}>{b.last_commit_message || '—'}</td>
                  <td className="py-2.5 pr-4 text-white/50">{b.last_commit_author || '—'}</td>
                  <td className="py-2.5 text-white/50">{b.staleness_days ?? '—'}</td>
                </tr>
              ))}
              {!branches?.data?.length && (
                <tr><td colSpan={6} className="py-10 text-center text-white/30 text-sm">No branches found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {branches?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/[0.04]">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30">← Prev</button>
            <span className="text-xs text-white/30">Page {page} of {branches?.pages}</span>
            <button disabled={page >= branches?.pages} onClick={() => setPage(p => p + 1)} className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
