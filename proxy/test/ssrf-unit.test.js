/**
 * Direct Unit Tests for SSRF Protection Functions
 *
 * These tests directly test the isValidEenUrl() and parseHttpsBaseUrl() functions
 * to ensure comprehensive coverage of SSRF attack vectors.
 */

import { describe, it, expect } from 'vitest'
import { isValidEenUrl, parseHttpsBaseUrl } from '../src/index.js'

// Mock environment with default allowed domains
const defaultEnv = {
  ALLOWED_API_DOMAINS: 'eagleeyenetworks.com'
}

// Mock environment with multiple allowed domains
const multiDomainEnv = {
  ALLOWED_API_DOMAINS: 'eagleeyenetworks.com,example.com,test.org'
}

describe('SSRF Unit Tests - isValidEenUrl()', () => {
  describe('Protocol Validation', () => {
    it('should accept HTTPS URLs', () => {
      expect(isValidEenUrl('https://api.eagleeyenetworks.com', defaultEnv)).toBe(true)
    })

    it('should reject HTTP URLs', () => {
      expect(isValidEenUrl('http://api.eagleeyenetworks.com', defaultEnv)).toBe(false)
    })

    it('should reject FTP URLs', () => {
      expect(isValidEenUrl('ftp://api.eagleeyenetworks.com', defaultEnv)).toBe(false)
    })

    it('should reject file URLs', () => {
      expect(isValidEenUrl('file:///etc/passwd', defaultEnv)).toBe(false)
    })

    it('should reject javascript URLs', () => {
      expect(isValidEenUrl('javascript:alert(1)', defaultEnv)).toBe(false)
    })

    it('should reject data URLs', () => {
      expect(isValidEenUrl('data:text/html,<script>alert(1)</script>', defaultEnv)).toBe(false)
    })
  })

  describe('Domain Allowlist Validation', () => {
    it('should accept exact domain match', () => {
      expect(isValidEenUrl('https://eagleeyenetworks.com', defaultEnv)).toBe(true)
    })

    it('should accept subdomain of allowed domain', () => {
      expect(isValidEenUrl('https://api.eagleeyenetworks.com', defaultEnv)).toBe(true)
      expect(isValidEenUrl('https://c001.eagleeyenetworks.com', defaultEnv)).toBe(true)
    })

    it('should accept deeply nested subdomains', () => {
      expect(isValidEenUrl('https://a.b.c.eagleeyenetworks.com', defaultEnv)).toBe(true)
    })

    it('should reject domains not in allowlist', () => {
      expect(isValidEenUrl('https://evil.com', defaultEnv)).toBe(false)
      expect(isValidEenUrl('https://notallowed.org', defaultEnv)).toBe(false)
    })

    it('should reject domains that contain but do not end with allowed domain', () => {
      // This should NOT match because it doesn't end with .eagleeyenetworks.com
      expect(isValidEenUrl('https://evileagleeyenetworks.com', defaultEnv)).toBe(false)
      expect(isValidEenUrl('https://fakeeagleeyenetworks.com.evil.com', defaultEnv)).toBe(false)
    })

    it('should handle multiple allowed domains', () => {
      expect(isValidEenUrl('https://api.eagleeyenetworks.com', multiDomainEnv)).toBe(true)
      expect(isValidEenUrl('https://api.example.com', multiDomainEnv)).toBe(true)
      expect(isValidEenUrl('https://sub.test.org', multiDomainEnv)).toBe(true)
      expect(isValidEenUrl('https://notallowed.net', multiDomainEnv)).toBe(false)
    })
  })

  describe('IPv4 Address Blocking', () => {
    it('should reject standard IPv4 addresses', () => {
      expect(isValidEenUrl('https://192.168.1.1', defaultEnv)).toBe(false)
      expect(isValidEenUrl('https://10.0.0.1', defaultEnv)).toBe(false)
      expect(isValidEenUrl('https://172.16.0.1', defaultEnv)).toBe(false)
    })

    it('should reject localhost IPv4', () => {
      expect(isValidEenUrl('https://127.0.0.1', defaultEnv)).toBe(false)
    })

    it('should reject AWS metadata endpoint', () => {
      expect(isValidEenUrl('https://169.254.169.254', defaultEnv)).toBe(false)
    })
  })

  describe('IPv6 Address Blocking', () => {
    it('should reject bracketed IPv6 addresses', () => {
      expect(isValidEenUrl('https://[::1]', defaultEnv)).toBe(false)
      expect(isValidEenUrl('https://[fe80::1]', defaultEnv)).toBe(false)
      expect(isValidEenUrl('https://[2001:db8::1]', defaultEnv)).toBe(false)
    })

    it('should reject IPv6 with colons in hostname', () => {
      // Note: URL parser may normalize these, but our regex should catch them
      expect(isValidEenUrl('https://::1', defaultEnv)).toBe(false)
    })
  })

  describe('Numeric IP Blocking', () => {
    it('should reject decimal IP representation', () => {
      // 2130706433 = 127.0.0.1 in decimal
      expect(isValidEenUrl('https://2130706433', defaultEnv)).toBe(false)
    })

    it('should reject large decimal IPs', () => {
      expect(isValidEenUrl('https://3232235777', defaultEnv)).toBe(false) // 192.168.1.1
    })
  })

  describe('Octal/Hex IP Blocking', () => {
    it('should reject octal IP notation', () => {
      // 0177.0.0.1 = 127.0.0.1 in octal
      expect(isValidEenUrl('https://0177.0.0.1', defaultEnv)).toBe(false)
    })

    it('should reject hex IP notation', () => {
      // 0x7f.0.0.1 = 127.0.0.1 in hex
      expect(isValidEenUrl('https://0x7f.0.0.1', defaultEnv)).toBe(false)
    })
  })

  describe('Unicode/IDN Homograph Attack Prevention', () => {
    it('should reject Cyrillic lookalikes', () => {
      // 'е' is Cyrillic, not Latin 'e'
      expect(isValidEenUrl('https://еagleeyenetworks.com', defaultEnv)).toBe(false)
    })

    it('should reject domains with non-ASCII characters', () => {
      expect(isValidEenUrl('https://tëst.com', defaultEnv)).toBe(false)
      expect(isValidEenUrl('https://café.com', defaultEnv)).toBe(false)
    })
  })

  describe('URL Credential Blocking', () => {
    it('should reject URLs with username', () => {
      expect(isValidEenUrl('https://user@api.eagleeyenetworks.com', defaultEnv)).toBe(false)
    })

    it('should reject URLs with username and password', () => {
      expect(isValidEenUrl('https://user:pass@api.eagleeyenetworks.com', defaultEnv)).toBe(false)
    })
  })

  describe('Malformed URL Handling', () => {
    it('should reject empty string', () => {
      expect(isValidEenUrl('', defaultEnv)).toBe(false)
    })

    it('should reject null', () => {
      expect(isValidEenUrl(null, defaultEnv)).toBe(false)
    })

    it('should reject undefined', () => {
      expect(isValidEenUrl(undefined, defaultEnv)).toBe(false)
    })

    it('should reject non-URL strings', () => {
      expect(isValidEenUrl('not-a-url', defaultEnv)).toBe(false)
      expect(isValidEenUrl('://missing-protocol', defaultEnv)).toBe(false)
    })
  })

  describe('Configuration Edge Cases', () => {
    it('should use default domain when env is empty', () => {
      expect(isValidEenUrl('https://api.eagleeyenetworks.com', {})).toBe(true)
    })

    it('should use default domain when ALLOWED_API_DOMAINS is empty string', () => {
      expect(isValidEenUrl('https://api.eagleeyenetworks.com', { ALLOWED_API_DOMAINS: '' })).toBe(true)
    })

    it('should filter out wildcard patterns', () => {
      const envWithWildcard = { ALLOWED_API_DOMAINS: '*.evil.com,eagleeyenetworks.com' }
      expect(isValidEenUrl('https://api.eagleeyenetworks.com', envWithWildcard)).toBe(true)
      expect(isValidEenUrl('https://api.evil.com', envWithWildcard)).toBe(false)
    })
  })
})

