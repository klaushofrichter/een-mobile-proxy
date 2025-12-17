import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { revokeToken as revokeTokenService } from '../services/auth'

export const useAuthStore = defineStore('auth', () => {
  // State
  const token = ref(null)
  const tokenExpiration = ref(null)
  const refreshTokenMarker = ref(null)
  const hostname = ref(null)
  const port = ref(null)
  const userProfile = ref(null)

  // Auto-refresh timer
  let refreshTimer = null

  // Getters
  const isAuthenticated = computed(() => !!token.value)

  const baseUrl = computed(() => {
    if (!hostname.value) return null
    const portPart = port.value && port.value !== 443 ? `:${port.value}` : ''
    return `https://${hostname.value}${portPart}`
  })

  // Actions
  function initialize() {
    // Restore from localStorage
    const storedToken = localStorage.getItem('auth_token')
    const storedExpiration = localStorage.getItem('token_expiration')
    const storedRefresh = localStorage.getItem('refresh_token')
    const storedHostname = localStorage.getItem('hostname')
    const storedPort = localStorage.getItem('port')
    const storedProfile = localStorage.getItem('user_profile')

    if (storedToken) {
      token.value = storedToken
    }
    if (storedExpiration) {
      tokenExpiration.value = parseInt(storedExpiration, 10)
    }
    if (storedRefresh) {
      refreshTokenMarker.value = storedRefresh
    }
    if (storedHostname) {
      hostname.value = storedHostname
    }
    if (storedPort) {
      port.value = parseInt(storedPort, 10)
    }
    if (storedProfile) {
      try {
        userProfile.value = JSON.parse(storedProfile)
      } catch (e) {
        console.error('Failed to parse stored user profile:', e)
      }
    }

    // Set up auto-refresh if we have a refresh token
    if (refreshTokenMarker.value && tokenExpiration.value) {
      setupAutoRefresh()
    }
  }

  function setToken(newToken, expiresIn = null) {
    token.value = newToken

    if (newToken) {
      localStorage.setItem('auth_token', newToken)

      if (expiresIn) {
        const expiration = Date.now() + expiresIn * 1000
        tokenExpiration.value = expiration
        localStorage.setItem('token_expiration', expiration.toString())
        setupAutoRefresh()
      }
    } else {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('token_expiration')
      tokenExpiration.value = null
      clearAutoRefresh()
    }
  }

  function setRefreshToken(marker) {
    refreshTokenMarker.value = marker
    if (marker) {
      localStorage.setItem('refresh_token', marker)
    } else {
      localStorage.removeItem('refresh_token')
    }
  }

  function setBaseUrl(data) {
    if (data) {
      hostname.value = data.hostname || data
      port.value = data.port || 443

      localStorage.setItem('hostname', hostname.value)
      localStorage.setItem('port', port.value.toString())
    } else {
      hostname.value = null
      port.value = null
      localStorage.removeItem('hostname')
      localStorage.removeItem('port')
    }
  }

  function setUserProfile(profile) {
    userProfile.value = profile
    if (profile) {
      localStorage.setItem('user_profile', JSON.stringify(profile))
    } else {
      localStorage.removeItem('user_profile')
    }
  }

  function getTokenTimeRemaining() {
    if (!tokenExpiration.value) return null
    const remaining = tokenExpiration.value - Date.now()
    return Math.max(0, remaining)
  }

  function setupAutoRefresh() {
    clearAutoRefresh()

    const remaining = getTokenTimeRemaining()
    if (!remaining || remaining <= 0) return

    // Refresh 5 minutes before expiration (or at 50% if less than 10 minutes total)
    const refreshTime = Math.min(remaining - 5 * 60 * 1000, remaining * 0.5)

    if (refreshTime > 0) {
      refreshTimer = setTimeout(async () => {
        const { refreshToken } = await import('../services/auth')
        try {
          await refreshToken()
        } catch (e) {
          console.error('Auto-refresh failed:', e)
        }
      }, refreshTime)
    }
  }

  function clearAutoRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
  }

  async function logout() {
    // Revoke token at proxy
    if (refreshTokenMarker.value) {
      try {
        await revokeTokenService()
      } catch (e) {
        console.error('Failed to revoke token:', e)
      }
    }

    // Clear all state
    token.value = null
    tokenExpiration.value = null
    refreshTokenMarker.value = null
    hostname.value = null
    port.value = null
    userProfile.value = null

    // Clear localStorage
    localStorage.removeItem('auth_token')
    localStorage.removeItem('token_expiration')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('hostname')
    localStorage.removeItem('port')
    localStorage.removeItem('user_profile')
    localStorage.removeItem('redirectAfterLogin')

    clearAutoRefresh()
  }

  return {
    // State
    token,
    tokenExpiration,
    refreshTokenMarker,
    hostname,
    port,
    userProfile,
    // Getters
    isAuthenticated,
    baseUrl,
    // Actions
    initialize,
    setToken,
    setRefreshToken,
    setBaseUrl,
    setUserProfile,
    getTokenTimeRemaining,
    logout
  }
})
