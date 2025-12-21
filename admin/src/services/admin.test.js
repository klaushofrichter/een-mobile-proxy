/**
 * Unit tests for admin service URL validation functions
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isValidProxyUrl, setProxyUrl, getProxyUrl, getProxyUrlOrThrow, getProxyOptions } from './admin.js'

describe('Admin Service - URL Validation', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
  })

  describe('isValidProxyUrl', () => {
    it('should accept localhost URLs', () => {
      expect(isValidProxyUrl('http://localhost:8787')).toBe(true)
      expect(isValidProxyUrl('http://localhost')).toBe(true)
      expect(isValidProxyUrl('https://localhost:8787')).toBe(true)
    })

    it('should accept 127.0.0.1 URLs', () => {
      expect(isValidProxyUrl('http://127.0.0.1:8787')).toBe(true)
      expect(isValidProxyUrl('http://127.0.0.1')).toBe(true)
      expect(isValidProxyUrl('https://127.0.0.1:3000')).toBe(true)
    })

    it('should accept IPv6 localhost (::1) URLs', () => {
      expect(isValidProxyUrl('http://[::1]:8787')).toBe(true)
      expect(isValidProxyUrl('http://[::1]')).toBe(true)
      expect(isValidProxyUrl('https://[::1]:3000')).toBe(true)
    })

    it('should reject malformed URLs', () => {
      expect(isValidProxyUrl('not-a-url')).toBe(false)
      expect(isValidProxyUrl('')).toBe(false)
      expect(isValidProxyUrl('http://')).toBe(false)
    })

    it('should reject URLs with unknown hostnames', () => {
      expect(isValidProxyUrl('http://evil.com')).toBe(false)
      expect(isValidProxyUrl('https://attacker.example.com')).toBe(false)
      expect(isValidProxyUrl('http://192.168.1.1')).toBe(false)
    })

    it('should handle URLs with paths and query strings', () => {
      expect(isValidProxyUrl('http://localhost:8787/api')).toBe(true)
      expect(isValidProxyUrl('http://localhost:8787?foo=bar')).toBe(true)
      expect(isValidProxyUrl('http://evil.com/api')).toBe(false)
    })

    it('should handle case sensitivity in hostnames', () => {
      expect(isValidProxyUrl('http://LOCALHOST:8787')).toBe(true)
      expect(isValidProxyUrl('http://LocalHost:8787')).toBe(true)
    })
  })

  describe('setProxyUrl', () => {
    it('should store valid localhost URLs and return true', () => {
      const result = setProxyUrl('http://localhost:8787')
      expect(result).toBe(true)
      expect(localStorage.getItem('een_proxy_url')).toBe('http://localhost:8787')
    })

    it('should store valid 127.0.0.1 URLs and return true', () => {
      const result = setProxyUrl('http://127.0.0.1:8787')
      expect(result).toBe(true)
      expect(localStorage.getItem('een_proxy_url')).toBe('http://127.0.0.1:8787')
    })

    it('should reject invalid URLs and return false', () => {
      const result = setProxyUrl('http://evil.com')
      expect(result).toBe(false)
      expect(localStorage.getItem('een_proxy_url')).toBeNull()
    })

    it('should reject malformed URLs and return false', () => {
      const result = setProxyUrl('not-a-url')
      expect(result).toBe(false)
      expect(localStorage.getItem('een_proxy_url')).toBeNull()
    })

    it('should not overwrite valid URL with invalid URL', () => {
      setProxyUrl('http://localhost:8787')
      const result = setProxyUrl('http://evil.com')
      expect(result).toBe(false)
      expect(localStorage.getItem('een_proxy_url')).toBe('http://localhost:8787')
    })
  })

  describe('getProxyUrl', () => {
    it('should return stored URL when valid', () => {
      localStorage.setItem('een_proxy_url', 'http://localhost:8787')
      expect(getProxyUrl()).toBe('http://localhost:8787')
    })

    it('should return default when no URL stored', () => {
      const url = getProxyUrl()
      // In dev environment, should return localhost default
      expect(url).toBe('http://localhost:8787')
    })

    it('should return stored 127.0.0.1 URL', () => {
      localStorage.setItem('een_proxy_url', 'http://127.0.0.1:8787')
      expect(getProxyUrl()).toBe('http://127.0.0.1:8787')
    })

    it('should return stored IPv6 localhost URL', () => {
      localStorage.setItem('een_proxy_url', 'http://[::1]:9000')
      expect(getProxyUrl()).toBe('http://[::1]:9000')
    })
  })

  describe('getProxyOptions', () => {
    it('should return array of options', () => {
      const options = getProxyOptions()
      expect(Array.isArray(options)).toBe(true)
    })

    it('should include local option in development', () => {
      const options = getProxyOptions()
      const localOption = options.find(opt => opt.value === 'http://localhost:8787')
      expect(localOption).toBeTruthy()
    })
  })

  describe('getProxyUrlOrThrow', () => {
    it('should return URL when configured via setProxyUrl', () => {
      setProxyUrl('http://localhost:8787')
      expect(getProxyUrlOrThrow()).toBe('http://localhost:8787')
    })

    it('should return default localhost URL in dev when nothing stored', () => {
      // In dev environment (import.meta.env.PROD = false), should return default localhost
      const url = getProxyUrlOrThrow()
      expect(url).toBe('http://localhost:8787')
    })

    it('should return stored IPv6 localhost URL', () => {
      setProxyUrl('http://[::1]:8787')
      expect(getProxyUrlOrThrow()).toBe('http://[::1]:8787')
    })

    it('should return same value as getProxyUrl in dev mode', () => {
      // Verify getProxyUrlOrThrow returns exactly what getProxyUrl returns
      // This ensures the pass-through behavior is correct
      const proxyUrl = getProxyUrl()
      const proxyUrlOrThrow = getProxyUrlOrThrow()
      expect(proxyUrlOrThrow).toBe(proxyUrl)
    })

    // Note: The throw behavior when getProxyUrl() returns null occurs only in production
    // when VITE_PROXY_URL is not set. This is tested via Playwright integration tests
    // that verify proper error handling when the proxy is misconfigured.
  })
})
