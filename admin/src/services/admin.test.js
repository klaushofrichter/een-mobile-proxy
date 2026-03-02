/**
 * Unit tests for admin service (same-origin, relative URLs)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getRateLimitStats, verifyAdminAccess, getHealth, getVersion, getSessionsCount, removeSessions, revokeAll } from './admin.js'

// Mock the auth-headers module to avoid Pinia dependency
vi.mock('../utils/auth-headers', () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({ 'Authorization': 'Bearer test-session-id' })
}))

describe('Admin Service - Same-Origin API Calls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('verifyAdminAccess', () => {
    it('should return true for admin users', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      expect(await verifyAdminAccess()).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith('/admin/version', expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-session-id' })
      }))
    })

    it('should return false for non-admin users (403)', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 })
      expect(await verifyAdminAccess()).toBe(false)
    })

    it('should throw on 401', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 })
      await expect(verifyAdminAccess()).rejects.toThrow('Authentication required')
    })

    it('should use relative URL (no host prefix)', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      await verifyAdminAccess()
      expect(global.fetch).toHaveBeenCalledWith('/admin/version', expect.any(Object))
    })

    it('should not include credentials: include (same-origin)', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
      await verifyAdminAccess()
      const callArgs = global.fetch.mock.calls[0][1]
      expect(callArgs.credentials).toBeUndefined()
    })
  })

  describe('getHealth', () => {
    it('should fetch health with relative URL', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' })
      })
      const result = await getHealth()
      expect(result.status).toBe('ok')
      expect(global.fetch).toHaveBeenCalledWith('/health', expect.any(Object))
    })

    it('should throw on timeout', async () => {
      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}))
      // The function uses AbortController with 10s timeout - we test the error path
      global.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      await expect(getHealth()).rejects.toThrow('Health check timed out')
    })
  })

  describe('getVersion', () => {
    it('should fetch version with auth headers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '1.0.0' })
      })
      const result = await getVersion()
      expect(result.version).toBe('1.0.0')
      expect(global.fetch).toHaveBeenCalledWith('/admin/version', expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-session-id' })
      }))
    })
  })

  describe('getSessionsCount', () => {
    it('should fetch session count', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sessionCount: 5, truncated: false })
      })
      const result = await getSessionsCount()
      expect(result.sessionCount).toBe(5)
      expect(global.fetch).toHaveBeenCalledWith('/admin/sessionsCount', expect.any(Object))
    })
  })

  describe('removeSessions', () => {
    it('should send DELETE to relative URL', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ deletedSessions: 3, remainingSessions: 1 })
      })
      const result = await removeSessions()
      expect(result.deletedSessions).toBe(3)
      expect(global.fetch).toHaveBeenCalledWith('/admin/removeSessions', expect.objectContaining({
        method: 'DELETE'
      }))
    })
  })

  describe('revokeAll', () => {
    it('should send POST to relative URL', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'All tokens revoked' })
      })
      await revokeAll()
      expect(global.fetch).toHaveBeenCalledWith('/admin/revokeAll', expect.objectContaining({
        method: 'POST'
      }))
    })
  })
})

describe('Admin Service - getRateLimitStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch rate limit stats successfully', async () => {
    const mockStats = {
      enabled: true,
      window: 60,
      limits: { health: 100, oauth: 30, admin: 50 },
      currentBucket: 1234567,
      activeEntries: 42,
      byCategory: {
        health: { count: 150, uniqueClients: 12 },
        oauth: { count: 45, uniqueClients: 8 },
        admin: { count: 10, uniqueClients: 2 }
      }
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStats)
    })

    const result = await getRateLimitStats()

    expect(result).toEqual(mockStats)
    expect(result.enabled).toBe(true)
    expect(result.limits.health).toBe(100)
    expect(result.byCategory.oauth.count).toBe(45)
  })

  it('should throw error on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Unauthorized' })
    })

    await expect(getRateLimitStats()).rejects.toThrow('Unauthorized')
  })

  it('should throw generic error when response has no error message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error('Parse error'))
    })

    await expect(getRateLimitStats()).rejects.toThrow('Failed to get rate limit stats')
  })

  it('should use relative URL and auth headers', async () => {
    const mockStats = { enabled: true, window: 60, limits: {}, byCategory: {}, activeEntries: 0 }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStats)
    })

    await getRateLimitStats()

    expect(global.fetch).toHaveBeenCalledWith(
      '/admin/rateLimitStats',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-session-id' })
      })
    )
    // Should NOT have credentials: 'include' (same-origin)
    const callArgs = global.fetch.mock.calls[0][1]
    expect(callArgs.credentials).toBeUndefined()
  })

  it('should handle rate limiting disabled state', async () => {
    const mockStats = {
      enabled: false,
      window: 60,
      limits: { health: 0, oauth: 0, admin: 0 },
      currentBucket: 0,
      activeEntries: 0,
      byCategory: {
        health: { count: 0, uniqueClients: 0 },
        oauth: { count: 0, uniqueClients: 0 },
        admin: { count: 0, uniqueClients: 0 }
      }
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStats)
    })

    const result = await getRateLimitStats()

    expect(result.enabled).toBe(false)
    expect(result.activeEntries).toBe(0)
  })
})
