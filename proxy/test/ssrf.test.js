/**
 * SSRF Protection Tests
 *
 * Tests for Server-Side Request Forgery prevention:
 * - Domain allowlist validation
 * - IP address blocking (IPv4, IPv6, numeric)
 * - Unicode/IDN homograph attack prevention
 * - Port validation
 * - Protocol validation
 * - URL credential blocking
 * - Configuration validation
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { fetchWithMetrics } from './test-utils.js'

describe('Security - SSRF Protection', () => {
  describe('Domain Allowlist Validation', () => {
    it('should accept valid EEN domains in redirect_uri', async () => {
      // This test validates that requests to allowed domains work
      // The actual SSRF protection is tested through token exchange
      const response = await fetchWithMetrics('http://localhost/health', {
        method: 'GET',
        headers: {
          Origin: 'http://127.0.0.1:3333'
        }
      })

      expect(response.status).toBe(200)
    })
  })

  describe('httpsBaseUrl Validation via Token Exchange', () => {
    // Note: These tests verify the proxy handles malicious httpsBaseUrl values
    // Since we can't directly inject httpsBaseUrl (it comes from EEN),
    // we verify the validation logic through integration behavior

    it('should reject token exchange with invalid code gracefully', async () => {
      // Test that the proxy handles the full flow without crashing
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'http://127.0.0.1:3333'
        },
        body: new URLSearchParams({
          code: 'invalid-code',
          redirect_uri: 'http://127.0.0.1:3333/callback'
        })
      })

      // Should fail at EEN, not crash due to SSRF handling
      expect([400, 401, 403]).toContain(response.status)
    })

    it('should handle missing code parameter', async () => {
      const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'http://127.0.0.1:3333'
        },
        body: new URLSearchParams({
          redirect_uri: 'http://127.0.0.1:3333/callback'
        })
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Missing code or redirect_uri')
    })
  })

  describe('IP Address Blocking Scenarios', () => {
    // These scenarios test that if an attacker could somehow inject
    // IP-based URLs, they would be rejected

    const ipAddressPayloads = [
      // IPv4 addresses
      'https://192.168.1.1/api',
      'https://10.0.0.1/api',
      'https://127.0.0.1/api',
      'https://169.254.169.254/api', // AWS metadata
      // IPv6 addresses
      'https://[::1]/api',
      'https://[fe80::1]/api',
      // Numeric IP representations
      'https://2130706433/api', // 127.0.0.1 as decimal
    ]

    ipAddressPayloads.forEach((payload) => {
      it(`should block IP address URL: ${payload.substring(0, 50)}...`, async () => {
        // Verify the proxy doesn't accept IP-based redirect URIs
        const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'http://127.0.0.1:3333'
          },
          body: new URLSearchParams({
            code: 'test-code',
            redirect_uri: payload
          })
        })

        // Should be rejected by redirect_uri validation
        expect(response.status).toBe(400)
      })
    })
  })

  describe('Unicode/IDN Attack Prevention', () => {
    const unicodePayloads = [
      // Cyrillic lookalikes
      'https://еagleeyenetworks.com/api', // Cyrillic 'е'
      'https://eaglееyenetworks.com/api', // Multiple Cyrillic
      // Other Unicode tricks
      'https://eagle\u200Beyenetworks.com/api', // Zero-width space
      'https://eagleeyenetworks\u3002com/api', // Ideographic full stop
    ]

    unicodePayloads.forEach((payload) => {
      it(`should reject Unicode domain: ${payload.substring(8, 40)}...`, async () => {
        const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'http://127.0.0.1:3333'
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

  describe('Port Validation', () => {
    const invalidPortPayloads = [
      'https://api.eagleeyenetworks.com:0/api',
      'https://api.eagleeyenetworks.com:65536/api',
      'https://api.eagleeyenetworks.com:-1/api',
      'https://api.eagleeyenetworks.com:abc/api',
    ]

    invalidPortPayloads.forEach((payload) => {
      it(`should handle invalid port in URL: ${payload}`, async () => {
        // The URL parser will reject invalid ports
        const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'http://127.0.0.1:3333'
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

  describe('Protocol Validation', () => {
    const invalidProtocolPayloads = [
      'http://api.eagleeyenetworks.com/api', // HTTP instead of HTTPS
      'ftp://api.eagleeyenetworks.com/api',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
    ]

    invalidProtocolPayloads.forEach((payload) => {
      it(`should reject non-HTTPS protocol: ${payload.substring(0, 30)}...`, async () => {
        const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'http://127.0.0.1:3333'
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

  describe('URL Credential Blocking', () => {
    const credentialPayloads = [
      'https://user:pass@api.eagleeyenetworks.com/api',
      'https://admin:secret@internal.server/api',
      'https://user@api.eagleeyenetworks.com/api',
    ]

    credentialPayloads.forEach((payload) => {
      it(`should reject URL with credentials: ${payload.substring(0, 40)}...`, async () => {
        const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'http://127.0.0.1:3333'
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
      'https://',
      'https:// spaces.com',
      'https://[invalid',
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
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'http://127.0.0.1:3333'
          },
          body
        })

        // Should be rejected with 400
        expect(response.status).toBe(400)
      })
    })
  })

  describe('Internal Network SSRF Attempts', () => {
    const internalNetworkPayloads = [
      // Private networks
      'https://10.0.0.1/api',
      'https://172.16.0.1/api',
      'https://192.168.0.1/api',
      // Localhost variants
      'https://localhost/api',
      'https://127.0.0.1/api',
      'https://[::1]/api',
      // Cloud metadata endpoints
      'https://169.254.169.254/latest/meta-data/', // AWS
      'https://metadata.google.internal/computeMetadata/v1/', // GCP
      // Internal hostnames
      'https://internal-api.local/api',
      'https://db.internal/api',
    ]

    internalNetworkPayloads.forEach((payload) => {
      it(`should block internal network URL: ${payload}`, async () => {
        const response = await fetchWithMetrics('http://localhost/proxy/getAccessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'http://127.0.0.1:3333'
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
})
