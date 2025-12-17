/**
 * User service for EEN API
 */

import { useAuthStore } from '../stores/auth'

/**
 * Fetch user profile from EEN API
 */
export async function getUserProfile() {
  const authStore = useAuthStore()

  if (!authStore.baseUrl || !authStore.token) {
    throw new Error('Not authenticated')
  }

  const response = await fetch(`${authStore.baseUrl}/api/v3.0/users/self`, {
    headers: {
      Authorization: `Bearer ${authStore.token}`,
      Accept: 'application/json'
    }
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Token expired or invalid')
    }
    throw new Error('Failed to fetch user profile')
  }

  return response.json()
}
