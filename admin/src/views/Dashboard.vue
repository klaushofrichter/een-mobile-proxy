<template>
  <div class="min-h-screen bg-gray-50 py-6 px-4 sm:px-6 lg:px-8">
    <div class="max-w-4xl mx-auto">
      <!-- Header -->
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">OAuth Proxy Admin</h1>
          <p class="text-sm text-gray-500">Logged in as {{ authStore.userProfile?.email || 'Unknown' }}</p>
        </div>
        <button
          :disabled="isLoggingOut"
          class="px-4 py-2 bg-gray-600 text-white text-sm rounded-md hover:bg-gray-700 disabled:opacity-50"
          @click="handleLogout"
        >
          {{ isLoggingOut ? 'Logging out...' : 'Logout' }}
        </button>
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

      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <!-- Version Card -->
        <div class="bg-white shadow rounded-lg p-6">
          <h3 class="text-sm font-medium text-gray-500 mb-2">Proxy Version</h3>
          <div v-if="loadingVersion" class="animate-pulse h-6 bg-gray-200 rounded w-3/4"></div>
          <p v-else class="text-lg font-mono text-gray-900">{{ version || 'Unknown' }}</p>
          <button
            class="mt-4 text-sm text-primary-600 hover:text-primary-800"
            @click="fetchVersion"
          >
            Refresh
          </button>
        </div>

        <!-- Sessions Card -->
        <div class="bg-white shadow rounded-lg p-6">
          <h3 class="text-sm font-medium text-gray-500 mb-2">Active Sessions</h3>
          <div v-if="loadingSessions" class="animate-pulse h-6 bg-gray-200 rounded w-16"></div>
          <p v-else class="text-3xl font-bold text-gray-900">{{ sessionCount ?? '—' }}</p>
          <button
            class="mt-4 text-sm text-primary-600 hover:text-primary-800"
            @click="fetchSessionCount"
          >
            Refresh
          </button>
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
        Admin App v{{ appVersion }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getVersion, getSessionsCount, removeSessions, revokeAll } from '../services/admin'
import packageJson from '../../package.json'

const router = useRouter()
const authStore = useAuthStore()

// State
const version = ref(null)
const sessionCount = ref(null)
const loadingVersion = ref(false)
const loadingSessions = ref(false)
const isRemovingSessions = ref(false)
const isRevokingAll = ref(false)
const isLoggingOut = ref(false)
const error = ref(null)
const successMessage = ref(null)
const showConfirmModal = ref(false)

const appVersion = computed(() => packageJson.version)

// Fetch proxy version
async function fetchVersion() {
  loadingVersion.value = true
  error.value = null

  try {
    const data = await getVersion()
    version.value = data.version
  } catch (e) {
    error.value = e.message || 'Failed to fetch version'
  } finally {
    loadingVersion.value = false
  }
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
  document.title = 'EEN OAuth Admin - Dashboard'

  // Fetch data in parallel
  await Promise.all([
    fetchVersion(),
    fetchSessionCount(),
    fetchUserProfile()
  ])
})
</script>
