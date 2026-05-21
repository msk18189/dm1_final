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
  getSyncStatus,
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
  RefreshCw,
  Database,
  CheckCircle2,
  XCircle,
  Info,
  Zap,
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

  // Paginated states
  const [oldestData, setOldestData] = useState<any[]>([])
  const [oldestPage, setOldestPage] = useState(1)
  const [oldestTotalPages, setOldestTotalPages] = useState(1)
  const [oldestTotalResults, setOldestTotalResults] = useState(0)

  const [slowestData, setSlowestData] = useState<any[]>([])
  const [slowestPage, setSlowestPage] = useState(1)
  const [slowestTotalPages, setSlowestTotalPages] = useState(1)
  const [slowestTotalResults, setSlowestTotalResults] = useState(0)

  const [contributorsData, setContributorsData] = useState<any[]>([])
  const [contributorsPage, setContributorsPage] = useState(1)
  const [contributorsTotalPages, setContributorsTotalPages] = useState(1)
  const [contributorsTotalResults, setContributorsTotalResults] = useState(0)

  const [prRiskData, setPRRiskData] = useState<any[]>([])
  const [prRiskPage, setPRRiskPage] = useState(1)
  const [prRiskTotalPages, setPRRiskTotalPages] = useState(1)
  const [prRiskTotalResults, setPRRiskTotalResults] = useState(0)

  const [staleAlertsData, setStaleAlertsData] = useState<any[]>([])
  const [staleAlertsPage, setStaleAlertsPage] = useState(1)
  const [staleAlertsTotalPages, setStaleAlertsTotalPages] = useState(1)
  const [staleAlertsTotalResults, setStaleAlertsTotalResults] = useState(0)

  // Sync status
  const [syncStatus, setSyncStatus] = useState<any>(null)

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
    async (id: number, activeFilters: DashboardFiltersState = defaultFilters, silent: boolean = false) => {
      if (!silent) setIsLoading(true)
      try {
        const [
          kpi,
          oldestRes,
          slowestRes,
          contributorsRes,
          monthlyFlow,
          throughput,
          prRiskRes,
          staleAlertsRes,
          authorList,
        ] = await Promise.all([
          getKPI(id, activeFilters),
          getOldestPRs(id, oldestPage, 10, activeFilters),
          getSlowestPRs(id, slowestPage, 10, activeFilters),
          getContributorActivity(id, contributorsPage, 10, activeFilters),
          getMonthlyFlow(id, 6, activeFilters),
          getThroughput(id, 8, activeFilters),
          getPRRisk(id, prRiskPage, 15),
          getStaleAlerts(id, staleAlertsPage, 10),
          getAuthors(id),
        ])

        const reviewTurnaround = (contributorsRes.data || []).map((c: any) => ({
          username: c.username,
          avg_wait_hours: (c.avg_wait_for_review || 0) * 24,
        }))

        setAuthors(authorList)
        setData({
          kpi,
          monthlyFlow,
          throughput,
          reviewTurnaround,
        })

        // Paginated states updates
        setOldestData(oldestRes.data || [])
        setOldestPage(oldestRes.page || 1)
        setOldestTotalPages(oldestRes.pages || 1)
        setOldestTotalResults(oldestRes.total || 0)

        setSlowestData(slowestRes.data || [])
        setSlowestPage(slowestRes.page || 1)
        setSlowestTotalPages(slowestRes.pages || 1)
        setSlowestTotalResults(slowestRes.total || 0)

        setContributorsData(contributorsRes.data || [])
        setContributorsPage(contributorsRes.page || 1)
        setContributorsTotalPages(contributorsRes.pages || 1)
        setContributorsTotalResults(contributorsRes.total || 0)

        setPRRiskData(prRiskRes.data || [])
        setPRRiskPage(prRiskRes.page || 1)
        setPRRiskTotalPages(prRiskRes.pages || 1)
        setPRRiskTotalResults(prRiskRes.total || 0)

        setStaleAlertsData(staleAlertsRes.data || [])
        setStaleAlertsPage(staleAlertsRes.page || 1)
        setStaleAlertsTotalPages(staleAlertsRes.pages || 1)
        setStaleAlertsTotalResults(staleAlertsRes.total || 0)

        if (!silent) setActiveSection('overview')
      } catch (err: unknown) {
        if (!silent) setError(formatApiError(err) || 'Failed to load dashboard data')
      } finally {
        if (!silent) setIsLoading(false)
      }
    },
    [oldestPage, slowestPage, contributorsPage, prRiskPage, staleAlertsPage]
  )

  // Sync status polling effect
  useEffect(() => {
    if (!repoId) return

    let intervalId: any = null

    const checkStatus = async () => {
      try {
        const status = await getSyncStatus(repoId)
        setSyncStatus(status)
        
        // If sync has completed or failed, we clear the timer and run a final reload
        if (status.sync_status !== 'SYNCING') {
          if (intervalId) {
            clearInterval(intervalId)
            intervalId = null
          }
          // Do a final visible refresh of all metrics
          loadDashboardData(repoId, filters, false)
        } else {
          // Silent polling load to update the charts/lists dynamically in background
          loadDashboardData(repoId, filters, true)
        }
      } catch (err) {
        console.error("Error polling sync status:", err)
      }
    }

    checkStatus()
    intervalId = setInterval(checkStatus, 3000)

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [repoId, filters, loadDashboardData])

  // Page changes handlers
  const handleOldestPRsPageChange = async (newPage: number) => {
    if (!repoId) return
    try {
      const res = await getOldestPRs(repoId, newPage, 10, filters)
      setOldestData(res.data || [])
      setOldestPage(res.page || 1)
      setOldestTotalPages(res.pages || 1)
      setOldestTotalResults(res.total || 0)
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  const handleSlowestPRsPageChange = async (newPage: number) => {
    if (!repoId) return
    try {
      const res = await getSlowestPRs(repoId, newPage, 10, filters)
      setSlowestData(res.data || [])
      setSlowestPage(res.page || 1)
      setSlowestTotalPages(res.pages || 1)
      setSlowestTotalResults(res.total || 0)
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  const handleContributorsPageChange = async (newPage: number) => {
    if (!repoId) return
    try {
      const res = await getContributorActivity(repoId, newPage, 10, filters)
      setContributorsData(res.data || [])
      setContributorsPage(res.page || 1)
      setContributorsTotalPages(res.pages || 1)
      setContributorsTotalResults(res.total || 0)
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  const handlePRRiskPageChange = async (newPage: number) => {
    if (!repoId) return
    try {
      const res = await getPRRisk(repoId, newPage, 15)
      setPRRiskData(res.data || [])
      setPRRiskPage(res.page || 1)
      setPRRiskTotalPages(res.pages || 1)
      setPRRiskTotalResults(res.total || 0)
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  const handleStaleAlertsPageChange = async (newPage: number) => {
    if (!repoId) return
    try {
      const res = await getStaleAlerts(repoId, newPage, 10)
      setStaleAlertsData(res.data || [])
      setStaleAlertsPage(res.page || 1)
      setStaleAlertsTotalPages(res.pages || 1)
      setStaleAlertsTotalResults(res.total || 0)
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  const handleAnalyze = async (url: string, token?: string) => {
    setIsLoading(true)
    setError(null)
    setRepoUrl(url)
    setFilters(defaultFilters)

    // Reset pagination to 1 for all views
    setOldestPage(1)
    setSlowestPage(1)
    setContributorsPage(1)
    setPRRiskPage(1)
    setStaleAlertsPage(1)

    try {
      const result = await analyzeRepository(url, token)
      setRepoId(result.repo_id)

      const status = await getSyncStatus(result.repo_id)
      setSyncStatus(status)

      await loadDashboardData(result.repo_id, defaultFilters, false)
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

          {syncStatus && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="card card-glow mb-8 bg-white/[0.02] border-white/[0.06] backdrop-blur-xl p-6"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Database className="w-5 h-5 text-indigo-400" />
                      Repository Sync Status
                    </h3>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                      syncStatus.sync_status === 'SYNCING'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : syncStatus.sync_status === 'COMPLETED'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : syncStatus.sync_status === 'FAILED'
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                    }`}>
                      {syncStatus.sync_status === 'SYNCING' && <RefreshCw className="w-3 h-3 animate-spin" />}
                      {syncStatus.sync_status === 'COMPLETED' && <CheckCircle2 className="w-3 h-3" />}
                      {syncStatus.sync_status === 'FAILED' && <XCircle className="w-3 h-3" />}
                      {syncStatus.sync_status === 'IDLE' && <Info className="w-3 h-3" />}
                      {syncStatus.sync_status}
                    </span>
                    <span className="text-xs bg-white/[0.04] text-midnight-300 border border-white/[0.08] px-3 py-1 rounded-full font-medium">
                      Scope: Full Repository Ingestion
                    </span>
                  </div>
                  <p className="text-sm text-midnight-200 mb-4 font-medium">
                    {syncStatus.sync_progress || 'No sync currently active.'}
                  </p>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2 border-t border-white/[0.04] pt-4">
                    <div>
                      <p className="text-xs text-midnight-400 uppercase tracking-wider">Total PRs in Database</p>
                      <p className="text-lg font-bold text-white mt-0.5">{syncStatus.total_prs?.toLocaleString() ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-midnight-400 uppercase tracking-wider">Last Sync Time</p>
                      <p className="text-sm font-semibold text-white mt-1">
                        {syncStatus.last_successful_sync 
                          ? new Date(syncStatus.last_successful_sync).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : 'Never'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-midnight-400 uppercase tracking-wider">GitHub API Budget</p>
                      <p className="text-sm font-semibold text-white mt-1">
                        {syncStatus.rate_limit_remaining !== null 
                          ? `${syncStatus.rate_limit_remaining.toLocaleString()} / ${syncStatus.rate_limit_limit?.toLocaleString()}`
                          : 'Unknown'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-midnight-400 uppercase tracking-wider">API Budget Reset</p>
                      <p className="text-sm font-semibold text-white mt-1">
                        {syncStatus.rate_limit_reset
                          ? new Date(syncStatus.rate_limit_reset).toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : 'N/A'}
                      </p>
                    </div>
                  </div>
                  
                  {syncStatus.sync_status === 'FAILED' && syncStatus.error_message && (
                    <div className="mt-4 p-3 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-300 text-xs">
                      <strong>Sync Failure Reason:</strong> {syncStatus.error_message}
                    </div>
                  )}
                </div>
                
                <div className="flex flex-col items-stretch md:items-end justify-center gap-2">
                  <button
                    disabled={syncStatus.sync_status === 'SYNCING' || isLoading}
                    onClick={() => handleAnalyze(repoUrl, githubToken)}
                    className="btn-primary rounded-xl px-5 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-indigo-500/10"
                  >
                    <RefreshCw className={`w-4 h-4 ${(syncStatus.sync_status === 'SYNCING' || isLoading) ? 'animate-spin' : ''}`} />
                    {syncStatus.sync_status === 'SYNCING' ? 'Syncing...' : 'Sync Now'}
                  </button>
                  <span className="text-[10px] text-midnight-400 text-center md:text-right font-medium">
                    * Removes pagination limits & fetches full history
                  </span>
                </div>
              </div>
            </motion.div>
          )}

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
              <StalePRAlerts
                data={staleAlertsData}
                page={staleAlertsPage}
                totalPages={staleAlertsTotalPages}
                totalResults={staleAlertsTotalResults}
                onPageChange={handleStaleAlertsPageChange}
              />
              <PRRiskPanel
                data={prRiskData}
                page={prRiskPage}
                totalPages={prRiskTotalPages}
                totalResults={prRiskTotalResults}
                onPageChange={handlePRRiskPageChange}
              />
            </div>
          </section>

          <section id="section-charts" className="scroll-mt-8 mb-10 space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <MonthlyFlowChart data={data.monthlyFlow} />
              <ThroughputChart data={data.throughput} />
            </div>
            <ContributorChart data={contributorsData} />
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
                data={oldestData}
                page={oldestPage}
                totalPages={oldestTotalPages}
                totalResults={oldestTotalResults}
                onPageChange={handleOldestPRsPageChange}
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
                data={slowestData}
                page={slowestPage}
                totalPages={slowestTotalPages}
                totalResults={slowestTotalResults}
                onPageChange={handleSlowestPRsPageChange}
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
              data={contributorsData}
              page={contributorsPage}
              totalPages={contributorsTotalPages}
              totalResults={contributorsTotalResults}
              onPageChange={handleContributorsPageChange}
            />
          </section>
        </>
      )}
    </AppShell>
  )
}
