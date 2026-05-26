'use client'
import { useState, useEffect } from 'react'
import { CircleDot, Bug, Clock, TrendingDown, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { motion } from 'framer-motion'
import { getIssuesAnalytics, getIssues, getStaleIssues } from '@/lib/api'
import { formatTelemetry } from '@/lib/format'

interface Props { repoId: number; syncStatus?: any }

const TABS = ['All Issues', 'Stale Issues'] as const
type Tab = typeof TABS[number]

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

export default function IssuesPanel({ repoId, syncStatus }: Props) {
  const [analytics, setAnalytics] = useState<any>(null)
  const [issues, setIssues] = useState<any>(null)
  const [stale, setStale] = useState<any>(null)
  const [tab, setTab] = useState<Tab>('All Issues')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([getIssuesAnalytics(repoId), getIssues(repoId, 1), getStaleIssues(repoId)])
      .then(([a, i, s]) => { setAnalytics(a); setIssues(i); setStale(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [repoId])

  useEffect(() => {
    if (tab === 'All Issues') {
      getIssues(repoId, page).then(setIssues).catch(console.error)
    } else {
      getStaleIssues(repoId, 30, page).then(setStale).catch(console.error)
    }
  }, [page, tab, repoId])

  useEffect(() => {
    const currentData = tab === 'All Issues' ? issues?.data : stale?.data
    if (currentData) {
      console.log(`[Telemetry][Frontend] Rendered ${currentData.length} issues in tab ${tab}`)
    }
  }, [issues, stale, tab])

  const summary = analytics?.summary
  const velocity = analytics?.velocity || []

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={<CircleDot className="h-4 w-4 text-indigo-500" />} label="Total Issues" value={syncStatus ? formatTelemetry(syncStatus.synced_issues || syncStatus.total_issues, syncStatus.expected_issues) : (summary ? formatTelemetry(summary.synced_issues || summary.total_issues, summary.expected_issues) : '—')} accent="bg-indigo-50" />
        <StatCard icon={<CircleDot className="h-4 w-4 text-emerald-500" />} label="Open" value={(summary?.open_issues ?? 0).toLocaleString()} accent="bg-emerald-50" />
        <StatCard icon={<CircleDot className="h-4 w-4 text-secondary" />} label="Closed" value={(summary?.closed_issues ?? 0).toLocaleString()} accent="bg-warm-100" />
        <StatCard icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} label="Stale (30d+)" value={(summary?.stale_issues ?? 0).toLocaleString()} accent="bg-amber-50" />
        <StatCard icon={<Bug className="h-4 w-4 text-rose-500" />} label="Bug Reports" value={(summary?.bug_count ?? 0).toLocaleString()} accent="bg-rose-50" />
        <StatCard icon={<Clock className="h-4 w-4 text-violet-500" />} label="Avg Resolution" value={`${summary?.avg_resolution_days ?? 0}d`} sub="time to close" accent="bg-violet-50" />
      </div>

      {/* Velocity chart */}
      {velocity.length > 0 && (
        <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-primary mb-4">Issue Resolution Velocity</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={velocity} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8ddd0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#4B5563' }} />
              <YAxis tick={{ fontSize: 11, fill: '#4B5563' }} />
              <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e8ddd0', borderRadius: 12, color: '#1A1A1A' }} />
              <Bar dataKey="opened" name="Opened" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="closed" name="Closed" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Issues table */}
      <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1.5">
            {TABS.map(t => (
              <button key={t} onClick={() => { setTab(t); setPage(1) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === t ? 'bg-indigo-600 text-white' : 'text-secondary hover:text-primary hover:bg-warm-50 bg-warm-100/50'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-warm-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-warm-200 bg-warm-50/50">
                {['#', 'Title', 'State', 'Author', 'Age', 'Comments'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-100">
              {(tab === 'All Issues' ? issues?.data : stale?.data)?.map((iss: any) => (
                <tr key={iss.number} className="group hover:bg-warm-50/40">
                  <td className="px-4 py-2.5 font-mono text-muted text-xs">#{iss.number}</td>
                  <td className="px-4 py-2.5 max-w-[280px]">
                    <span className="font-medium text-primary text-xs line-clamp-1">{iss.title}</span>
                    {iss.is_bug && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-600">bug</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${iss.state === 'open' ? 'bg-emerald-100 text-emerald-800' : 'bg-warm-150 text-secondary'}`}>
                      {iss.state}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-secondary text-xs">{iss.author}</td>
                  <td className="px-4 py-2.5 text-secondary text-xs">{iss.age_days}d</td>
                  <td className="px-4 py-2.5 text-secondary text-xs">{iss.comment_count}</td>
                </tr>
              ))}
              {!(tab === 'All Issues' ? issues?.data : stale?.data)?.length && (
                <tr><td colSpan={6} className="py-10 text-center text-muted text-sm">No issues found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {(tab === 'All Issues' ? issues : stale)?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-warm-200">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">← Prev</button>
            <span className="text-xs text-secondary">Page <span className="font-semibold text-primary">{page}</span> of <span className="font-semibold text-primary">{(tab === 'All Issues' ? issues : stale)?.pages}</span></span>
            <button disabled={page >= (tab === 'All Issues' ? issues : stale)?.pages} onClick={() => setPage(p => p + 1)}
              className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
