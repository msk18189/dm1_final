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
      className="rounded-2xl border border-warm-200 bg-white p-5 flex flex-col gap-2 shadow-sm">
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>{icon}</div>
      <p className="text-2xl font-bold text-primary">{value}</p>
      <p className="text-xs font-semibold text-secondary">{label}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </motion.div>
  )
}

const healthColors: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  moderate: 'bg-amber-100 text-amber-800',
  inactive: 'bg-orange-100 text-orange-800',
  stale: 'bg-rose-100 text-rose-800',
  unknown: 'bg-warm-100 text-secondary',
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
        <StatCard icon={<GitBranch className="h-4 w-4 text-indigo-500" />} label="Total Branches" value={(summary?.total_branches ?? 0).toLocaleString()} accent="bg-indigo-50" />
        <StatCard icon={<Activity className="h-4 w-4 text-emerald-500" />} label="Active" value={(summary?.active_branches ?? 0).toLocaleString()} sub="≤ 7 days" accent="bg-emerald-50" />
        <StatCard icon={<Shield className="h-4 w-4 text-violet-500" />} label="Protected" value={(summary?.protected_branches ?? 0).toLocaleString()} accent="bg-violet-50" />
        <StatCard icon={<Clock className="h-4 w-4 text-amber-500" />} label="Inactive" value={(summary?.inactive_branches ?? 0).toLocaleString()} sub="30+ days" accent="bg-amber-50" />
        <StatCard icon={<AlertTriangle className="h-4 w-4 text-rose-500" />} label="Stale" value={(summary?.stale_branches ?? 0).toLocaleString()} sub="90+ days" accent="bg-rose-50" />
        <StatCard icon={<AlertTriangle className="h-4 w-4 text-orange-500" />} label="Stale Rate" value={`${summary?.stale_rate ?? 0}%`} accent="bg-orange-50" />
      </div>

      <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-primary">Branch List</h3>
          <div className="flex gap-1.5">
            {FILTERS.map(f => (
              <button key={f} onClick={() => { setFilter(f); setPage(1) }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-all ${filter === f ? 'bg-indigo-600 text-white' : 'text-secondary hover:text-primary hover:bg-warm-50 bg-warm-100/50'}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-warm-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-warm-200 bg-warm-50/50">
                {['Branch', 'Health', 'Protected', 'Last Commit', 'Author', 'Days Stale'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-100">
              {branches?.data?.map((b: any) => (
                <tr key={b.name} className="hover:bg-warm-50/40">
                  <td className="px-4 py-2.5 font-mono text-primary text-xs max-w-[200px] truncate">{b.name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${healthColors[b.health] ?? healthColors.unknown}`}>
                      {b.health}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {b.protected ? <Shield className="h-3.5 w-3.5 text-violet-600" /> : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-secondary text-xs max-w-[200px] truncate" title={b.last_commit_message}>{b.last_commit_message || '—'}</td>
                  <td className="px-4 py-2.5 text-secondary text-xs">{b.last_commit_author || '—'}</td>
                  <td className="px-4 py-2.5 text-secondary text-xs">{b.staleness_days ?? '—'}</td>
                </tr>
              ))}
              {!branches?.data?.length && (
                <tr><td colSpan={6} className="py-10 text-center text-muted text-sm">No branches found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {branches?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-warm-200">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">← Prev</button>
            <span className="text-xs text-secondary">Page <span className="font-semibold text-primary">{page}</span> of <span className="font-semibold text-primary">{branches?.pages}</span></span>
            <button disabled={page >= branches?.pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
