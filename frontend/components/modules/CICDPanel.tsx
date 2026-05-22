'use client'
import { useState, useEffect } from 'react'
import { Zap, CheckCircle2, XCircle, AlertTriangle, Clock, Activity } from 'lucide-react'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts'
import { getCICDAnalytics, getWorkflowRuns } from '@/lib/api'

interface Props { repoId: number }

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

const conclusionColors: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-800',
  failure: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-warm-100 text-secondary',
  skipped: 'bg-warm-100 text-muted',
  default: 'bg-indigo-100 text-indigo-800',
}

export default function CICDPanel({ repoId }: Props) {
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

  useEffect(() => {
    if (runs?.data) {
      console.log(`[Telemetry][Frontend] Rendered ${runs.data.length} workflow runs in conclusion filter ${filterConclusion || 'all'}`)
    }
  }, [runs, filterConclusion])

  const summary = analytics?.summary
  const breakdown = analytics?.workflow_breakdown ?? []
  const trend = analytics?.success_trend ?? []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard icon={<Zap className="h-4 w-4 text-indigo-500" />} label="Total Runs" value={(summary?.total_runs ?? 0).toLocaleString()} accent="bg-indigo-50" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} label="Successful" value={(summary?.successful_runs ?? 0).toLocaleString()} accent="bg-emerald-50" />
        <StatCard icon={<XCircle className="h-4 w-4 text-rose-500" />} label="Failed" value={(summary?.failed_runs ?? 0).toLocaleString()} accent="bg-rose-50" />
        <StatCard icon={<Activity className="h-4 w-4 text-violet-500" />} label="Success Rate" value={`${summary?.success_rate ?? 0}%`} accent="bg-violet-50" />
        <StatCard icon={<Clock className="h-4 w-4 text-amber-500" />} label="Avg Duration" value={`${summary?.avg_duration_minutes ?? 0}m`} sub="successful runs" accent="bg-amber-50" />
        <StatCard icon={<AlertTriangle className="h-4 w-4 text-orange-500" />} label="Flaky Workflows" value={summary?.flaky_workflows ?? 0} sub="> 20% failure rate" accent="bg-orange-50" />
        <StatCard icon={<XCircle className="h-4 w-4 text-secondary" />} label="Cancelled" value={(summary?.cancelled_runs ?? 0).toLocaleString()} accent="bg-warm-100" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {trend.length > 0 && (
          <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-primary mb-4">30-Day Success Trend</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8ddd0" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#4B5563' }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 9, fill: '#4B5563' }} />
                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e8ddd0', borderRadius: 12, fontSize: 11, color: '#1A1A1A' }} />
                <Line type="monotone" dataKey="success" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="failure" stroke="#f43f5e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {breakdown.length > 0 && (
          <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-primary mb-4">Workflow Breakdown</h3>
            <div className="space-y-2 max-h-[180px] overflow-y-auto">
              {breakdown.map((wf: any) => (
                <div key={wf.name} className="flex items-center gap-3">
                  <span className="flex-1 text-xs text-secondary truncate">{wf.name}</span>
                  <div className="w-24 h-1.5 bg-warm-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${wf.success_rate}%` }} />
                  </div>
                  <span className="text-xs font-bold text-primary w-10 text-right">{wf.success_rate}%</span>
                  {wf.is_flaky && <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-primary">Recent Runs</h3>
          <div className="flex gap-1.5">
            {['', 'success', 'failure', 'cancelled'].map((c) => (
              <button key={c || 'all'} onClick={() => { setFilterConclusion(c); setPage(1) }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all ${filterConclusion === c ? 'bg-indigo-600 text-white' : 'text-secondary hover:text-primary hover:bg-warm-50 bg-warm-100/50'}`}>
                {c || 'All'}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-warm-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-warm-200 bg-warm-50/50">
                {['Run', 'Name', 'Branch', 'Event', 'Status', 'Duration', 'Date'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-100">
              {runs?.data?.map((r: any) => (
                <tr key={r.id} className="hover:bg-warm-50/40">
                  <td className="px-4 py-2 font-mono text-muted text-[10px]">#{String(r.id).slice(-6)}</td>
                  <td className="px-4 py-2 text-primary max-w-[160px] truncate">{r.name}</td>
                  <td className="px-4 py-2 text-secondary font-mono text-[10px]">{r.branch}</td>
                  <td className="px-4 py-2 text-secondary capitalize">{r.event}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${conclusionColors[r.conclusion] ?? conclusionColors.default}`}>
                      {r.conclusion || r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-secondary">{r.duration_seconds ? `${Math.round(r.duration_seconds / 60)}m` : '—'}</td>
                  <td className="px-4 py-2 text-muted text-[10px]">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {!runs?.data?.length && (
                <tr><td colSpan={7} className="py-10 text-center text-muted text-sm">No workflow runs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {runs?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-warm-200">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">← Prev</button>
            <span className="text-xs text-secondary">Page <span className="font-semibold text-primary">{page}</span> of <span className="font-semibold text-primary">{runs?.pages}</span></span>
            <button disabled={page >= runs?.pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
