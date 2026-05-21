'use client'

import Link from 'next/link'
import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import AppShell, { NavSection } from '@/components/AppShell'
import AuthPanel from '@/components/AuthPanel'
import RepositoryInput from '@/components/RepositoryInput'
import KPICard from '@/components/KPICard'
import DataTable from '@/components/DataTable'
import DashboardFilters, { DashboardFiltersState } from '@/components/DashboardFilters'
import PRRiskPanel from '@/components/PRRiskPanel'
import StalePRAlerts from '@/components/StalePRAlerts'
import ExportButton from '@/components/ExportButton'
import dynamic from 'next/dynamic'

const MergeRateDonut = dynamic(() => import('@/components/MergeRateDonut'), { ssr: false })
const MonthlyFlowChart = dynamic(() => import('@/components/Charts').then((mod) => mod.MonthlyFlowChart), { ssr: false })
const ThroughputChart = dynamic(() => import('@/components/Charts').then((mod) => mod.ThroughputChart), { ssr: false })
const ContributorChart = dynamic(() => import('@/components/Charts').then((mod) => mod.ContributorChart), { ssr: false })
const ReviewTurnaroundChart = dynamic(() => import('@/components/Charts').then((mod) => mod.ReviewTurnaroundChart), { ssr: false })
import {
  analyzeRepository,
  formatApiError,
  getKPI,
  getOldestPRs,
  getSlowestPRs,
  getContributorActivity,
  getMonthlyFlow,
  getThroughput,
  getAuthors,
  getPRRisk,
  getStaleAlerts,
} from '@/lib/api'
import { formatDurationDisplay, formatDurationFromDays } from '@/lib/format'
import { loadGithubToken, saveGithubToken } from '@/lib/tokenStorage'
import { getAuthUser, signOut } from '@/lib/auth'
import {
  AlertCircle,
  FolderGit2,
  Clock,
  Timer,
  Eye,
  MessageSquare,
  GitMerge,
  AlertOctagon,
} from 'lucide-react'

const defaultFilters: DashboardFiltersState = {
  days: null,
  author: 'all',
  state: 'ALL',
}

function repoLabelFromUrl(url: string) {
  try {
    const path = url.replace(/\.git$/, '').split('github.com/')[1]
    if (path) return path.replace(/\/$/, '')
  } catch {
    /* ignore */
  }
  return 'Repository'
}

