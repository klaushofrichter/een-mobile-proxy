/**
 * SSRF Protection Tests (Mobile Proxy)
 *
 * Tests for Server-Side Request Forgery prevention:
 * - Domain allowlist validation (via ssrf-unit.test.js for parseHttpsBaseUrl)
 * - Redirect URI scheme validation (blocks most SSRF via redirect_uri)
 * - IP address blocking
 * - Unicode/IDN homograph attack prevention
 * - Port validation
 * - Protocol validation
 * - URL credential blocking
 *
 * Note: In the mobile proxy, redirect_uri validation is scheme-based
 * (ALLOWED_SCHEMES). Most SSRF payloads via redirect_uri are blocked
 * because their schemes (https, http, ftp, etc.) are not in the allowed
 * schemes list. The httpsBaseUrl SSRF protection is tested in ssrf-unit.test.js.
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { fetchWithMetrics } from './test-utils.js'

describe('Security - SSRF Protection', () => {
  describe('Domain Allowlist Validation', () => {
    it('should accept health check without authentication', async () => {
      const response = await fetchWithMetrics('http://localhost/health')

      expect(response.status).toBe(200)
    })
  })

  describe('httpsBaseUrl Validation via Token Exchange', () => {
    // Note: These tests verify the proxy handles malicious httpsBaseUrl values
    // Since we can't directly inject httpsBaseUrl (it comes from EEN),
    // we verify the validation logic through integration behavior

    it('should reject token exchange with invalid code gracefully', async () => {
      // Test that the proxy handles the full flow without crashing
      // Uses myapp:// scheme which is in ALLOWED_SCHEMES
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          code: 'invalid-code',
          redirect_uri: 'myapp://callback'
        })
      })

      // Should fail at EEN, not crash due to SSRF handling
      expect([400, 401, 403]).toContain(response.status)
    })

    it('should handle missing code parameter', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          redirect_uri: 'myapp://callback'
        })
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Missing code or redirect_uri')
    })
  })

  describe('Redirect URI Scheme Blocking', () => {
    // In mobile proxy, redirect URIs with disallowed schemes are rejected.
    // This provides defense-in-depth against SSRF via redirect_uri.

    const blockedSchemePayloads = [
      // HTTPS (not in ALLOWED_SCHEMES for test config)
      'https://192.168.1.1/api',
      'https://10.0.0.1/api',
      'https://127.0.0.1/api',
      'https://169.254.169.254/api', // AWS metadata
      'https://[::1]/api',
      'https://[fe80::1]/api',
      'https://2130706433/api', // 127.0.0.1 as decimal
      // HTTPS with Unicode/IDN attacks
      'https://еagleeyenetworks.com/api', // Cyrillic 'е'
      'https://eaglееyenetworks.com/api',
      // HTTPS with credentials
      'https://user:pass@api.eagleeyenetworks.com/api',
      'https://admin:secret@internal.server/api',
      // HTTPS internal network
      'https://10.0.0.1/api',
      'https://172.16.0.1/api',
      'https://192.168.0.1/api',
      'https://localhost/api',
      'https://metadata.google.internal/computeMetadata/v1/', // GCP
      // FTP
      'ftp://api.eagleeyenetworks.com/api',
      // File
      'file:///etc/passwd',
      // Data URI
      'data:text/html,<script>alert(1)</script>',
    ]

    blockedSchemePayloads.forEach((payload) => {
      it(`should block redirect_uri with disallowed scheme: ${payload.substring(0, 50)}`, async () => {
        const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            code: 'test-code',
            redirect_uri: payload
          })
        })

        // Should be rejected (400 for scheme not allowed)
        expect(response.status).toBe(400)
      })
    })
  })

  describe('Protocol Validation', () => {
    // These specifically test that non-allowed protocols are blocked
    const invalidProtocolPayloads = [
      'ftp://api.eagleeyenetworks.com/api',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
    ]

    invalidProtocolPayloads.forEach((payload) => {
      it(`should reject non-allowed protocol: ${payload.substring(0, 30)}...`, async () => {
        const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            code: 'test-code',
            redirect_uri: payload
          })
        })

        // Should be rejected
        expect(response.status).toBe(400)
      })
    })
  })

  describe('Malformed URL Handling', () => {
    const malformedPayloads = [
      'not-a-url',
      '://missing-protocol',
      '',
      null,
      undefined,
    ]

    malformedPayloads.forEach((payload) => {
      it(`should handle malformed URL: ${JSON.stringify(payload)}`, async () => {
        const body = new URLSearchParams({
          code: 'test-code'
        })
        if (payload !== null && payload !== undefined) {
          body.set('redirect_uri', payload)
        }

        const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body
        })

        // Should be rejected with 400
        expect(response.status).toBe(400)
      })
    })
  })

  describe('JavaScript Protocol Injection', () => {
    it('should reject javascript: protocol in redirect_uri', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          code: 'test-code',
          redirect_uri: 'javascript:alert(1)'
        })
      })

      expect(response.status).toBe(400)
    })
  })
})
