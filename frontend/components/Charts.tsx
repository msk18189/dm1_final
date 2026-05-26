'use client'

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { motion } from 'framer-motion'
import { CHART, tooltipStyle, legendStyle } from '@/lib/chartTheme'
import { PALETTE } from '@/lib/theme'

function EmptyChart({ title, message }: { title: string; message: string }) {
  return (
    <motion.div className="card card-hover flex h-[320px] flex-col items-center justify-center text-midnight-400">
      <p className="section-title mb-1">{title}</p>
      <p className="text-sm">{message}</p>
    </motion.div>
  )
}

function ChartShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card card-hover card-glow h-full">
      <h3 className="section-title">{title}</h3>
      {subtitle && <p className="section-subtitle mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </motion.div>
  )
}

const renderColorLegend = (value: string) => {
  const colors: Record<string, string> = {
    Created: CHART.created,
    Merged: CHART.merged,
    'Closed (unmerged)': CHART.closed,
    Closed: CHART.closed,
    'Merged PRs': CHART.line,
    'Total PRs': CHART.total,
  }
  const color = colors[value] || PALETTE.emerald.main
  return (
    <span style={{ color, fontWeight: 600, fontSize: 12 }}>{value}</span>
  )
}

export function MonthlyFlowChart({ data, isAnimationActive = true }: { data: any[], isAnimationActive?: boolean }) {
  const chartData = Array.isArray(data)
    ? data
    : Object.entries(data || {}).map(([month, flow]: [string, any]) => ({
        month,
        ...(typeof flow === 'object' ? flow : {}),
      }))

  if (!chartData.length) {
    return <EmptyChart title="Monthly PR Flow" message="No PR activity in the selected period." />
  }

  return (
    <ChartShell title="Monthly PR Flow" subtitle="Created · Merged · Closed — each in a distinct color">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="month" stroke={CHART.axis} tick={{ fontSize: 11, fill: CHART.axis }} axisLine={false} tickLine={false} />
          <YAxis stroke={CHART.axis} allowDecimals={false} tick={{ fill: CHART.axis }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={legendStyle} formatter={renderColorLegend} />
          <Bar dataKey="created" name="Created" fill={CHART.created} radius={[6, 6, 0, 0]} isAnimationActive={isAnimationActive} />
          <Bar dataKey="merged" name="Merged" fill={CHART.merged} radius={[6, 6, 0, 0]} isAnimationActive={isAnimationActive} />
          <Bar dataKey="closed" name="Closed (unmerged)" fill={CHART.closed} radius={[6, 6, 0, 0]} isAnimationActive={isAnimationActive} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  )
}

export function ThroughputChart({ data, isAnimationActive = true }: { data: any[] | Record<string, number>, isAnimationActive?: boolean }) {
  const chartData = Array.isArray(data)
    ? data
    : Object.entries(data || {})
        .map(([week, count]) => ({ week, prs: count }))
        .sort((a, b) => a.week.localeCompare(b.week))

  if (!chartData.length) {
    return <EmptyChart title="PR Throughput" message="No merged PRs in the last 8 weeks." />
  }

  return (
    <ChartShell title="PR Throughput" subtitle={`Weekly merges — ${PALETTE.orange.main} trend`}>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="throughputGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.line} stopOpacity={0.45} />
              <stop offset="100%" stopColor={CHART.line} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="week" stroke={CHART.axis} tick={{ fontSize: 10, fill: CHART.axis }} axisLine={false} tickLine={false} />
          <YAxis stroke={CHART.axis} allowDecimals={false} tick={{ fill: CHART.axis }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value} PRs`, 'Merged']} />
          <Legend wrapperStyle={legendStyle} formatter={renderColorLegend} />
          <Area
            type="monotone"
            dataKey="prs"
            name="Merged PRs"
            stroke={CHART.line}
            strokeWidth={2.5}
            fill="url(#throughputGrad)"
            isAnimationActive={isAnimationActive}
            dot={{ fill: CHART.line, r: 4, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: '#fff', stroke: CHART.line, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  )
}

export function ContributorChart({ data }: { data: any[] }) {
  const chartData = (data || [])
    .slice()
    .sort((a, b) => (b.total_prs || 0) - (a.total_prs || 0))
    .map((c) => ({
      ...c,
      label:
        (c.username || 'unknown').length > 14
          ? `${c.username.slice(0, 12)}…`
          : c.username,
    }))

  if (!chartData.length) {
    return (
      <EmptyChart
        title="Contributor Activity"
        message="No contributor data yet. Re-analyze the repository."
      />
    )
  }

  const chartHeight = Math.max(300, chartData.length * 28 + 80)

  return (
    <ChartShell
      title="Contributor Activity"
      subtitle={`Total PRs (${PALETTE.lime.main}) vs merged (${PALETTE.teal.main})`}
    >
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
          <XAxis type="number" stroke={CHART.axis} allowDecimals={false} tick={{ fill: CHART.axis }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="label"
            stroke={CHART.axis}
            width={100}
            tick={{ fontSize: 11, fill: CHART.axis }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.username || ''}
            formatter={(value: number, name: string) => [`${value} PRs`, name]}
          />
          <Legend wrapperStyle={legendStyle} formatter={renderColorLegend} />
          <Bar dataKey="total_prs" fill={CHART.total} name="Total PRs" radius={[0, 6, 6, 0]} />
          <Bar dataKey="merged_prs" fill={CHART.mergedBar} name="Merged" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  )
}

export function ReviewTurnaroundChart({ data }: { data: any[] }) {
  const maxHours = Math.max(...(data || []).map((d) => d.avg_wait_hours || 0), 1)

  return (
    <ChartShell title="Review Turnaround" subtitle="Wait time bands — teal · amber · rose">
      <div className="space-y-3">
        {(data || []).map((item, idx) => {
          const pct = Math.min((item.avg_wait_hours / maxHours) * 100, 100)
          const barStyle =
            item.avg_wait_hours < 24
              ? { background: `linear-gradient(90deg, ${PALETTE.teal.main}, ${PALETTE.teal.text})` }
              : item.avg_wait_hours < 48
                ? { background: `linear-gradient(90deg, ${PALETTE.amber.main}, ${PALETTE.amber.text})` }
                : { background: `linear-gradient(90deg, ${PALETTE.rose.main}, ${PALETTE.rose.text})` }
          return (
            <div key={idx} className="flex items-center gap-3">
              <div className="w-28 truncate text-sm font-medium text-palette-emerald-text">
                {item.username}
              </div>
              <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-midnight-800">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, ...barStyle }}
                />
              </div>
              <div
                className={`w-14 text-right text-xs font-bold ${
                  item.avg_wait_hours < 24
                    ? 'text-palette-teal'
                    : item.avg_wait_hours < 48
                      ? 'text-palette-amber'
                      : 'text-palette-rose'
                }`}
              >
                {item.avg_wait_hours < 24
                  ? `${item.avg_wait_hours.toFixed(1)}h`
                  : `${(item.avg_wait_hours / 24).toFixed(1)}d`}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-5 flex flex-wrap gap-4 text-[11px] font-medium">
        <span className="flex items-center gap-1.5 text-palette-teal">
          <span className="h-2.5 w-2.5 rounded-full bg-palette-teal" /> &lt;24h
        </span>
        <span className="flex items-center gap-1.5 text-palette-amber">
          <span className="h-2.5 w-2.5 rounded-full bg-palette-amber" /> 24–48h
        </span>
        <span className="flex items-center gap-1.5 text-palette-rose">
          <span className="h-2.5 w-2.5 rounded-full bg-palette-rose" /> &gt;48h
        </span>
      </div>
    </ChartShell>
  )
}
