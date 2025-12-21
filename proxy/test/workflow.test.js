/**
 * Workflow Logic Tests
 *
 * Tests for GitHub Actions workflow logic that is critical to the CI/CD pipeline.
 * These tests validate the size restriction logic used in pr-review.yml and
 * pr-review-gemini.yml for custom review prompts.
 */

import { describe, it, expect } from 'vitest'

/**
 * The maximum size in bytes for custom review prompts.
 * This constant matches the value in .github/workflows/pr-review.yml
 */
const MAX_PROMPT_SIZE = 4096

/**
 * Validates custom review prompt size against the limit.
 *
 * This mirrors the shell script logic in pr-review.yml:
 *   MAX_SIZE=4096
 *   if [ "$FILE_SIZE" -gt "$MAX_SIZE" ]; then
 *     echo "::error::claude-review.md exceeds ${MAX_SIZE} bytes"
 *     exit 1
 *   fi
 *
 * @param {string} content - The file content to validate
 * @param {number} maxSize - Maximum allowed size in bytes
 * @returns {object} Result with valid flag and size info
 */
function validatePromptSize(content, maxSize = MAX_PROMPT_SIZE) {
  const encoder = new TextEncoder()
  const contentBytes = encoder.encode(content)
  const size = contentBytes.length

  return {
    valid: size <= maxSize,
    size,
    maxSize,
    exceededBy: size > maxSize ? size - maxSize : 0
  }
}

/**
 * Helper to create content of exact byte size
 */
function createContentOfSize(sizeInBytes, char = 'x') {
  return char.repeat(sizeInBytes)
}

/**
 * Gets the byte size of a string in UTF-8 encoding
 */
function getByteSize(content) {
  return new TextEncoder().encode(content).length
}

