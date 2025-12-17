import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getAuthUrl } from '../services/auth'

const routes = [
  {
    path: '/',
    name: 'login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/direct',
    name: 'direct',
    component: () => import('../views/Direct.vue')
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('../views/Profile.vue'),
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    // Store intended destination
    localStorage.setItem('redirectAfterLogin', to.fullPath)

    // Redirect to EEN OAuth
    window.location.href = getAuthUrl()
    return
  }

  next()
})

export default router
