'use client'
import { useState, useEffect } from 'react'
import { CircleDot, Bug, Clock, TrendingDown, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { motion } from 'framer-motion'
import { getIssuesAnalytics, getIssues, getStaleIssues } from '@/lib/api'

interface Props { repoId: number }

const TABS = ['All Issues', 'Stale Issues'] as const
type Tab = typeof TABS[number]

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

export default function IssuesPanel({ repoId }: Props) {
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
        <StatCard icon={<CircleDot className="h-4 w-4 text-indigo-300" />} label="Total Issues" value={(summary?.total_issues ?? 0).toLocaleString()} accent="bg-indigo-500/10" />
        <StatCard icon={<CircleDot className="h-4 w-4 text-emerald-300" />} label="Open" value={(summary?.open_issues ?? 0).toLocaleString()} accent="bg-emerald-500/10" />
        <StatCard icon={<CircleDot className="h-4 w-4 text-slate-300" />} label="Closed" value={(summary?.closed_issues ?? 0).toLocaleString()} accent="bg-white/10" />
        <StatCard icon={<AlertTriangle className="h-4 w-4 text-amber-300" />} label="Stale (30d+)" value={(summary?.stale_issues ?? 0).toLocaleString()} accent="bg-amber-500/10" />
        <StatCard icon={<Bug className="h-4 w-4 text-rose-300" />} label="Bug Reports" value={(summary?.bug_count ?? 0).toLocaleString()} accent="bg-rose-500/10" />
        <StatCard icon={<Clock className="h-4 w-4 text-violet-300" />} label="Avg Resolution" value={`${summary?.avg_resolution_days ?? 0}d`} sub="time to close" accent="bg-violet-500/10" />
      </div>

      {/* Velocity chart */}
      {velocity.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Issue Resolution Velocity</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={velocity} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#ffffff50' }} />
              <YAxis tick={{ fontSize: 11, fill: '#ffffff50' }} />
              <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid #ffffff10', borderRadius: 12 }} />
              <Bar dataKey="opened" name="Opened" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="closed" name="Closed" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Issues table */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1.5">
            {TABS.map(t => (
              <button key={t} onClick={() => { setTab(t); setPage(1) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === t ? 'bg-indigo-600 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.05]">
                {['#', 'Title', 'State', 'Author', 'Age', 'Comments'].map(h => (
                  <th key={h} className="pb-2 text-left font-semibold text-white/35 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {(tab === 'All Issues' ? issues?.data : stale?.data)?.map((iss: any) => (
                <tr key={iss.number} className="group hover:bg-white/[0.02]">
                  <td className="py-2.5 pr-4 font-mono text-white/40">#{iss.number}</td>
                  <td className="py-2.5 pr-4 max-w-[280px]">
                    <span className="font-medium text-white/85 line-clamp-1">{iss.title}</span>
                    {iss.is_bug && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400">bug</span>}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${iss.state === 'open' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-white/30'}`}>
                      {iss.state}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-white/50">{iss.author}</td>
                  <td className="py-2.5 pr-4 text-white/50">{iss.age_days}d</td>
                  <td className="py-2.5 text-white/50">{iss.comment_count}</td>
                </tr>
              ))}
              {!(tab === 'All Issues' ? issues?.data : stale?.data)?.length && (
                <tr><td colSpan={6} className="py-10 text-center text-white/30 text-sm">No issues found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {(tab === 'All Issues' ? issues : stale)?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/[0.04]">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30">← Prev</button>
            <span className="text-xs text-white/30">Page {page} of {(tab === 'All Issues' ? issues : stale)?.pages}</span>
            <button disabled={page >= (tab === 'All Issues' ? issues : stale)?.pages} onClick={() => setPage(p => p + 1)}
              className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