describe('SSRF Unit Tests - parseHttpsBaseUrl()', () => {
  describe('String Format Input', () => {
    it('should accept valid string URL', () => {
      expect(parseHttpsBaseUrl('https://api.eagleeyenetworks.com', defaultEnv)).toBe('https://api.eagleeyenetworks.com')
    })

    it('should reject invalid string URL', () => {
      expect(parseHttpsBaseUrl('https://evil.com', defaultEnv)).toBe(null)
    })

    it('should reject HTTP string URL', () => {
      expect(parseHttpsBaseUrl('http://api.eagleeyenetworks.com', defaultEnv)).toBe(null)
    })
  })

  describe('Object Format Input', () => {
    it('should accept valid object with hostname', () => {
      const result = parseHttpsBaseUrl({ hostname: 'api.eagleeyenetworks.com' }, defaultEnv)
      expect(result).toBe('https://api.eagleeyenetworks.com')
    })

    it('should accept valid object with host (alternative key)', () => {
      const result = parseHttpsBaseUrl({ host: 'api.eagleeyenetworks.com' }, defaultEnv)
      expect(result).toBe('https://api.eagleeyenetworks.com')
    })

    it('should accept object with hostname and port 443', () => {
      const result = parseHttpsBaseUrl({ hostname: 'api.eagleeyenetworks.com', port: 443 }, defaultEnv)
      expect(result).toBe('https://api.eagleeyenetworks.com')
    })

    it('should include non-443 port in URL', () => {
      const result = parseHttpsBaseUrl({ hostname: 'api.eagleeyenetworks.com', port: 8443 }, defaultEnv)
      expect(result).toBe('https://api.eagleeyenetworks.com:8443')
    })

    it('should handle string port', () => {
      const result = parseHttpsBaseUrl({ hostname: 'api.eagleeyenetworks.com', port: '8443' }, defaultEnv)
      expect(result).toBe('https://api.eagleeyenetworks.com:8443')
    })

    it('should reject object with invalid hostname', () => {
      expect(parseHttpsBaseUrl({ hostname: 'evil.com' }, defaultEnv)).toBe(null)
    })

    it('should reject object with IP address hostname', () => {
      expect(parseHttpsBaseUrl({ hostname: '192.168.1.1' }, defaultEnv)).toBe(null)
    })
  })

  describe('Port Validation', () => {
    it('should reject port 0', () => {
      expect(parseHttpsBaseUrl({ hostname: 'api.eagleeyenetworks.com', port: 0 }, defaultEnv)).toBe(null)
    })

    it('should reject negative port', () => {
      expect(parseHttpsBaseUrl({ hostname: 'api.eagleeyenetworks.com', port: -1 }, defaultEnv)).toBe(null)
    })

    it('should reject port above 65535', () => {
      expect(parseHttpsBaseUrl({ hostname: 'api.eagleeyenetworks.com', port: 65536 }, defaultEnv)).toBe(null)
    })

    it('should reject non-numeric port string', () => {
      expect(parseHttpsBaseUrl({ hostname: 'api.eagleeyenetworks.com', port: 'abc' }, defaultEnv)).toBe(null)
    })

    it('should accept port 1', () => {
      const result = parseHttpsBaseUrl({ hostname: 'api.eagleeyenetworks.com', port: 1 }, defaultEnv)
      expect(result).toBe('https://api.eagleeyenetworks.com:1')
    })

    it('should accept port 65535', () => {
      const result = parseHttpsBaseUrl({ hostname: 'api.eagleeyenetworks.com', port: 65535 }, defaultEnv)
      expect(result).toBe('https://api.eagleeyenetworks.com:65535')
    })
  })

  describe('Hostname Format Validation', () => {
    it('should reject empty hostname', () => {
      expect(parseHttpsBaseUrl({ hostname: '' }, defaultEnv)).toBe(null)
    })

    it('should reject null hostname', () => {
      expect(parseHttpsBaseUrl({ hostname: null }, defaultEnv)).toBe(null)
    })

    it('should reject hostname over 253 characters', () => {
      const longHost = 'a'.repeat(254) + '.eagleeyenetworks.com'
      expect(parseHttpsBaseUrl({ hostname: longHost }, defaultEnv)).toBe(null)
    })

    it('should reject hostname starting with hyphen', () => {
      expect(parseHttpsBaseUrl({ hostname: '-api.eagleeyenetworks.com' }, defaultEnv)).toBe(null)
    })

    it('should allow hostname with hyphen before dot (DNS will reject if invalid)', () => {
      // Note: RFC technically prohibits labels ending with hyphens, but we allow it
      // since the domain allowlist provides the real security, and invalid hostnames
      // would fail at DNS resolution anyway
      const result = parseHttpsBaseUrl({ hostname: 'api-.eagleeyenetworks.com' }, defaultEnv)
      expect(result).toBe('https://api-.eagleeyenetworks.com')
    })

    it('should reject hostname with special characters', () => {
      expect(parseHttpsBaseUrl({ hostname: 'api@evil.eagleeyenetworks.com' }, defaultEnv)).toBe(null)
      expect(parseHttpsBaseUrl({ hostname: 'api;evil.eagleeyenetworks.com' }, defaultEnv)).toBe(null)
    })
  })

  describe('Null/Undefined Input', () => {
    it('should return null for null input', () => {
      expect(parseHttpsBaseUrl(null, defaultEnv)).toBe(null)
    })

    it('should return null for undefined input', () => {
      expect(parseHttpsBaseUrl(undefined, defaultEnv)).toBe(null)
    })

    it('should return null for empty string', () => {
      expect(parseHttpsBaseUrl('', defaultEnv)).toBe(null)
    })

    it('should return null for empty object', () => {
      expect(parseHttpsBaseUrl({}, defaultEnv)).toBe(null)
    })
  })

  describe('SSRF Attack Scenarios', () => {
    it('should reject cloud metadata endpoints', () => {
      expect(parseHttpsBaseUrl('https://169.254.169.254/latest/meta-data/', defaultEnv)).toBe(null)
      expect(parseHttpsBaseUrl({ hostname: '169.254.169.254' }, defaultEnv)).toBe(null)
    })

    it('should reject localhost variations', () => {
      expect(parseHttpsBaseUrl('https://localhost', defaultEnv)).toBe(null)
      expect(parseHttpsBaseUrl('https://127.0.0.1', defaultEnv)).toBe(null)
      expect(parseHttpsBaseUrl({ hostname: 'localhost' }, defaultEnv)).toBe(null)
    })

    it('should reject internal network addresses', () => {
      expect(parseHttpsBaseUrl('https://10.0.0.1', defaultEnv)).toBe(null)
      expect(parseHttpsBaseUrl('https://172.16.0.1', defaultEnv)).toBe(null)
      expect(parseHttpsBaseUrl('https://192.168.0.1', defaultEnv)).toBe(null)
    })

    it('should reject decimal IP bypass attempts', () => {
      expect(parseHttpsBaseUrl('https://2130706433', defaultEnv)).toBe(null) // 127.0.0.1
      expect(parseHttpsBaseUrl({ hostname: '2130706433' }, defaultEnv)).toBe(null)
    })
  })
})