describe('Workflow - Custom Review Prompt Size Validation', () => {
  describe('Size Limit Constants', () => {
    it('should use 4KB (4096 bytes) as the maximum size limit', () => {
      expect(MAX_PROMPT_SIZE).toBe(4096)
      expect(MAX_PROMPT_SIZE).toBe(4 * 1024)
    })
  })

  describe('Content Under Limit', () => {
    it('should accept empty content', () => {
      const result = validatePromptSize('')

      expect(result.valid).toBe(true)
      expect(result.size).toBe(0)
      expect(result.exceededBy).toBe(0)
    })

    it('should accept small content', () => {
      const content = '# Review Prompts\n* Point one\n* Point two'
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
      expect(result.size).toBe(getByteSize(content))
    })

    it('should accept content at 1KB', () => {
      const content = createContentOfSize(1024)
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
      expect(result.size).toBe(1024)
    })

    it('should accept content at 2KB', () => {
      const content = createContentOfSize(2048)
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
      expect(result.size).toBe(2048)
    })
  })

  describe('Boundary Conditions', () => {
    it('should accept at 4095 bytes (1 byte under limit)', () => {
      const content = createContentOfSize(4095)
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
      expect(result.size).toBe(4095)
      expect(result.exceededBy).toBe(0)
    })

    it('should accept at exactly 4096 bytes (at limit)', () => {
      const content = createContentOfSize(4096)
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
      expect(result.size).toBe(4096)
      expect(result.exceededBy).toBe(0)
    })

    it('should reject at 4097 bytes (1 byte over limit)', () => {
      const content = createContentOfSize(4097)
      const result = validatePromptSize(content)

      expect(result.valid).toBe(false)
      expect(result.size).toBe(4097)
      expect(result.exceededBy).toBe(1)
    })

    it('should reject at 4100 bytes (4 bytes over limit)', () => {
      const content = createContentOfSize(4100)
      const result = validatePromptSize(content)

      expect(result.valid).toBe(false)
      expect(result.size).toBe(4100)
      expect(result.exceededBy).toBe(4)
    })
  })

  describe('Large Content Rejection', () => {
    it('should reject 8KB content', () => {
      const content = createContentOfSize(8192)
      const result = validatePromptSize(content)

      expect(result.valid).toBe(false)
      expect(result.size).toBe(8192)
      expect(result.exceededBy).toBe(8192 - 4096)
    })

    it('should reject 10KB content', () => {
      const content = createContentOfSize(10240)
      const result = validatePromptSize(content)

      expect(result.valid).toBe(false)
      expect(result.size).toBe(10240)
      expect(result.exceededBy).toBe(10240 - 4096)
    })

    it('should reject 1MB content', () => {
      const content = createContentOfSize(1024 * 1024)
      const result = validatePromptSize(content)

      expect(result.valid).toBe(false)
      expect(result.size).toBe(1024 * 1024)
    })
  })

  describe('Content Preservation (valid content)', () => {
    it('should preserve markdown formatting under limit', () => {
      const content = `# Additional prompts for Claude Code Review
* Point one with **bold** text
* Point two with \`code\` formatting
* Point three with [link](https://example.com)

## Section Header
Some more content here.
`
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
    })

    it('should preserve special characters', () => {
      const content = '* Check SQL: SELECT * FROM users WHERE id = \'1\' OR \'1\'=\'1\'\n'
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
    })

    it('should handle newlines correctly', () => {
      const content = 'Line 1\nLine 2\r\nLine 3\rLine 4'
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
    })

    it('should handle whitespace-only content', () => {
      const content = '   \n\n\t\t   \n'
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
    })
  })

  describe('UTF-8 Multi-byte Characters', () => {
    it('should count ASCII characters as 1 byte each', () => {
      const content = 'Hello World!'
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
      expect(result.size).toBe(12) // 12 ASCII chars = 12 bytes
    })

    it('should count emoji characters as 4 bytes each in UTF-8', () => {
      // Each emoji is 4 bytes in UTF-8
      const content = '🔍🔍🔍🔍🔍' // 5 emojis = 20 bytes
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
      expect(result.size).toBe(20)
    })

    it('should correctly count bytes for mixed content', () => {
      // 'a' = 1 byte, '🔍' = 4 bytes
      const content = 'a🔍a🔍a' // 1 + 4 + 1 + 4 + 1 = 11 bytes
      const result = validatePromptSize(content)

      expect(result.size).toBe(11)
    })

    it('should reject when emoji content exceeds limit', () => {
      // Fill most of the limit with ASCII, then add emojis to exceed
      const asciiPart = 'x'.repeat(4090) // 4090 bytes
      const emojiPart = '🔍🔍🔍' // 12 bytes, total = 4102 bytes
      const content = asciiPart + emojiPart

      const result = validatePromptSize(content)

      expect(result.valid).toBe(false)
      expect(result.size).toBe(4102)
      expect(result.exceededBy).toBe(6)
    })

    it('should count Chinese characters as 3 bytes each in UTF-8', () => {
      // Each Chinese character is typically 3 bytes in UTF-8
      const content = '中文测试' // 4 chars = 12 bytes
      const result = validatePromptSize(content)

      expect(result.valid).toBe(true)
      expect(result.size).toBe(12)
    })
  })

  describe('Custom Size Limits', () => {
    it('should respect custom maxSize parameter', () => {
      const content = createContentOfSize(100)
      const result = validatePromptSize(content, 50)

      expect(result.valid).toBe(false)
      expect(result.exceededBy).toBe(50)
    })

    it('should work with very small limits', () => {
      const content = 'Hello World!'
      const result = validatePromptSize(content, 5)

      expect(result.valid).toBe(false)
      expect(result.size).toBe(12)
      expect(result.exceededBy).toBe(7)
    })

    it('should work with limit of 1 byte', () => {
      const content = 'abc'
      const result = validatePromptSize(content, 1)

      expect(result.valid).toBe(false)
      expect(result.exceededBy).toBe(2)
    })

    it('should accept content exactly at custom limit', () => {
      const content = 'Hello'
      const result = validatePromptSize(content, 5)

      expect(result.valid).toBe(true)
      expect(result.exceededBy).toBe(0)
    })
  })

  describe('Error Message Generation', () => {
    it('should provide useful info for error messages', () => {
      const content = createContentOfSize(5000)
      const result = validatePromptSize(content)

      // These values would be used in error messages like:
      // "claude-review.md exceeds 4096 bytes (5000 bytes)"
      expect(result.valid).toBe(false)
      expect(result.size).toBe(5000)
      expect(result.maxSize).toBe(4096)
      expect(result.exceededBy).toBe(904)
    })
  })
})

describe('Workflow - Byte Size Calculation', () => {
  describe('getByteSize helper', () => {
    it('should return 0 for empty string', () => {
      expect(getByteSize('')).toBe(0)
    })

    it('should count ASCII bytes correctly', () => {
      expect(getByteSize('abc')).toBe(3)
      expect(getByteSize('Hello World')).toBe(11)
    })

    it('should count multi-byte UTF-8 correctly', () => {
      expect(getByteSize('🔍')).toBe(4)
      expect(getByteSize('中')).toBe(3)
      expect(getByteSize('é')).toBe(2)
    })

    it('should handle mixed content', () => {
      // a(1) + 🔍(4) + 中(3) + !(1) = 9 bytes
      expect(getByteSize('a🔍中!')).toBe(9)
    })
  })
})
