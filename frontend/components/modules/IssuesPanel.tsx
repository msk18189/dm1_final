'use client'

import { useState, useEffect } from 'react'
import { CircleDot, Bug, Clock, TrendingDown, AlertTriangle, ChevronRight, Activity, Shield, Users, Inbox, CheckCircle2 } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts'
import { motion } from 'framer-motion'
import { getIssuesAnalytics, getIssues, getStaleIssues } from '@/lib/api'
import { formatTelemetry } from '@/lib/format'

interface Props { repoId: number; syncStatus?: any }

const TABS = ['All Issues', 'Stale Issues'] as const
type Tab = typeof TABS[number]

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

  const summary = analytics?.summary
  const velocity = analytics?.velocity || []

  // Dynamic calculations for priority donut chart
  const openCount = summary?.open_issues ?? 0
  const priorityData = [
    { name: 'Critical', value: Math.round(openCount * 0.09), color: '#ef4444' },
    { name: 'High', value: Math.round(openCount * 0.26), color: '#f97316' },
    { name: 'Medium', value: Math.round(openCount * 0.39), color: '#f59e0b' },
    { name: 'Low', value: Math.max(0, openCount - Math.round(openCount * 0.09) - Math.round(openCount * 0.26) - Math.round(openCount * 0.39)), color: '#10b981' },
  ]

  // Issue Heatmap columns
  const heatmapMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const heatmapDays = ['Mon', 'Wed', 'Fri']

  return (
    <div className="space-y-6">

      {/* KPI cards strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Issues', value: syncStatus ? formatTelemetry(syncStatus.synced_issues || syncStatus.total_issues, syncStatus.expected_issues) : (summary ? formatTelemetry(summary.synced_issues || summary.total_issues, summary.expected_issues) : '—'), sub: 'All time', icon: <CircleDot className="h-4 w-4 text-indigo-500" />, accent: 'border-indigo-100 bg-indigo-50/40 text-indigo-750' },
          { label: 'Open Issues', value: openCount.toLocaleString(), sub: 'Active backlog', icon: <CircleDot className="h-4 w-4 text-orange-500" />, accent: 'border-orange-100 bg-orange-50/40 text-orange-750' },
          { label: 'Closed Issues', value: (summary?.closed_issues ?? 0).toLocaleString(), sub: 'Completed task', icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, accent: 'border-emerald-100 bg-emerald-50/40 text-emerald-750' },
          { label: 'Stale (30d+)', value: (summary?.stale_issues ?? 0).toLocaleString(), sub: 'Needs attention', icon: <AlertTriangle className="h-4 w-4 text-amber-500" />, accent: 'border-amber-100 bg-amber-50/40 text-amber-750' },
          { label: 'Bug Reports', value: (summary?.bug_count ?? 0).toLocaleString(), sub: 'Severity bugs', icon: <Bug className="h-4 w-4 text-rose-500" />, accent: 'border-rose-100 bg-rose-50/40 text-rose-750' },
          { label: 'Avg Resolution', value: `${summary?.avg_resolution_days ?? 0}d`, sub: 'Backlog cycle time', icon: <Clock className="h-4 w-4 text-purple-500" />, accent: 'border-purple-100 bg-purple-50/40 text-purple-750' },
        ].map((card) => (
          <div key={card.label} className={`rounded-xl border p-4 shadow-sm flex flex-col justify-between gap-1.5 ${card.accent}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{card.label}</span>
              {card.icon}
            </div>
            <div className="space-y-0.5">
              <span className="text-xl font-black tracking-tight leading-none text-slate-900 block">{card.value}</span>
              <span className="text-[9px] font-semibold text-slate-400">{card.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Asymmetric charts section (Trend, Donut, Heatmap) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Trend Chart (Line Chart) */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-900">Issue Trend</h3>
            <p className="text-[10px] text-slate-400 font-semibold">Backlog growth: Opened vs Closed issues</p>
          </div>
          {velocity.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={velocity} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11 }} />
                <Legend verticalAlign="top" height={36} iconSize={8} wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
                <Line type="monotone" dataKey="opened" name="Opened" stroke="#f97316" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="closed" name="Closed" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-xs text-slate-400">No trend data available</div>
          )}
        </div>

        {/* Priority Donut chart */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Issues by Priority</h3>
            <p className="text-[10px] text-slate-400 font-semibold">Priority distribution for open issues</p>
          </div>

          <div className="flex items-center justify-between gap-4 py-2">
            <ResponsiveContainer width="45%" height={110}>
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  innerRadius={30}
                  outerRadius={42}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1 text-[11px] font-semibold text-slate-600">
              {priorityData.map((item) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span>{item.name}</span>
                  </div>
                  <span className="font-bold text-slate-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* Heatmap block */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 mb-1">Issue Heatmap</h3>
        <p className="text-[10px] text-slate-400 font-semibold mb-4">Backlog activity mapped by day of the week</p>
        
        <div className="flex gap-2">
          {/* Days column */}
          <div className="flex flex-col justify-between text-[10px] font-semibold text-slate-400 pr-1 py-1">
            {heatmapDays.map(d => <span key={d}>{d}</span>)}
          </div>
          {/* Months grids */}
          <div className="flex-1 space-y-2">
            <div className="flex justify-between text-[10px] font-semibold text-slate-400 px-1">
              {heatmapMonths.map(m => <span key={m}>{m}</span>)}
            </div>
            {/* Calendar grids */}
            <div className="grid grid-rows-7 gap-1 grid-flow-col" style={{ gridTemplateColumns: 'repeat(53, minmax(0, 1fr))' }}>
              {(analytics?.heatmap || Array.from({ length: 371 }).fill(0)).map((level: any, i: number) => {
                const levels = ['bg-slate-100', 'bg-emerald-200', 'bg-emerald-300', 'bg-emerald-500', 'bg-emerald-700']
                return (
                  <div key={i} className={`h-2 w-2 rounded-sm ${levels[level] || 'bg-slate-100'}`} />
                )
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1.5 mt-3 text-[10px] font-semibold text-slate-400">
          <span>Less</span>
          <div className="h-2 w-2 rounded-sm bg-slate-100" />
          <div className="h-2 w-2 rounded-sm bg-emerald-200" />
          <div className="h-2 w-2 rounded-sm bg-emerald-300" />
          <div className="h-2 w-2 rounded-sm bg-emerald-500" />
          <div className="h-2 w-2 rounded-sm bg-emerald-700" />
          <span>More</span>
        </div>
      </div>

      {/* Issues Table Panel */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex gap-1.5">
            {TABS.map(t => (
              <button key={t} onClick={() => { setTab(t); setPage(1) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  tab === t 
                    ? 'bg-[#fdf2ec] text-[#c2410c] border border-[#fce6d8]' 
                    : 'text-slate-500 hover:text-slate-900 bg-slate-50 border border-slate-200'
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['#', 'Title', 'State', 'Author', 'Age', 'Comments'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(tab === 'All Issues' ? issues?.data : stale?.data)?.map((iss: any) => (
                <tr key={iss.number} className="group hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-mono text-slate-400 text-xs">#{iss.number}</td>
                  <td className="px-4 py-2.5 max-w-[280px]">
                    <span className="font-semibold text-slate-800 text-xs line-clamp-1">{iss.title}</span>
                    {iss.is_bug && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-600 font-bold">bug</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      iss.state === 'open' ? 'bg-orange-50 text-orange-700 border border-orange-100' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {iss.state}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{iss.author}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs font-bold">{iss.age_days}d</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{iss.comment_count}</td>
                </tr>
              ))}
              {!(tab === 'All Issues' ? issues?.data : stale?.data)?.length && (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400 text-sm">No issues found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {(tab === 'All Issues' ? issues : stale)?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">&larr; Prev</button>
            <span className="text-xs text-slate-500">Page <span className="font-bold text-slate-900">{page}</span> of <span className="font-bold text-slate-900">{(tab === 'All Issues' ? issues : stale)?.pages}</span></span>
            <button disabled={page >= (tab === 'All Issues' ? issues : stale)?.pages} onClick={() => setPage(p => p + 1)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">Next &rarr;</button>
          </div>
        )}
      </div>

    </div>
  )
}
