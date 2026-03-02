/**
 * Unit tests for simplified CSP plugin (same-origin, no proxy URL injection)
 */

import { describe, it, expect, vi } from 'vitest'

// No need to mock vite's loadEnv - the simplified plugin doesn't use it
const { cspPlugin } = await import('./vite-plugin-csp.js')

describe('CSP Plugin', () => {
  function createPlugin() {
    return cspPlugin()
  }

  describe('CSP Directive Injection', () => {
    it('should replace connect-src with self and EEN domains', () => {
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = createPlugin()
      const result = plugin.transformIndexHtml(html)

      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).toContain("'self'")
      expect(resultParts).toContain('https://auth.eagleeyenetworks.com')
      expect(resultParts).toContain('https://*.eagleeyenetworks.com')
    })

    it('should not include any localhost references', () => {
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = createPlugin()
      const result = plugin.transformIndexHtml(html)

      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).not.toContain('localhost')
      expect(resultParts).not.toContain('127.0.0.1')
    })

    it('should include the EEN wildcard pattern', () => {
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />'
      const plugin = createPlugin()
      const result = plugin.transformIndexHtml(html)

      const resultParts = result.match(/connect-src\s+([^;"]+)/i)?.[1] || ''
      expect(resultParts).toContain('https://*.eagleeyenetworks.com')
    })

    it('should handle connect-src as last directive (no semicolon after)', () => {
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\'" />'
      const plugin = createPlugin()
      const result = plugin.transformIndexHtml(html)

      expect(result).toContain('https://auth.eagleeyenetworks.com')
    })
  })

  describe('Edge Cases', () => {
    it('should warn and return unchanged HTML when connect-src not found', () => {
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'" />'
      const plugin = createPlugin()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = plugin.transformIndexHtml(html)

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('connect-src directive not found'))
      expect(result).toBe(html)

      consoleSpy.mockRestore()
    })

    it('should handle empty HTML', () => {
      const plugin = createPlugin()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = plugin.transformIndexHtml('')
      expect(result).toBe('')

      consoleSpy.mockRestore()
    })
  })
})
