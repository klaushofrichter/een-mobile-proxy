<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <h1 class="text-2xl font-bold text-gray-900">Direct Access</h1>
        <p class="mt-2 text-gray-600">Enter your access token and API base URL</p>
      </div>

      <div v-if="error" class="bg-red-50 border border-red-200 rounded-lg p-4">
        <p class="text-red-700">{{ error }}</p>
      </div>

      <form class="bg-white shadow rounded-lg p-8 space-y-6" @submit.prevent="handleSubmit">
        <div>
          <label for="token" class="block text-sm font-medium text-gray-700">
            Access Token
          </label>
          <input
            id="token"
            v-model="token"
            type="password"
            required
            autocomplete="off"
            class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="Enter your access token"
          />
        </div>

        <div class="grid grid-cols-3 gap-4">
          <div class="col-span-2">
            <label for="hostname" class="block text-sm font-medium text-gray-700">
              Base URL
            </label>
            <input
              id="hostname"
              v-model="hostname"
              type="text"
              required
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="api.c021.eagleeyenetworks.com"
            />
          </div>
          <div>
            <label for="port" class="block text-sm font-medium text-gray-700">
              Port
            </label>
            <input
              id="port"
              v-model.number="port"
              type="number"
              required
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="443"
            />
          </div>
        </div>

        <div class="flex space-x-4">
          <button
            type="button"
            class="flex-1 py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            @click="router.push('/')"
          >
            Back to Login
          </button>
          <button
            type="submit"
            :disabled="isLoading"
            class="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            <span v-if="isLoading" class="flex items-center justify-center">
              <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Verifying...
            </span>
            <span v-else>Proceed</span>
          </button>
        </div>
      </form>

      <p class="text-center text-xs text-gray-500">
        <a
          :href="githubRepoUrl"
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
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getUserProfile } from '../services/user'
import packageJson from '../../package.json'

const router = useRouter()
const authStore = useAuthStore()

const token = ref('')
const hostname = ref('api.c021.eagleeyenetworks.com')
const port = ref(443)
const error = ref(null)
const isLoading = ref(false)

const appTitle = computed(() => packageJson.displayName || packageJson.name)
const appVersion = computed(() => packageJson.version)
const githubRepoUrl = computed(() => {
  const baseUrl = import.meta.env.VITE_GITHUB_REPO || 'https://github.com/your-username/een-oauth-proxy'
  const branch = import.meta.env.VITE_GITHUB_BRANCH || 'develop'
  return `${baseUrl}/tree/${branch}`
})

onMounted(() => {
  document.title = `${appTitle.value} - Direct Access`
})

async function handleSubmit() {
  if (!token.value || !hostname.value || !port.value) {
    error.value = 'Please fill in all fields'
    return
  }

  isLoading.value = true
  error.value = null

  try {
    // Set credentials first
    authStore.setBaseUrl({ hostname: hostname.value, port: port.value })
    authStore.setToken(token.value)

    // Verify token by fetching user profile
    const userData = await getUserProfile()

    // Store user profile
    authStore.setUserProfile({
      id: userData.id,
      firstName: userData.firstName,
      lastName: userData.lastName,
      email: userData.email
    })

    // Navigate to profile
    router.push('/profile')
  } catch (e) {
    error.value = e.message || 'Invalid credentials'
    // Clear invalid credentials
    authStore.setToken(null)
    authStore.setBaseUrl(null)
  } finally {
    isLoading.value = false
  }
}
</script>
