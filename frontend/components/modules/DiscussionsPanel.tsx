'use client'

import { useState, useEffect } from 'react'
import { MessageCircle, CheckCircle2, ThumbsUp, Users, HelpCircle, Activity, ExternalLink, Calendar } from 'lucide-react'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { getDiscussionsAnalytics, getDiscussions } from '@/lib/api'
import { formatTelemetry } from '@/lib/format'

interface Props { repoId: number; syncStatus?: any }

export default function DiscussionsPanel({ repoId, syncStatus }: Props) {
  const [summary, setSummary] = useState<any>(null)
  const [discussions, setDiscussions] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getDiscussionsAnalytics(repoId).then(setSummary).catch(console.error).finally(() => setLoading(false))
  }, [repoId])

  useEffect(() => {
    getDiscussions(repoId, page).then(setDiscussions).catch(console.error)
  }, [repoId, page])

  // Topic trends simulated data matching mockup
  const topicTrends = [
    { category: 'Q&A / Help', count: 48, percentage: 80, color: 'bg-indigo-600' },
    { category: 'Ideas & Feedback', count: 24, percentage: 40, color: 'bg-emerald-500' },
    { category: 'Show and Tell', count: 18, percentage: 30, color: 'bg-violet-500' },
    { category: 'Announcements', count: 12, percentage: 20, color: 'bg-amber-500' },
    { category: 'General', count: 8, percentage: 13, color: 'bg-slate-400' },
  ]

  // Simulated activity timeline data
  const activityData = [
    { date: 'Dec 25', activity: 12 },
    { date: 'Jan 25', activity: 22 },
    { date: 'Feb 25', activity: 18 },
    { date: 'Mar 25', activity: 38 },
    { date: 'Apr 25', activity: 48 },
    { date: 'May 25', activity: 45 },
  ]

  return (
    <div className="space-y-6">

      {summary?.total_discussions === 0 && !loading && (
        <div className="rounded-2xl border border-slate-200 bg-amber-50/50 p-5 text-slate-800 text-sm">
          No discussions found. Discussions may not be enabled for this repository.
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Discussions', value: syncStatus ? formatTelemetry(syncStatus.total_discussions, 0) : (summary ? formatTelemetry(summary.total_discussions, 0) : '—'), sub: 'Threads created', icon: <MessageCircle className="h-4 w-4 text-indigo-500" />, accent: 'border-indigo-100 bg-indigo-50/40 text-indigo-750' },
          { label: 'Open Discussions', value: (summary?.open_discussions ?? 0).toLocaleString(), sub: 'Active threads', icon: <MessageCircle className="h-4 w-4 text-emerald-500" />, accent: 'border-emerald-100 bg-emerald-50/40 text-emerald-750' },
          { label: 'Answered', value: (summary?.answered_discussions ?? 0).toLocaleString(), sub: 'Resolved threads', icon: <CheckCircle2 className="h-4 w-4 text-purple-500" />, accent: 'border-purple-100 bg-purple-50/40 text-purple-750' },
          { label: 'Answer Rate', value: `${summary?.answer_rate ?? 0}%`, sub: 'Backlog solved %', icon: <HelpCircle className="h-4 w-4 text-violet-500" />, accent: 'border-violet-100 bg-violet-50/40 text-violet-750' },
          { label: 'Avg Comments', value: summary?.avg_comments ?? 0, sub: 'Engagement depth', icon: <MessageCircle className="h-4 w-4 text-amber-500" />, accent: 'border-amber-100 bg-amber-50/40 text-amber-750' },
          { label: 'Avg Reactions', value: summary?.avg_reactions ?? 0, sub: 'Sentiment rating', icon: <ThumbsUp className="h-4 w-4 text-rose-500" />, accent: 'border-rose-100 bg-rose-50/40 text-rose-750' },
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

      {/* Activity Timeline and Topic trends */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Discussion Activity Graph */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-900">Discussion Activity</h3>
            <p className="text-[10px] text-slate-400 font-semibold">Active threads timeline over time</p>
          </div>
          
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={activityData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <defs>
                <linearGradient id="discGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 9, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11 }} />
              <Area type="monotone" dataKey="activity" name="Discussions" stroke="#6366f1" strokeWidth={2.5} fill="url(#discGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Topic Trends */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Top Topics</h3>
            <p className="text-[10px] text-slate-400 font-semibold mb-4">Popularity metrics by GitHub category</p>
          </div>

          <div className="space-y-3">
            {topicTrends.map((topic) => (
              <div key={topic.category} className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-slate-650">
                  <span className="truncate pr-1">{topic.category}</span>
                  <span className="font-bold text-slate-900">{topic.count}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${topic.color}`} style={{ width: `${topic.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Discussion list */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Discussions Workspace</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['#', 'Title', 'Category', 'Author', 'Status', 'Comments', 'Resolved'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {discussions?.data?.map((d: any) => (
                <tr key={d.number} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-mono text-slate-400">#{d.number}</td>
                  <td className="px-4 py-2.5 max-w-[220px]">
                    <span className="text-slate-900 font-bold line-clamp-1 flex items-center gap-1">
                      {d.title}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-650">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-semibold">{d.category || 'General'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 font-semibold">{d.author}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      d.state === 'OPEN' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>{d.state}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-650 font-bold">{d.comment_count}</td>
                  <td className="px-4 py-2.5">
                    {d.answer_chosen ? (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-750 font-bold border border-emerald-200 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="h-3 w-3 shrink-0" /> Answered
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
              {!discussions?.data?.length && (
                <tr><td colSpan={7} className="py-10 text-center text-slate-400 text-sm">No discussions found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {discussions?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">&larr; Prev</button>
            <span className="text-xs text-slate-500">Page <span className="font-bold text-slate-900">{page}</span> of <span className="font-bold text-slate-900">{discussions?.pages}</span></span>
            <button disabled={page >= discussions?.pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-650 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40">Next &rarr;</button>
          </div>
        )}
      </div>

    </div>
  )
}
