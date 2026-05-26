'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Github, Loader, KeyRound, ShieldCheck, Lock, Search } from 'lucide-react'
import { verifyRepositoryAccess, formatApiError } from '@/lib/api'

interface RepositoryInputProps {
  githubToken: string
  onGithubTokenChange: (value: string) => void
  onAnalyze: (url: string, githubToken?: string) => Promise<void>
  isLoading: boolean
  variant?: 'hero' | 'dashboard'
}

export default function RepositoryInput({
  githubToken,
  onGithubTokenChange,
  onAnalyze,
  isLoading,
  variant = 'dashboard',
}: RepositoryInputProps) {
  const [url, setUrl] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null)
  const [verifyOk, setVerifyOk] = useState(false)
  interface Estimation {
    pr_count: number
    issues_count: number
    forks_count: number
    contributors_count: number
    workflows_count: number
    discussions_count: number
    is_private: boolean
    estimated_requests: number
    estimated_requests_rest: number
    estimated_requests_pat: number
    above_limit: boolean
  }
  const [estimation, setEstimation] = useState<Estimation | null>(null)
  const [showRecommendation, setShowRecommendation] = useState(false)

  const tokenForRequest = () => {
    const t = githubToken.trim()
    return t ? t : undefined
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return

    let currentEst = estimation
    let currentOk = verifyOk

    if (!currentOk) {
      setVerifying(true)
      setVerifyMessage(null)
      try {
        const result = await verifyRepositoryAccess(url.trim(), tokenForRequest())
        setVerifyOk(true)
        currentOk = true
        const privacy = result.is_private ? 'private' : 'public'
        setVerifyMessage(`Access confirmed: ${result.owner}/${result.repo} (${privacy}).`)
        if ('pr_count' in result) {
          const est = result as any
          setEstimation(est)
          currentEst = est
        }
      } catch (err) {
        setVerifyOk(false)
        setVerifyMessage(formatApiError(err))
        setVerifying(false)
        return
      } finally {
        setVerifying(false)
      }
    }

    if (currentEst) {
      if (currentEst.is_private && !githubToken.trim()) {
        setVerifyMessage('A GitHub Personal Access Token (PAT) is mandatory to synchronize private repositories.')
        return
      }

      if (!currentEst.is_private && currentEst.above_limit && !githubToken.trim()) {
        // Show recommendation dialog before sync
        setShowRecommendation(true)
        return
      }
    }

    await onAnalyze(url.trim(), tokenForRequest())
  }

  const handleVerify = async () => {
    if (!url.trim()) {
      setVerifyMessage('Enter a repository URL first.')
      setVerifyOk(false)
      setEstimation(null)
      setShowRecommendation(false)
      return
    }
    setVerifying(true)
    setVerifyMessage(null)
    setVerifyOk(false)
    setEstimation(null)
    setShowRecommendation(false)
    try {
      const result = await verifyRepositoryAccess(url.trim(), tokenForRequest())
      const privacy = result.is_private ? 'private' : 'public'
      const source = result.token_source === 'user' ? 'your token' : 'no token'
      setVerifyOk(true)
      setVerifyMessage(`Access confirmed: ${result.owner}/${result.repo} (${privacy}) via ${source}.`)
      if ('pr_count' in result) {
        setEstimation(result as any)
      }
    } catch (err) {
      setVerifyOk(false)
      setVerifyMessage(formatApiError(err))
      setEstimation(null)
    } finally {
      setVerifying(false)
    }
  }

  const isHero = variant === 'hero'

  return (
    <motion.form
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className={isHero ? 'p-12 sm:p-16 lg:p-24' : 'card card-hover'}
    >
      {!isHero && (
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-palette-emerald-light">
            <Search className="h-5 w-5 text-palette-emerald" />
          </div>
          <div>
            <h2 className="text-base font-bold text-primary">Change repository</h2>
            <p className="text-xs text-muted">Run a new analysis</p>
          </div>
        </div>
      )}

      {isHero && (
        <div className="mb-8 text-center space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Analyze repository</h2>
          <p className="text-base text-secondary">Paste a GitHub URL to start the repository analytics workflow</p>
        </div>
      )}

      <div className={`mb-6 flex gap-3 rounded-2xl border border-warm-200 bg-warm-50 p-4 ${isHero ? 'border-palette-amber/20 bg-palette-amber-light/30' : 'border-palette-amber/20 bg-palette-amber-light/50'}`}>
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-palette-amber" />
        <p className="text-xs leading-relaxed text-secondary sm:text-sm">
          Private repos need a{' '}
          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-palette-emerald hover:underline"
          >
            PAT
          </a>{' '}
          with <span className="font-medium text-primary">repo</span> scope.
        </p>
      </div>

      <div className={isHero ? 'space-y-6 sm:space-y-8' : 'space-y-4'}>
        <div>
          <label className={`mb-2 block font-semibold uppercase tracking-wider text-secondary ${isHero ? 'text-xs sm:text-sm' : 'text-[10px]'}`}>
            Repository URL
          </label>
          <div className="relative">
            <Github className={`absolute top-1/2 -translate-y-1/2 text-muted ${isHero ? 'h-6 w-6 left-5' : 'h-4 w-4 left-3.5'}`} />
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setVerifyMessage(null)
                setVerifyOk(false)
                setEstimation(null)
                setShowRecommendation(false)
              }}
              placeholder="github.com/owner/repo"
              className={`input-field ${isHero ? 'h-14 pr-5 !rounded-2xl text-lg' : 'pr-4 text-sm'}`}
              style={{ paddingLeft: isHero ? '4rem' : '3rem' }}
              disabled={isLoading}
            />
          </div>
        </div>

        <div>
          <label className={`mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wider text-secondary ${isHero ? 'text-xs sm:text-sm' : 'text-[10px]'}`}>
            <KeyRound className={isHero ? 'h-4 w-4' : 'h-3 w-3'} />
            Token <span className="normal-case font-normal text-muted">(optional)</span>
          </label>
          <input
            type="password"
            autoComplete="off"
            value={githubToken}
            onChange={(e) => {
              onGithubTokenChange(e.target.value)
              setVerifyMessage(null)
              setVerifyOk(false)
              setEstimation(null)
              setShowRecommendation(false)
            }}
            placeholder="ghp_…"
            className={`input-field font-mono ${isHero ? 'h-14 px-5 !rounded-2xl text-lg' : 'text-sm'}`}
            disabled={isLoading}
          />
        </div>

        {verifyMessage && (
          <p
            className={`font-medium ${isHero ? 'text-base' : 'text-xs'} ${verifyOk ? 'text-palette-emerald' : 'text-palette-amber'}`}
            role="status"
          >
            {verifyMessage}
          </p>
        )}

        {estimation && (
          <div className="rounded-2xl border border-warm-200 bg-white/50 p-5 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-secondary">
              Expected API Requests & Repository Details
            </h3>
            
            <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
              <div className="rounded-xl bg-warm-50 p-3">
                <span className="block text-muted">Pull Requests</span>
                <span className="text-sm font-bold text-primary">{estimation.pr_count}</span>
              </div>
              <div className="rounded-xl bg-warm-50 p-3">
                <span className="block text-muted">Issues</span>
                <span className="text-sm font-bold text-primary">{estimation.issues_count}</span>
              </div>
              <div className="rounded-xl bg-warm-50 p-3">
                <span className="block text-muted">Forks</span>
                <span className="text-sm font-bold text-primary">{estimation.forks_count}</span>
              </div>
              <div className="rounded-xl bg-warm-50 p-3">
                <span className="block text-muted">Contributors</span>
                <span className="text-sm font-bold text-primary">{estimation.contributors_count}</span>
              </div>
              <div className="rounded-xl bg-warm-50 p-3">
                <span className="block text-muted">Workflows</span>
                <span className="text-sm font-bold text-primary">{estimation.workflows_count}</span>
              </div>
              <div className="rounded-xl bg-warm-50 p-3">
                <span className="block text-muted">Discussions</span>
                <span className="text-sm font-bold text-primary">{estimation.discussions_count}</span>
              </div>
            </div>

            <div className="rounded-xl bg-warm-50 p-3 flex justify-between items-center text-xs">
              <span className="text-muted">Estimated API Requests:</span>
              <span className="text-sm font-bold text-palette-orange">
                ~{estimation.estimated_requests} calls
              </span>
            </div>

            {estimation.is_private && !githubToken.trim() && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-xs flex gap-2">
                <Lock className="h-5 w-5 shrink-0 text-rose-500 mt-0.5" />
                <div>
                  <span className="font-bold block mb-0.5">Private Repository Flow</span>
                  🔒 This repository is private. A GitHub Personal Access Token (PAT) is mandatory to sync private repositories. Sync blocked until token is entered.
                </div>
              </div>
            )}

            {!estimation.is_private && estimation.above_limit && !githubToken.trim() && (
              <div className="rounded-xl border border-palette-amber/20 bg-palette-amber-light/30 p-4 text-palette-amber text-xs flex gap-2">
                <ShieldCheck className="h-5 w-5 shrink-0 text-palette-amber mt-0.5" />
                <div>
                  <span className="font-bold block mb-0.5">Large repository detected</span>
                  ⚠️ Large repository detected. Add GitHub PAT for deeper analysis and faster syncing. You may continue without a PAT with a limited/lightweight sync.
                </div>
              </div>
            )}

            {!estimation.is_private && !estimation.above_limit && (
              <div className="rounded-xl border border-palette-emerald/20 bg-palette-emerald-light/20 p-4 text-palette-emerald text-xs flex gap-2">
                <ShieldCheck className="h-5 w-5 shrink-0 text-palette-emerald mt-0.5" />
                <div>
                  <span className="font-bold block mb-0.5">Lightweight Sync Ready</span>
                  ✅ Estimated usage is below unauthenticated GitHub limit. You can safely synchronize without a token using anonymous API requests.
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4 pt-2 sm:flex-row">
          <button
            type="button"
            onClick={handleVerify}
            disabled={isLoading || verifying || !url.trim()}
            className={`btn-secondary flex items-center justify-center gap-2.5 sm:flex-none transition-all duration-300 ${isHero ? 'text-lg h-14 px-8 !rounded-2xl' : 'text-sm sm:px-5'}`}
          >
            {verifying ? <Loader className={isHero ? 'h-6 w-6 animate-spin' : 'h-4 w-4 animate-spin'} /> : <ShieldCheck className={isHero ? 'h-6 w-6' : 'h-4 w-4'} />}
            <span>Test</span>
          </button>
          <button
            type="submit"
            disabled={isLoading || !url.trim() || (estimation?.is_private && !githubToken.trim())}
            className={`btn-primary flex flex-1 items-center justify-center gap-2.5 transition-all duration-300 ${isHero ? 'text-lg h-14 !rounded-2xl font-bold shadow-lg hover:shadow-xl' : 'text-sm'}`}
          >
            {isLoading ? (
              <>
                <Loader className={isHero ? 'h-6 w-6 animate-spin' : 'h-4 w-4 animate-spin'} />
                <span>Analyzing…</span>
              </>
            ) : (
              <span>Run analysis</span>
            )}
          </button>
        </div>
      </div>

      {showRecommendation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg rounded-3xl border border-warm-200 bg-white p-8 shadow-2xl space-y-6"
          >
            <div className="space-y-2">
              <h3 className="text-xl font-extrabold tracking-tight text-primary">
                Large repository detected.
              </h3>
              <p className="text-sm text-secondary font-medium">
                GitHub anonymous API limits may be exceeded.
              </p>
              <p className="text-sm text-secondary font-medium">
                Add PAT for:
              </p>
            </div>

            <ul className="space-y-2 text-sm text-secondary pl-2 font-medium">
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4.5 w-4.5 text-palette-emerald" />
                <span>full analysis</span>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4.5 w-4.5 text-palette-emerald" />
                <span>faster syncing</span>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4.5 w-4.5 text-palette-emerald" />
                <span>deeper analytics</span>
              </li>
            </ul>

            <div className="space-y-3 pt-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-secondary">
                Optional GitHub Personal Access Token (PAT)
              </label>
              <input
                type="password"
                placeholder="ghp_..."
                className="input-field font-mono text-sm"
                value={githubToken}
                onChange={(e) => onGithubTokenChange(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <button
                type="button"
                onClick={async () => {
                  setShowRecommendation(false)
                  await onAnalyze(url.trim(), undefined)
                }}
                className="btn-secondary text-sm flex-1 py-3 justify-center !rounded-xl"
              >
                Continue lightweight analysis
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (githubToken.trim()) {
                    setShowRecommendation(false)
                    await onAnalyze(url.trim(), githubToken.trim())
                  } else {
                    setVerifyMessage('Please enter a GitHub PAT first or choose lightweight sync.')
                  }
                }}
                disabled={!githubToken.trim()}
                className="btn-primary text-sm flex-1 py-3 justify-center disabled:opacity-50 disabled:cursor-not-allowed !rounded-xl"
              >
                Add PAT
              </button>
            </div>
            
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowRecommendation(false)}
                className="text-xs font-medium text-muted hover:text-primary transition"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.form>
  )
}
