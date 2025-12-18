<template>
  <div class="min-h-screen bg-gray-50 py-6 px-4 sm:px-6 lg:px-8">
    <div class="max-w-4xl mx-auto">
      <!-- Header -->
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">{{ appTitle }}</h1>
          <p class="text-sm text-gray-500">Logged in as {{ authStore.userProfile?.email || 'Unknown' }}</p>
        </div>
        <div class="flex items-center space-x-4">
          <a
            href="https://github.com/klaushofrichter/een-oauth-proxy/tree/develop"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-gray-400 hover:text-blue-600 hover:underline"
          >Admin v{{ appVersion }}</a>
          <button
            :disabled="isLoggingOut"
            class="px-4 py-2 bg-gray-600 text-white text-sm rounded-md hover:bg-gray-700 disabled:opacity-50"
            @click="handleLogout"
          >
            {{ isLoggingOut ? 'Logging out...' : 'Logout' }}
          </button>
        </div>
      </div>

      <!-- Error Banner -->
      <div v-if="error" class="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
        <p class="text-red-700">{{ error }}</p>
        <button class="mt-2 text-sm text-red-600 hover:text-red-800 underline" @click="error = null">
          Dismiss
        </button>
      </div>

      <!-- Success Banner -->
      <div v-if="successMessage" class="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
        <p class="text-green-700">{{ successMessage }}</p>
        <button class="mt-2 text-sm text-green-600 hover:text-green-800 underline" @click="successMessage = null">
          Dismiss
        </button>
      </div>

      <!-- Proxy Health Card -->
      <div class="bg-white shadow rounded-lg p-6 mb-6">
        <div class="flex justify-between items-start mb-4">
          <div>
            <h3 class="text-lg font-medium text-gray-900">Proxy Health</h3>
            <p class="text-xs text-gray-500 font-mono mt-1">{{ proxyUrl }}</p>
          </div>
          <div class="flex items-center space-x-2">
            <span v-if="healthAutoRefresh" class="text-xs text-gray-400">Auto-refresh: 1 min</span>
            <button
              :disabled="loadingHealth"
              class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
              @click="checkHealth"
            >
              {{ loadingHealth ? 'Checking...' : 'Check Health' }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Status -->
          <div class="p-4 bg-gray-50 rounded-lg">
            <p class="text-xs font-medium text-gray-500 mb-1">Status</p>
            <div v-if="loadingHealth && !healthStatus" class="animate-pulse h-6 bg-gray-200 rounded w-16"></div>
            <div v-else class="flex items-center">
              <span
                class="inline-block w-3 h-3 rounded-full mr-2"
                :class="healthStatus === 'ok' ? 'bg-green-500' : 'bg-red-500'"
              ></span>
              <span class="font-medium" :class="healthStatus === 'ok' ? 'text-green-700' : 'text-red-700'">
                {{ healthStatus === 'ok' ? 'Healthy' : (healthStatus || 'Unknown') }}
              </span>
            </div>
          </div>

          <!-- Proxy Version -->
          <div class="p-4 bg-gray-50 rounded-lg">
            <p class="text-xs font-medium text-gray-500 mb-1">Proxy Version</p>
            <div v-if="loadingHealth && !proxyVersion" class="animate-pulse h-6 bg-gray-200 rounded w-20"></div>
            <p v-else class="font-mono text-gray-900">{{ proxyVersion || 'Unknown' }}</p>
          </div>

          <!-- Last Checked -->
          <div class="p-4 bg-gray-50 rounded-lg">
            <p class="text-xs font-medium text-gray-500 mb-1">Last Checked</p>
            <div v-if="loadingHealth && !lastHealthCheck" class="animate-pulse h-6 bg-gray-200 rounded w-24"></div>
            <p v-else class="text-gray-900">{{ lastHealthCheckText }}</p>
          </div>
        </div>

        <!-- Health Error -->
        <div v-if="healthError" class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p class="text-sm text-red-700">{{ healthError }}</p>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <!-- Sessions Card -->
        <div class="bg-white shadow rounded-lg p-6">
          <h3 class="text-sm font-medium text-gray-500 mb-2">Active Sessions</h3>
          <div v-if="loadingSessions" class="animate-pulse h-8 bg-gray-200 rounded w-16"></div>
          <p v-else class="text-3xl font-bold text-gray-900">{{ sessionCount ?? '—' }}</p>
          <button
            class="mt-4 text-sm text-blue-600 hover:text-blue-800"
            @click="fetchSessionCount"
          >
            Refresh
          </button>
        </div>

        <!-- Version Info Card -->
        <div class="bg-white shadow rounded-lg p-6">
          <h3 class="text-sm font-medium text-gray-500 mb-2">Version Info</h3>
          <div class="space-y-2">
            <div class="flex justify-between">
              <span class="text-sm text-gray-600">Admin App:</span>
              <span class="text-sm font-mono text-gray-900">v{{ appVersion }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-sm text-gray-600">Proxy:</span>
              <span class="text-sm font-mono text-gray-900">{{ proxyVersion || 'Unknown' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="bg-white shadow rounded-lg overflow-hidden">
        <div class="px-4 py-5 sm:px-6 border-b border-gray-200">
          <h3 class="text-lg font-medium text-gray-900">Admin Actions</h3>
          <p class="mt-1 text-sm text-gray-500">Manage sessions and tokens</p>
        </div>

        <div class="p-6 space-y-4">
          <!-- Remove Other Sessions -->
          <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h4 class="font-medium text-gray-900">Remove Other Sessions</h4>
              <p class="text-sm text-gray-500">
                Remove all sessions except your current one. Other users will need to log in again.
              </p>
            </div>
            <button
              :disabled="isRemovingSessions"
              class="px-4 py-2 bg-yellow-600 text-white text-sm rounded-md hover:bg-yellow-700 disabled:opacity-50 flex-shrink-0 ml-4"
              @click="handleRemoveSessions"
            >
              {{ isRemovingSessions ? 'Removing...' : 'Remove Sessions' }}
            </button>
          </div>

          <!-- Revoke All Tokens -->
          <div class="flex items-center justify-between p-4 bg-red-50 rounded-lg border border-red-200">
            <div>
              <h4 class="font-medium text-red-900">Revoke All Tokens (Emergency)</h4>
              <p class="text-sm text-red-700">
                Immediately revoke all tokens and remove all sessions. This includes your current session.
                Use only in emergency situations.
              </p>
            </div>
            <button
              :disabled="isRevokingAll"
              class="px-4 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 disabled:opacity-50 flex-shrink-0 ml-4"
              @click="confirmRevokeAll"
            >
              {{ isRevokingAll ? 'Revoking...' : 'Revoke All' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Confirmation Modal -->
      <div
        v-if="showConfirmModal"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      >
        <div class="bg-white rounded-lg p-6 max-w-md mx-4">
          <h3 class="text-lg font-bold text-red-600 mb-4">Confirm Revoke All Tokens</h3>
          <p class="text-gray-700 mb-6">
            This will immediately revoke all tokens and log out all users, including yourself.
            This action cannot be undone.
          </p>
          <div class="flex space-x-4">
            <button
              class="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
              @click="showConfirmModal = false"
            >
              Cancel
            </button>
            <button
              class="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              @click="handleRevokeAll"
            >
              Revoke All
            </button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <p class="mt-8 text-center text-xs text-gray-500">
        <a
          href="https://github.com/klaushofrichter/een-oauth-proxy/tree/develop"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-blue-600 hover:underline"
        >
          v{{ appVersion }}
        </a>
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getHealth, getProxyUrl, getSessionsCount, removeSessions, revokeAll } from '../services/admin'
import packageJson from '../../package.json'

const router = useRouter()
const authStore = useAuthStore()

// State
const sessionCount = ref(null)
const loadingSessions = ref(false)
const isRemovingSessions = ref(false)
const isRevokingAll = ref(false)
const isLoggingOut = ref(false)
const error = ref(null)
const successMessage = ref(null)
const showConfirmModal = ref(false)

// Health check state
const healthStatus = ref(null)
const proxyVersion = ref(null)
const lastHealthCheck = ref(null)
const loadingHealth = ref(false)
const healthError = ref(null)
const healthAutoRefresh = ref(true)

// Auto-refresh interval
let healthInterval = null
const HEALTH_CHECK_INTERVAL = 60000 // 1 minute

const appTitle = computed(() => packageJson.displayName || packageJson.name)
const appVersion = computed(() => packageJson.version)
const proxyUrl = computed(() => getProxyUrl())

const lastHealthCheckText = computed(() => {
  if (!lastHealthCheck.value) return 'Never'
  const now = Date.now()
  const diff = now - lastHealthCheck.value
  if (diff < 60000) return 'Just now'
  const minutes = Math.floor(diff / 60000)
  return `${minutes} min ago`
})

// Check proxy health
async function checkHealth() {
  loadingHealth.value = true
  healthError.value = null

  try {
    const data = await getHealth()
    healthStatus.value = data.status
    proxyVersion.value = data.version
    lastHealthCheck.value = Date.now()
  } catch (e) {
    healthStatus.value = 'error'
    healthError.value = e.message || 'Health check failed'
    lastHealthCheck.value = Date.now()
  } finally {
    loadingHealth.value = false
  }
}

// Start auto-refresh
function startHealthAutoRefresh() {
  if (healthInterval) return
  healthInterval = setInterval(checkHealth, HEALTH_CHECK_INTERVAL)
  healthAutoRefresh.value = true
}

// Stop auto-refresh
function stopHealthAutoRefresh() {
  if (healthInterval) {
    clearInterval(healthInterval)
    healthInterval = null
  }
  healthAutoRefresh.value = false
}

// Fetch session count
async function fetchSessionCount() {
  loadingSessions.value = true
  error.value = null

  try {
    const data = await getSessionsCount()
    sessionCount.value = data.sessionCount
  } catch (e) {
    error.value = e.message || 'Failed to fetch session count'
  } finally {
    loadingSessions.value = false
  }
}

// Remove other sessions
async function handleRemoveSessions() {
  isRemovingSessions.value = true
  error.value = null
  successMessage.value = null

  try {
    const result = await removeSessions()
    successMessage.value = `Removed ${result.deletedSessions} session(s). ${result.remainingSessions} session(s) remaining.`
    // Refresh session count
    await fetchSessionCount()
  } catch (e) {
    error.value = e.message || 'Failed to remove sessions'
  } finally {
    isRemovingSessions.value = false
  }
}

// Show confirmation for revoke all
function confirmRevokeAll() {
  showConfirmModal.value = true
}

// Revoke all tokens
async function handleRevokeAll() {
  showConfirmModal.value = false
  isRevokingAll.value = true
  error.value = null

  try {
    await revokeAll()

    // Clear local auth state and redirect to login
    await authStore.logout()
    router.push('/')
  } catch (e) {
    error.value = e.message || 'Failed to revoke all tokens'
    isRevokingAll.value = false
  }
}

// Logout
async function handleLogout() {
  isLoggingOut.value = true

  try {
    await authStore.logout()
    router.push('/')
  } catch (e) {
    console.error('Logout error:', e)
    router.push('/')
  }
}

// Fetch user profile from EEN API
async function fetchUserProfile() {
  if (authStore.userProfile) return

  try {
    const response = await fetch(`${authStore.baseUrl}/api/v3.0/users/self`, {
      headers: {
        Authorization: `Bearer ${authStore.token}`,
        Accept: 'application/json'
      }
    })

    if (response.ok) {
      const data = await response.json()
      authStore.setUserProfile({
        id: data.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email
      })
    }
  } catch (e) {
    console.error('Failed to fetch user profile:', e)
  }
}

onMounted(async () => {
  document.title = `${appTitle.value} - Dashboard`

  // Fetch data in parallel
  await Promise.all([
    checkHealth(),
    fetchSessionCount(),
    fetchUserProfile()
  ])

  // Start auto-refresh for health checks
  startHealthAutoRefresh()
})

onUnmounted(() => {
  stopHealthAutoRefresh()
})
</script>
