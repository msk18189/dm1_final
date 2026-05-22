'use client'
import { useState, useEffect } from 'react'
import { MessageCircle, CheckCircle2, ThumbsUp, Users } from 'lucide-react'
import { motion } from 'framer-motion'
import { getDiscussionsAnalytics, getDiscussions } from '@/lib/api'

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

export default function DiscussionsPanel({ repoId }: Props) {
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

  useEffect(() => {
    if (discussions?.data) {
      console.log(`[Telemetry][Frontend] Rendered ${discussions.data.length} discussions`)
    }
  }, [discussions])

  return (
    <div className="space-y-6">
      {summary?.total_discussions === 0 && !loading && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800 text-sm">
          No discussions found. Discussions may not be enabled for this repository.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={<MessageCircle className="h-4 w-4 text-indigo-500" />} label="Total" value={(summary?.total_discussions ?? 0).toLocaleString()} accent="bg-indigo-50" />
        <StatCard icon={<MessageCircle className="h-4 w-4 text-emerald-600" />} label="Open" value={(summary?.open_discussions ?? 0).toLocaleString()} accent="bg-emerald-50" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4 text-violet-500" />} label="Answered" value={(summary?.answered_discussions ?? 0).toLocaleString()} accent="bg-violet-50" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4 text-violet-500" />} label="Answer Rate" value={`${summary?.answer_rate ?? 0}%`} accent="bg-violet-50" />
        <StatCard icon={<MessageCircle className="h-4 w-4 text-amber-600" />} label="Avg Comments" value={summary?.avg_comments ?? 0} accent="bg-amber-50" />
        <StatCard icon={<ThumbsUp className="h-4 w-4 text-rose-500" />} label="Avg Reactions" value={summary?.avg_reactions ?? 0} accent="bg-rose-50" />
      </div>

      <div className="rounded-2xl border border-warm-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-primary mb-4">Discussions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-warm-200">
                {['#', 'Title', 'Category', 'Author', 'State', 'Comments', 'Answered'].map(h => (
                  <th key={h} className="pb-2 text-left font-semibold text-secondary pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-100">
              {discussions?.data?.map((d: any) => (
                <tr key={d.number} className="hover:bg-warm-50/50">
                  <td className="py-2.5 pr-4 font-mono text-muted">#{d.number}</td>
                  <td className="py-2.5 pr-4 max-w-[220px]"><span className="text-primary font-medium line-clamp-1">{d.title}</span></td>
                  <td className="py-2.5 pr-4 text-secondary">{d.category || '—'}</td>
                  <td className="py-2.5 pr-4 text-secondary">{d.author}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${d.state === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-warm-100 text-secondary'}`}>{d.state}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-secondary">{d.comment_count}</td>
                  <td className="py-2.5">
                    {d.answer_chosen ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
              {!discussions?.data?.length && (
                <tr><td colSpan={7} className="py-10 text-center text-muted text-sm">No discussions found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {discussions?.pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-warm-200">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">← Prev</button>
            <span className="text-xs text-secondary">Page <span className="font-semibold text-primary">{page}</span> of <span className="font-semibold text-primary">{discussions?.pages}</span></span>
            <button disabled={page >= discussions?.pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-warm-50 hover:text-primary disabled:pointer-events-none disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
