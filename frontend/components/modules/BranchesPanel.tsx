'use client'

import { useState, useEffect } from 'react'
import { GitBranch, Shield, Clock, Activity, AlertTriangle, ChevronRight, RefreshCw, GitFork, BookOpen } from 'lucide-react'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { getBranchesAnalytics, getBranches } from '@/lib/api'

interface Props { repoId: number }

const FILTERS = ['all', 'active', 'protected', 'stale'] as const

const healthColors: Record<string, string> = {
  active: 'bg-emerald-50 border-emerald-200 text-emerald-700 font-bold',
  moderate: 'bg-amber-50 border-amber-200 text-amber-700 font-bold',
  inactive: 'bg-orange-50 border-orange-200 text-orange-700 font-bold',
  stale: 'bg-rose-50 border-rose-200 text-rose-700 font-bold',
  unknown: 'bg-slate-50 border-slate-200 text-slate-500',
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

  // Map summary numbers to a beautiful bar chart representation
  const chartData = summary ? [
    { name: 'Active', count: summary.active_branches ?? 0, color: '#10b981' },
    { name: 'Protected', count: summary.protected_branches ?? 0, color: '#6366f1' },
    { name: 'Inactive', count: summary.inactive_branches ?? 0, color: '#f59e0b' },
    { name: 'Stale', count: summary.stale_branches ?? 0, color: '#ef4444' },
  ] : []

  return (
    <div className="space-y-6">

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Branches', value: summary?.total_branches ?? 0, sub: 'Repository total', icon: <GitBranch className="h-4 w-4 text-indigo-500" />, accent: 'border-indigo-100 bg-indigo-50/40 text-indigo-750' },
          { label: 'Active', value: summary?.active_branches ?? 0, sub: 'Commits <= 7 days', icon: <Activity className="h-4 w-4 text-emerald-500" />, accent: 'border-emerald-100 bg-emerald-50/40 text-emerald-750' },
          { label: 'Protected', value: summary?.protected_branches ?? 0, sub: 'Merge rules apply', icon: <Shield className="h-4 w-4 text-purple-500" />, accent: 'border-purple-100 bg-purple-50/40 text-purple-750' },
          { label: 'Inactive', value: summary?.inactive_branches ?? 0, sub: '30+ days stale', icon: <Clock className="h-4 w-4 text-amber-500" />, accent: 'border-amber-100 bg-amber-50/40 text-amber-750' },
          { label: 'Stale', value: summary?.stale_branches ?? 0, sub: '90+ days stale', icon: <AlertTriangle className="h-4 w-4 text-rose-500" />, accent: 'border-rose-100 bg-rose-50/40 text-rose-750' },
          { label: 'Stale Rate', value: `${summary?.stale_rate ?? 0}%`, sub: 'Backlog proportion', icon: <AlertTriangle className="h-4 w-4 text-orange-500" />, accent: 'border-orange-100 bg-orange-50/40 text-orange-750' },
        ].map((card) => (
          <div key={card.label} className={`rounded-xl border p-4 shadow-sm flex flex-col justify-between gap-1.5 ${card.accent}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{card.label}</span>
              {card.icon}
            </div>
            <div className="space-y-0.5">
              <span className="text-xl font-black tracking-tight leading-none text-slate-900 block">{card.value.toLocaleString()}</span>
              <span className="text-[9px] font-semibold text-slate-400">{card.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Branch breakdown bar chart */}
      {summary && summary.total_branches > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Branch Activity Breakdown</h3>
          <p className="text-[10px] text-slate-400 font-semibold mb-4">Total active versus stale codebase pathways</p>
          
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11 }} />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Branch list */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-sm font-bold text-slate-900">Branch List</h3>
          <div className="flex gap-1.5">
            {FILTERS.map(f => (
              <button key={f} onClick={() => { setFilter(f); setPage(1) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                  filter === f 
                    ? 'bg-[#fdf2ec] text-[#c2410c] border border-[#fce6d8]' 
                    : 'text-slate-500 hover:text-slate-900 bg-slate-50 border border-slate-200'
                }`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Branch', 'Health Status', 'Protected', 'Last Commit Message', 'Author', 'Days Stale'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {branches?.data?.map((b: any) => (
                <tr key={b.name} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-mono text-slate-900 text-xs font-bold max-w-[200px] truncate">
                    <div className="flex items-center gap-1.5">
                      <GitBranch className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>{b.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${healthColors[b.health] ?? healthColors.unknown}`}>
                      {b.health}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {b.protected ? (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-purple-50 text-purple-750 font-bold border border-purple-200 px-2 py-0.5 rounded-full">
                        <Shield className="h-3 w-3 shrink-0" /> Yes
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-650 text-xs max-w-[220px] truncate" title={b.last_commit_message}>{b.last_commit_message || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs font-semibold">{b.last_commit_author || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs font-bold">{b.staleness_days ?? '—'}</td>
                </tr>
              ))}
              {!branches?.data?.length && (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400 text-sm">No branches found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {branches?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">&larr; Prev</button>
            <span className="text-xs text-slate-500">Page <span className="font-bold text-slate-900">{page}</span> of <span className="font-bold text-slate-900">{branches?.pages}</span></span>
            <button disabled={page >= branches?.pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">Next &rarr;</button>
          </div>
        )}
      </div>

    </div>
  )
}
