/**
 * Unit tests for CSP plugin URL matching logic
 * Tests localhost detection and false positive prevention
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cspPlugin } from './vite-plugin-csp.js'

describe('CSP Plugin URL Matching', () => {
  let originalEnv

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env }
    // Clear VITE_PROXY_URL for each test
    delete process.env.VITE_PROXY_URL
  })

  afterEach(() => {
    // Restore original env
    process.env = originalEnv
  })

  describe('Localhost Detection', () => {
    it('should detect localhost correctly', () => {
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\' http://localhost:8787;" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should not add localhost again if already present
      const localhostCount = (result.match(/localhost:8787/g) || []).length
      expect(localhostCount).toBe(1)
    })

    it('should detect 127.0.0.1 correctly', () => {
      process.env.VITE_PROXY_URL = 'http://127.0.0.1:8787'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should not add 127.0.0.1 if it's already in the default list
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).toContain('127.0.0.1:8787')
      // Should not duplicate it
      const count = (resultParts.match(/127\.0\.0\.1:8787/g) || []).length
      expect(count).toBe(1)
    })

    it('should detect IPv6 localhost [::1]', () => {
      process.env.VITE_PROXY_URL = 'http://[::1]:8787'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should not add [::1] as it's a localhost variant
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).not.toContain('[::1]')
    })

    it('should detect 127.x.x.x subnets', () => {
      process.env.VITE_PROXY_URL = 'http://127.1.2.3:8787'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should not add 127.x.x.x as it's a localhost variant
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).not.toContain('127.1.2.3')
    })

    it('should detect .localhost TLD', () => {
      process.env.VITE_PROXY_URL = 'http://myapp.localhost:8787'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should not add .localhost domains as they're localhost variants
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).not.toContain('myapp.localhost')
    })
  })

  describe('False Positive Prevention', () => {
    it('should not match "my-localhost-server.com" as localhost', () => {
      process.env.VITE_PROXY_URL = 'https://my-localhost-server.com'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should add the URL since it's not actually localhost
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).toContain('my-localhost-server.com')
    })

    it('should not match "127example.com" as localhost', () => {
      process.env.VITE_PROXY_URL = 'https://127example.com'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should add the URL since it's not actually 127.x.x.x
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).toContain('127example.com')
    })

    it('should handle URLs with different ports correctly', () => {
      process.env.VITE_PROXY_URL = 'http://localhost:9999'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should not add localhost:9999 as it's still localhost
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).not.toContain('localhost:9999')
    })

    it('should handle duplicate URLs correctly', () => {
      process.env.VITE_PROXY_URL = 'https://example.com'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\' https://example.com;" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should not duplicate the URL
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      const count = (resultParts.match(/example\.com/g) || []).length
      expect(count).toBe(1)
    })

    it('should handle URLs with same hostname but different protocols', () => {
      process.env.VITE_PROXY_URL = 'https://example.com'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\' http://example.com;" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should add https version since http is different
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).toContain('http://example.com')
      expect(resultParts).toContain('https://example.com')
    })
  })

  describe('URL Parsing Edge Cases', () => {
    it('should handle invalid URLs gracefully', () => {
      process.env.VITE_PROXY_URL = 'not-a-valid-url'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = cspPlugin()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      
      const result = plugin.transformIndexHtml(html)
      
      // Should log warning and not add invalid URL
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid proxy URL format'))
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).not.toContain('not-a-valid-url')
      
      consoleSpy.mockRestore()
    })

    it('should handle empty VITE_PROXY_URL', () => {
      process.env.VITE_PROXY_URL = ''
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should use default localhost
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).toContain('localhost:8787')
    })

    it('should handle URLs with paths', () => {
      process.env.VITE_PROXY_URL = 'https://example.com/api'
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = cspPlugin()
      const result = plugin.transformIndexHtml(html)
      
      // Should add the full URL including path
      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).toContain('https://example.com/api')
    })
  })
})

