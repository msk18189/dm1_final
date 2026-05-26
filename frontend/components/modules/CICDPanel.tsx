'use client'

import { useState, useEffect } from 'react'
import { Zap, CheckCircle2, XCircle, AlertTriangle, Clock, Activity, Play, ShieldAlert, Server } from 'lucide-react'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { getCICDAnalytics, getWorkflowRuns } from '@/lib/api'
import { formatTelemetry } from '@/lib/format'

interface Props { repoId: number; syncStatus?: any }

const conclusionColors: Record<string, string> = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-700 font-bold',
  failure: 'bg-rose-50 border-rose-200 text-rose-700 font-bold',
  cancelled: 'bg-slate-50 border-slate-200 text-slate-500 font-bold',
  skipped: 'bg-slate-50 border-slate-100 text-slate-400',
  default: 'bg-indigo-50 border-indigo-200 text-indigo-750 font-bold',
}

export default function CICDPanel({ repoId, syncStatus }: Props) {
  const [analytics, setAnalytics] = useState<any>(null)
  const [runs, setRuns] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [filterConclusion, setFilterConclusion] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getCICDAnalytics(repoId).then(setAnalytics).catch(console.error).finally(() => setLoading(false))
  }, [repoId])

  useEffect(() => {
    getWorkflowRuns(repoId, page, 20, filterConclusion || undefined).then(setRuns).catch(console.error)
  }, [repoId, page, filterConclusion])

  const summary = analytics?.summary
  const breakdown = analytics?.workflow_breakdown ?? []
  const trend = analytics?.success_trend ?? []

  return (
    <div className="space-y-6">

      {/* KPI Cards row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total Runs', value: syncStatus ? formatTelemetry(syncStatus.synced_workflows || syncStatus.total_workflow_runs, syncStatus.expected_workflows) : (summary ? formatTelemetry(summary.synced_workflows || summary.total_runs, summary.expected_workflows) : '—'), sub: 'Runs (30d)', icon: <Zap className="h-4 w-4 text-indigo-500" />, accent: 'border-indigo-100 bg-indigo-50/40 text-indigo-750' },
          { label: 'Successful', value: (summary?.successful_runs ?? 0).toLocaleString(), sub: 'Passed runs', icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, accent: 'border-emerald-100 bg-emerald-50/40 text-emerald-750' },
          { label: 'Failed', value: (summary?.failed_runs ?? 0).toLocaleString(), sub: 'Errored builds', icon: <XCircle className="h-4 w-4 text-rose-500" />, accent: 'border-rose-100 bg-rose-50/40 text-rose-750' },
          { label: 'Success Rate', value: `${summary?.success_rate ?? 0}%`, sub: 'Reliability metric', icon: <Activity className="h-4 w-4 text-violet-500" />, accent: 'border-violet-100 bg-violet-50/40 text-violet-750' },
          { label: 'Avg Duration', value: `${summary?.avg_duration_minutes ?? 0}m`, sub: 'Average build time', icon: <Clock className="h-4 w-4 text-amber-500" />, accent: 'border-amber-100 bg-amber-50/40 text-amber-750' },
          { label: 'Flaky Workflows', value: summary?.flaky_workflows ?? 0, sub: '&gt; 20% failure rate', icon: <AlertTriangle className="h-4 w-4 text-orange-500" />, accent: 'border-orange-100 bg-orange-50/40 text-orange-750' },
          { label: 'Cancelled', value: (summary?.cancelled_runs ?? 0).toLocaleString(), sub: 'Aborted runs', icon: <XCircle className="h-4 w-4 text-slate-400" />, accent: 'border-slate-200 bg-slate-50/40 text-slate-500' },
        ].map((card) => (
          <div key={card.label} className={`rounded-xl border p-4 shadow-sm flex flex-col justify-between gap-1.5 ${card.accent}`}>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{card.label}</span>
              {card.icon}
            </div>
            <div className="space-y-0.5">
              <span className="text-lg font-black tracking-tight leading-none text-slate-900 block">{card.value}</span>
              <span className="text-[9px] font-semibold text-slate-400">{card.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Charts and workflow breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Trend Area Chart */}
        {trend.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-1">30-Day Success Trend</h3>
            <p className="text-[10px] text-slate-400 font-semibold mb-4">Ingestion health of builds and pipeline runs</p>
            
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trend} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="failureGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11 }} />
                <Legend verticalAlign="top" height={36} iconSize={8} wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
                <Area type="monotone" dataKey="success" name="Passed" stroke="#10b981" strokeWidth={2} fill="url(#successGrad)" />
                <Area type="monotone" dataKey="failure" name="Failed" stroke="#ef4444" strokeWidth={2} fill="url(#failureGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Workflow breakdown list */}
        {breakdown.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Workflow Breakdown</h3>
              <p className="text-[10px] text-slate-400 font-semibold mb-4">Pipeline component metrics & flakiness tracking</p>
            </div>
            
            <div className="space-y-3 max-h-[180px] overflow-y-auto pr-1">
              {breakdown.map((wf: any) => (
                <div key={wf.name} className="flex items-center gap-3">
                  <span className="flex-1 text-xs text-slate-700 font-semibold truncate flex items-center gap-1.5">
                    <Server className="h-3.5 w-3.5 text-slate-400" />
                    {wf.name}
                  </span>
                  <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${wf.success_rate}%` }} />
                  </div>
                  <span className="text-xs font-bold text-slate-900 w-10 text-right">{wf.success_rate}%</span>
                  {wf.is_flaky && (
                    <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-250 px-1.5 py-0.5 rounded font-bold shrink-0 flex items-center gap-0.5">
                      <AlertTriangle className="h-2.5 w-2.5" /> flaky
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent runs table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="text-sm font-bold text-slate-900">Recent Runs</h3>
          <div className="flex gap-1.5">
            {['', 'success', 'failure', 'cancelled'].map((c) => (
              <button key={c || 'all'} onClick={() => { setFilterConclusion(c); setPage(1) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                  filterConclusion === c 
                    ? 'bg-[#fdf2ec] text-[#c2410c] border border-[#fce6d8]' 
                    : 'text-slate-500 hover:text-slate-900 bg-slate-50 border border-slate-200'
                }`}>
                {c || 'All'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Run', 'Name', 'Branch', 'Event', 'Status', 'Duration', 'Date'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs?.data?.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-mono text-slate-450 text-[10px]">#{String(r.id).slice(-6)}</td>
                  <td className="px-4 py-2.5 text-slate-900 font-bold max-w-[160px] truncate">{r.name}</td>
                  <td className="px-4 py-2.5 text-slate-500 font-mono text-[10px]">{r.branch}</td>
                  <td className="px-4 py-2.5 text-slate-650 capitalize">{r.event}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${conclusionColors[r.conclusion] ?? conclusionColors.default}`}>
                      {r.conclusion || r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-650 font-bold">{r.duration_seconds ? `${Math.round(r.duration_seconds / 60)}m` : '—'}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-[10px]">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {!runs?.data?.length && (
                <tr><td colSpan={7} className="py-10 text-center text-slate-400 text-sm">No workflow runs found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {runs?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">&larr; Prev</button>
            <span className="text-xs text-slate-500">Page <span className="font-bold text-slate-900">{page}</span> of <span className="font-bold text-slate-900">{runs?.pages}</span></span>
            <button disabled={page >= runs?.pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">Next &rarr;</button>
          </div>
        )}
      </div>

    </div>
  )
}
