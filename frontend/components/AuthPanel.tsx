'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signUp, getAuthUser, hasStoredUsers } from '@/lib/auth'

interface AuthPanelProps {
  onAuthenticated?: (username: string) => void
}

export default function AuthPanel({ onAuthenticated }: AuthPanelProps) {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'info' | 'error'>('info')

  const isSignUp = mode === 'signup'

  useEffect(() => {
    if (getAuthUser()) {
      router.replace('/')
      return
    }

    if (hasStoredUsers()) {
      setMode('signin')
    } else {
      setMode('signup')
    }
  }, [router])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!email.trim()) {
      setMessageType('error')
      setMessage('Please enter your email address.')
      return
    }

    if (!password) {
      setMessageType('error')
      setMessage('Please enter your password.')
      return
    }

    if (isSignUp && password !== confirmPassword) {
      setMessageType('error')
      setMessage('Passwords do not match.')
      return
    }

    const normalizedEmail = email.trim().toLowerCase()
    const result = isSignUp ? signUp(normalizedEmail, password) : signIn(normalizedEmail, password)
    if (!result.success) {
      setMessageType('error')
      setMessage(result.error || 'Authentication failed.')
      return
    }

    if (isSignUp) {
      setMode('signin')
      setPassword('')
      setConfirmPassword('')
      setMessageType('info')
      setMessage('Account created successfully. Please sign in.')
      return
    }

    setMessageType('info')
    setMessage('Signed in successfully. Redirecting...')
    onAuthenticated?.(normalizedEmail)
    setTimeout(() => router.push('/'), 400)
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-midnight-500">Secure access</p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-midnight-50 sm:text-4xl">
          {isSignUp ? 'Create Account' : 'Welcome Back'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-midnight-600">
          {isSignUp ? 'Register for the Battery Portal' : 'Login to access the Battery Portal'}
        </p>
      </div>

      <div className="auth-card">
        <div className="mb-6 flex items-center justify-between gap-3">
          <button
            type="button"
            className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
              !isSignUp
                ? 'border-palette-emerald bg-palette-emerald text-white shadow-sm'
                : 'border-warm-200 bg-white text-midnight-900 hover:bg-warm-50'
            }`}
            onClick={() => setMode('signin')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
              isSignUp
                ? 'border-palette-emerald bg-palette-emerald text-white shadow-sm'
                : 'border-warm-200 bg-white text-midnight-900 hover:bg-warm-50'
            }`}
            onClick={() => setMode('signup')}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-semibold text-midnight-900">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="input-field text-midnight-900"
              placeholder="admin@example.com"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-semibold text-midnight-900">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input-field text-midnight-900"
              placeholder="Enter your password"
              required
            />
          </div>

          {isSignUp && (
            <div>
              <label htmlFor="confirmPassword" className="mb-2 block text-sm font-semibold text-midnight-900">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="input-field text-midnight-900"
                placeholder="Re-enter your password"
                required
              />
            </div>
          )}

          {message && (
            <div
              className={`rounded-2xl border p-3 text-sm ${
                messageType === 'error'
                  ? 'border-palette-rose/20 bg-palette-rose-light/40 text-palette-rose'
                  : 'border-palette-emerald/20 bg-palette-emerald-light/40 text-midnight-600'
              }`}
            >
              {message}
            </div>
          )}

          <button type="submit" className="btn-primary w-full">
            {isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 border-t border-warm-200 pt-5 text-sm text-midnight-600">
          {isSignUp ? (
            <p>
              Already have an account?{' '}
              <button
                className="font-semibold text-midnight-900 hover:text-midnight-950"
                type="button"
                onClick={() => setMode('signin')}
              >
                Sign in
              </button>
            </p>
          ) : (
            <p>
              New here?{' '}
              <button
                className="font-semibold text-midnight-900 hover:text-midnight-950"
                type="button"
                onClick={() => setMode('signup')}
              >
                Create an account
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
