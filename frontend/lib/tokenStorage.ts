import { api } from './api'

export function loadGithubToken(): string {
  // Can no longer access token directly since it's HttpOnly
  return ''
}

let saveTimeout: any;

export async function saveGithubToken(token: string): Promise<void> {
  if (typeof window === 'undefined') return
  
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      const trimmed = token.trim()
      if (trimmed) {
        await api.post('/api/auth/github-token', { token: trimmed })
      } else {
        await api.post('/api/auth/logout-github-token')
      }
    } catch {
      // Ignore errors for now
    }
<<<<<<< HEAD
  }, 500);
=======
  } catch {

  }
>>>>>>> ebd3b1d191540a57d1bba0df0b233989f7145041
}