export default function Home() {
  const [repoId, setRepoId] = useState<number | null>(null)
  const [repoUrl, setRepoUrl] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<any>(null)
  const [authors, setAuthors] = useState<string[]>([])
  const [filters, setFilters] = useState<DashboardFiltersState>(defaultFilters)
  const [activeSection, setActiveSection] = useState<NavSection>('analyze')
  const [authUser, setAuthUser] = useState<string | null>(null)

  useEffect(() => {
    setGithubToken(loadGithubToken())
    setAuthUser(getAuthUser())
  }, [])

  const handleGithubTokenChange = (value: string) => {
    setGithubToken(value)
    saveGithubToken(value)
  }

  const handleSignOut = () => {
    signOut()
    setAuthUser(null)
  }

  const loadDashboardData = useCallback(
    async (id: number, activeFilters: DashboardFiltersState = defaultFilters) => {
      try {
        const [
          kpi,
          oldest,
          slowest,
          contributors,
          monthlyFlow,
          throughput,
          prRisk,
          staleAlerts,
          authorList,
        ] = await Promise.all([
          getKPI(id, activeFilters),
          getOldestPRs(id, 10, activeFilters),
          getSlowestPRs(id, 10, activeFilters),
          getContributorActivity(id, activeFilters),
          getMonthlyFlow(id, 6, activeFilters),
          getThroughput(id, 8, activeFilters),
          getPRRisk(id),
          getStaleAlerts(id),
          getAuthors(id),
        ])

        console.log('ML prediction data loaded:', prRisk)

        const reviewTurnaround = contributors.map((c: any) => ({
          username: c.username,
          avg_wait_hours: (c.avg_wait_for_review || 0) * 24,
        }))

        setAuthors(authorList)
        setData({
          kpi,
          oldest,
          slowest,
          contributors,
          monthlyFlow,
          throughput,
          reviewTurnaround,
          prRisk,
          staleAlerts,
        })
        setActiveSection('overview')
      } catch (err: unknown) {
        setError(formatApiError(err) || 'Failed to load dashboard data')
      }
    },
    []
  )

  const handleAnalyze = async (url: string, token?: string) => {
    setIsLoading(true)
    setError(null)
    setRepoUrl(url)
    setFilters(defaultFilters)
    try {
      const result = await analyzeRepository(url, token)
      setRepoId(result.repo_id)
      await loadDashboardData(result.repo_id, defaultFilters)
    } catch (err: unknown) {
      setError(formatApiError(err))
    } finally {
      setIsLoading(false)
    }
  }

  const handleApplyFilters = () => {
    if (repoId) loadDashboardData(repoId, filters)
  }

  const cycleAvg = formatDurationDisplay(
    data?.kpi?.avg_cycle_time_display,
    data?.kpi?.avg_cycle_time
  )
  const cycleMedian = formatDurationDisplay(
    data?.kpi?.median_cycle_time_display,
    data?.kpi?.median_cycle_time
  )
  const waitReview = formatDurationDisplay(
    data?.kpi?.avg_wait_for_review_display,
    data?.kpi?.avg_wait_for_review
  )
  const reviewDuration = formatDurationDisplay(
    data?.kpi?.avg_review_duration_display,
    data?.kpi?.avg_review_duration
  )

  const hasData = Boolean(data && repoId)

  if (!authUser) {
    return <AuthPanel onAuthenticated={(username) => setAuthUser(username)} />
  }

  return (
    <AppShell
      hasData={hasData}
      repoLabel={hasData ? repoLabelFromUrl(repoUrl) : undefined}
      userLabel={`Signed in as ${authUser}`}
      activeSection={activeSection}
      onNavigate={setActiveSection}
      headerActions={repoId ? <ExportButton repoId={repoId} filters={filters} /> : (
        <button
          type="button"
          onClick={handleSignOut}
          className="btn-secondary rounded-2xl px-4 py-2 text-sm font-semibold"
        >
          Sign out
        </button>
      )}
    >
      <section id="section-analyze" className={hasData ? 'scroll-mt-8 mb-8' : ''}>
        {hasData ? (
          <RepositoryInput
            githubToken={githubToken}
            onGithubTokenChange={handleGithubTokenChange}
            onAnalyze={handleAnalyze}
            isLoading={isLoading}
          />
        ) : (
          <div className="landing-glow-wrap">
            <div className="landing-glow-box">
              <RepositoryInput
                variant="hero"
                githubToken={githubToken}
                onGithubTokenChange={handleGithubTokenChange}
                onAnalyze={handleAnalyze}
                isLoading={isLoading}
              />
            </div>
          </div>
        )}
      </section>

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`flex items-start gap-3 rounded-2xl border border-palette-rose/30 bg-palette-rose-light p-4 ${hasData ? 'mb-8' : 'mt-4'}`}
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-palette-rose" />
          <div>
            <h3 className="font-semibold text-palette-rose">Analysis error</h3>
            <p className="mt-1 text-sm text-midnight-200">{error}</p>
          </div>
        </motion.div>
      )}

      {hasData && (
        <>
          <div className="mb-8">
            <h2 className="page-heading">Manage your pull requests</h2>
            <p className="page-subheading">
              Track cycle time, merge health, and contributor activity for your repository.
            </p>
          </div>

          <section id="section-overview" className="scroll-mt-8 mb-10">
            <DashboardFilters
              authors={authors}
              filters={filters}
              onChange={setFilters}
              onApply={handleApplyFilters}
            />

            <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="lg:col-span-9">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <KPICard
                    title="Open PRs"
                    value={data.kpi.open_prs}
                    icon={<FolderGit2 className="h-5 w-5" />}
                    unit="open"
                    accent="emerald"
                  />
                  <KPICard
                    title="Stale (>30d)"
                    value={data.kpi.stale_prs}
                    icon={<AlertOctagon className="h-5 w-5" />}
                    unit="attention"
                    accent="amber"
                  />
                  <KPICard
                    title="Avg cycle"
                    value={cycleAvg.value}
                    icon={<Clock className="h-5 w-5" />}
                    unit={cycleAvg.unit}
                    accent="orange"
                  />
                  <KPICard
                    title="Median cycle"
                    value={cycleMedian.value}
                    icon={<Timer className="h-5 w-5" />}
                    unit={cycleMedian.unit}
                    accent="lime"
                  />
                  <KPICard
                    title="Wait for review"
                    value={waitReview.value}
                    icon={<Eye className="h-5 w-5" />}
                    unit={waitReview.unit}
                    accent="rose"
                  />
                  <KPICard
                    title="Review duration"
                    value={reviewDuration.value}
                    icon={<Eye className="h-5 w-5" />}
                    unit={reviewDuration.unit}
                    accent="teal"
                  />
                  <KPICard
                    title="Merge rate"
                    value={data.kpi.merge_rate}
                    icon={<GitMerge className="h-5 w-5" />}
                    unit="%"
                    accent="teal"
                  />
                  <KPICard
                    title="Reviews / PR"
                    value={data.kpi.avg_reviews_per_pr}
                    icon={<MessageSquare className="h-5 w-5" />}
                    unit="avg"
                    accent="orange"
                  />
                </div>
              </div>
              <div className="lg:col-span-3">
                <MergeRateDonut
                  mergeRate={data.kpi.merge_rate}
                  openPrs={data.kpi.open_prs}
                  stalePrs={data.kpi.stale_prs}
                />
              </div>
            </div>
          </section>

          <section id="section-insights" className="scroll-mt-8 mb-10 space-y-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <StalePRAlerts data={data.staleAlerts} />
              <PRRiskPanel data={data.prRisk} />
            </div>
          </section>

          <section id="section-charts" className="scroll-mt-8 mb-10 space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <MonthlyFlowChart data={data.monthlyFlow} />
              <ThroughputChart data={data.throughput} />
            </div>
            <ContributorChart data={data.contributors} />
            <ReviewTurnaroundChart data={data.reviewTurnaround} />
          </section>

          <section id="section-tables" className="scroll-mt-8 mb-10 space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <DataTable
                title="Oldest open PRs"
                columns={[
                  { key: 'number', label: '#' },
                  { key: 'title', label: 'Title' },
                  { key: 'age_days', label: 'Age' },
                  { key: 'author', label: 'Author' },
                  {
                    key: 'created_at',
                    label: 'Created',
                    render: (value: string) => {
                      if (!value) return '—'
                      return new Date(value).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: '2-digit',
                      })
                    },
                  },
                ]}
                data={data.oldest}
              />
              <DataTable
                title="Slowest merged PRs"
                columns={[
                  { key: 'number', label: '#' },
                  { key: 'title', label: 'Title' },
                  {
                    key: 'cycle_time_display',
                    label: 'Cycle',
                    render: (_: unknown, row?: any) => {
                      const d = row?.cycle_time_display
                      if (d) return `${d.value} ${d.unit}`
                      const f = formatDurationFromDays(row?.cycle_time_days || 0)
                      return `${f.value} ${f.unit}`
                    },
                  },
                  { key: 'author', label: 'Author' },
                  {
                    key: 'merged_at',
                    label: 'Merged',
                    render: (value: string) => {
                      if (!value) return '—'
                      return new Date(value).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: '2-digit',
                      })
                    },
                  },
                ]}
                data={data.slowest}
              />
            </div>
            <DataTable
              title="Contributor activity"
              columns={[
                { key: 'username', label: 'User' },
                { key: 'total_prs', label: 'PRs' },
                { key: 'merged_prs', label: 'Merged' },
                {
                  key: 'avg_cycle_time_display',
                  label: 'Avg cycle',
                  render: (_: unknown, row?: any) => {
                    const d = row?.avg_cycle_time_display
                    if (d) return `${d.value} ${d.unit}`
                    return `${row?.avg_cycle_time || 0}d`
                  },
                },
                { key: 'merge_rate', label: 'Merge %' },
              ]}
              data={data.contributors}
            />
          </section>
        </>
      )}
    </AppShell>
  )
}
