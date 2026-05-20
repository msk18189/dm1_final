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

  const tokenForRequest = () => {
    const t = githubToken.trim()
    return t ? t : undefined
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (url.trim()) await onAnalyze(url.trim(), tokenForRequest())
  }

  const handleVerify = async () => {
    if (!url.trim()) {
      setVerifyMessage('Enter a repository URL first.')
      setVerifyOk(false)
      return
    }
    setVerifying(true)
    setVerifyMessage(null)
    setVerifyOk(false)
    try {
      const result = await verifyRepositoryAccess(url.trim(), tokenForRequest())
      const privacy = result.is_private ? 'private' : 'public'
      const source =
        result.token_source === 'user'
          ? 'your token'
          : result.token_source === 'env'
            ? 'server .env'
            : 'no token'
      setVerifyOk(true)
      setVerifyMessage(`Access confirmed: ${result.owner}/${result.repo} (${privacy}) via ${source}.`)
    } catch (err) {
      setVerifyOk(false)
      setVerifyMessage(formatApiError(err))
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
      className={isHero ? 'p-6 sm:p-7' : 'card card-hover'}
    >
      {!isHero && (
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-palette-emerald-light">
            <Search className="h-5 w-5 text-palette-emerald" />
          </div>
          <div>
            <h2 className="text-base font-bold text-midnight-50">Change repository</h2>
            <p className="text-xs text-midnight-400">Run a new analysis</p>
          </div>
        </div>
      )}

      {isHero && (
        <div className="mb-5 text-center">
          <h2 className="text-lg font-bold text-midnight-50">Analyze repository</h2>
          <p className="mt-1 text-sm text-midnight-400">Paste a GitHub URL to get started</p>
        </div>
      )}

      <div className={`mb-4 flex gap-2.5 rounded-xl border border-warm-200 bg-warm-50 p-3 ${isHero ? '' : 'border-palette-amber/20 bg-palette-amber-light/50'}`}>
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-palette-amber" />
        <p className="text-xs leading-relaxed text-midnight-300 sm:text-sm">
          Private repos need a{' '}
          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-palette-emerald hover:underline"
          >
            PAT
          </a>{' '}
          with <span className="font-medium text-midnight-100">repo</span> scope.
        </p>
      </div>

      <div className="space-y-3.5">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-midnight-400">
            Repository URL
          </label>
          <div className="relative">
            <Github className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-midnight-400" />
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setVerifyMessage(null)
                setVerifyOk(false)
              }}
              placeholder="github.com/owner/repo"
              className="input-field pl-10 text-sm"
              disabled={isLoading}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-midnight-400">
            <KeyRound className="h-3 w-3" />
            Token <span className="normal-case font-normal text-midnight-500">(optional)</span>
          </label>
          <input
            type="password"
            autoComplete="off"
            value={githubToken}
            onChange={(e) => {
              onGithubTokenChange(e.target.value)
              setVerifyMessage(null)
              setVerifyOk(false)
            }}
            placeholder="ghp_…"
            className="input-field font-mono text-sm"
            disabled={isLoading}
          />
        </div>

        {verifyMessage && (
          <p
            className={`text-xs font-medium sm:text-sm ${verifyOk ? 'text-palette-emerald' : 'text-palette-amber'}`}
            role="status"
          >
            {verifyMessage}
          </p>
        )}

        <div className="flex flex-col gap-2 pt-1 sm:flex-row">
          <button
            type="button"
            onClick={handleVerify}
            disabled={isLoading || verifying || !url.trim()}
            className="btn-secondary flex items-center justify-center gap-2 text-sm sm:flex-none sm:px-5"
          >
            {verifying ? <Loader className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Test
          </button>
          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className="btn-primary flex flex-1 items-center justify-center gap-2 text-sm"
          >
            {isLoading ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              'Run analysis'
            )}
          </button>
        </div>
      </div>
    </motion.form>
  )
}
