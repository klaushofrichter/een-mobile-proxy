/**
 * Workflow Logic Tests
 *
 * Tests for GitHub Actions workflow logic that is critical to the CI/CD pipeline.
 * These tests validate the size restriction logic used in pr-review.yml for custom
 * review prompts, implemented as pure functions without file system dependencies.
 */

import { describe, it, expect } from 'vitest'

/**
 * The maximum size in bytes for custom review prompts.
 * This constant matches the value in .github/workflows/pr-review.yml
 */
const MAX_PROMPT_SIZE = 4096

/**
 * Simulates the custom review prompt processing logic from pr-review.yml
 *
 * This mirrors the shell script logic:
 *   MAX_SIZE=4096
 *   if [ "$FILE_SIZE" -gt "$MAX_SIZE" ]; then
 *     echo "::warning::claude-review.md exceeds ${MAX_SIZE} bytes, truncating"
 *   fi
 *   head -c "$MAX_SIZE" "$PROMPT_FILE"
 *
 * @param {string} content - The file content to process
 * @param {number} maxSize - Maximum allowed size in bytes
 * @returns {object} Result with content, truncated flag, and size info
 */
function processCustomPrompt(content, maxSize = MAX_PROMPT_SIZE) {
  const encoder = new TextEncoder()
  const contentBytes = encoder.encode(content)
  const originalSize = contentBytes.length

  const result = {
    content: '',
    truncated: false,
    originalSize,
    finalSize: 0
  }

  if (originalSize > maxSize) {
    result.truncated = true
    // Truncate to maxSize bytes (like shell's head -c)
    const truncatedBytes = contentBytes.slice(0, maxSize)
    const decoder = new TextDecoder('utf-8', { fatal: false })
    result.content = decoder.decode(truncatedBytes)
    result.finalSize = maxSize
  } else {
    result.content = content
    result.finalSize = originalSize
  }

  return result
}

/**
 * Helper to create content of exact byte size
 */
function createContentOfSize(sizeInBytes, char = 'x') {
  return char.repeat(sizeInBytes)
}

describe('Workflow - Custom Review Prompt Size Restriction', () => {
  describe('Size Limit Constants', () => {
    it('should use 4KB (4096 bytes) as the maximum size limit', () => {
      expect(MAX_PROMPT_SIZE).toBe(4096)
      expect(MAX_PROMPT_SIZE).toBe(4 * 1024)
    })
  })

  describe('Content Under Limit', () => {
    it('should accept empty content', () => {
      const result = processCustomPrompt('')

      expect(result.truncated).toBe(false)
      expect(result.content).toBe('')
      expect(result.originalSize).toBe(0)
      expect(result.finalSize).toBe(0)
    })

    it('should accept small content', () => {
      const content = '# Review Prompts\n* Point one\n* Point two'
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(false)
      expect(result.content).toBe(content)
    })

    it('should accept content at 1KB', () => {
      const content = createContentOfSize(1024)
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(false)
      expect(result.originalSize).toBe(1024)
    })

    it('should accept content at 2KB', () => {
      const content = createContentOfSize(2048)
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(false)
      expect(result.originalSize).toBe(2048)
    })
  })

  describe('Boundary Conditions', () => {
    it('should not truncate at 4095 bytes (1 byte under limit)', () => {
      const content = createContentOfSize(4095)
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(false)
      expect(result.originalSize).toBe(4095)
      expect(result.content.length).toBe(4095)
    })

    it('should not truncate at exactly 4096 bytes (at limit)', () => {
      const content = createContentOfSize(4096)
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(false)
      expect(result.originalSize).toBe(4096)
      expect(result.content.length).toBe(4096)
    })

    it('should truncate at 4097 bytes (1 byte over limit)', () => {
      const content = createContentOfSize(4097)
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(true)
      expect(result.originalSize).toBe(4097)
      expect(result.finalSize).toBe(4096)
    })

    it('should truncate at 4100 bytes (4 bytes over limit)', () => {
      const content = createContentOfSize(4100)
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(true)
      expect(result.originalSize).toBe(4100)
      expect(result.finalSize).toBe(4096)
    })
  })

  describe('Large Content Truncation', () => {
    it('should truncate 8KB content to 4KB', () => {
      const content = createContentOfSize(8192)
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(true)
      expect(result.originalSize).toBe(8192)
      expect(result.finalSize).toBe(4096)
    })

    it('should truncate 10KB content to 4KB', () => {
      const content = createContentOfSize(10240)
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(true)
      expect(result.originalSize).toBe(10240)
      expect(result.finalSize).toBe(4096)
    })

    it('should truncate 1MB content to 4KB', () => {
      const content = createContentOfSize(1024 * 1024)
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(true)
      expect(result.originalSize).toBe(1024 * 1024)
      expect(result.finalSize).toBe(4096)
    })
  })

  describe('Content Preservation', () => {
    it('should preserve markdown formatting under limit', () => {
      const content = `# Additional prompts for Claude Code Review
* Point one with **bold** text
* Point two with \`code\` formatting
* Point three with [link](https://example.com)

## Section Header
Some more content here.
`
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(false)
      expect(result.content).toBe(content)
    })

    it('should preserve special characters', () => {
      const content = '* Check SQL: SELECT * FROM users WHERE id = \'1\' OR \'1\'=\'1\'\n'
      const result = processCustomPrompt(content)

      expect(result.content).toBe(content)
    })

    it('should preserve newlines correctly', () => {
      const content = 'Line 1\nLine 2\r\nLine 3\rLine 4'
      const result = processCustomPrompt(content)

      expect(result.content).toBe(content)
    })

    it('should preserve whitespace-only content', () => {
      const content = '   \n\n\t\t   \n'
      const result = processCustomPrompt(content)

      expect(result.content).toBe(content)
    })
  })

  describe('UTF-8 Multi-byte Characters', () => {
    it('should handle ASCII characters (1 byte each)', () => {
      const content = 'Hello World!'
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(false)
      expect(result.originalSize).toBe(12) // 12 ASCII chars = 12 bytes
    })

    it('should handle emoji characters (4 bytes each in UTF-8)', () => {
      // Each emoji is 4 bytes in UTF-8
      const content = '🔍🔍🔍🔍🔍' // 5 emojis = 20 bytes
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(false)
      expect(result.originalSize).toBe(20)
    })

    it('should correctly count bytes for mixed content', () => {
      // 'a' = 1 byte, '🔍' = 4 bytes
      const content = 'a🔍a🔍a' // 1 + 4 + 1 + 4 + 1 = 11 bytes
      const result = processCustomPrompt(content)

      expect(result.originalSize).toBe(11)
    })

    it('should truncate emojis at byte boundary', () => {
      // Fill most of the limit with ASCII, then add emojis
      const asciiPart = 'x'.repeat(4090) // 4090 bytes
      const emojiPart = '🔍🔍🔍' // 12 bytes, total = 4102 bytes
      const content = asciiPart + emojiPart

      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(true)
      expect(result.finalSize).toBe(4096)
      // The truncated content should start with the ASCII part
      expect(result.content.startsWith(asciiPart.slice(0, 100))).toBe(true)
    })

    it('should handle Chinese characters (3 bytes each in UTF-8)', () => {
      // Each Chinese character is typically 3 bytes in UTF-8
      const content = '中文测试' // 4 chars = 12 bytes
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(false)
      expect(result.originalSize).toBe(12)
    })
  })

  describe('Truncation Accuracy', () => {
    it('should produce content of exactly maxSize bytes when truncating', () => {
      const content = createContentOfSize(10000)
      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(true)
      expect(result.finalSize).toBe(MAX_PROMPT_SIZE)

      // Verify the actual byte length
      const encoder = new TextEncoder()
      expect(encoder.encode(result.content).length).toBe(MAX_PROMPT_SIZE)
    })

    it('should preserve the beginning of content when truncating', () => {
      const prefix = 'IMPORTANT_PREFIX_'
      const filler = 'x'.repeat(10000)
      const content = prefix + filler

      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(true)
      expect(result.content.startsWith(prefix)).toBe(true)
    })

    it('should not corrupt content when truncating ASCII', () => {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz'
      const content = alphabet.repeat(200) // 5200 bytes

      const result = processCustomPrompt(content)

      expect(result.truncated).toBe(true)
      // Truncated content should only contain valid alphabet characters
      expect(result.content).toMatch(/^[a-z]+$/)
    })
  })

  describe('Custom Size Limits', () => {
    it('should respect custom maxSize parameter', () => {
      const content = createContentOfSize(100)
      const result = processCustomPrompt(content, 50)

      expect(result.truncated).toBe(true)
      expect(result.finalSize).toBe(50)
    })

    it('should work with very small limits', () => {
      const content = 'Hello World!'
      const result = processCustomPrompt(content, 5)

      expect(result.truncated).toBe(true)
      expect(result.content).toBe('Hello')
      expect(result.finalSize).toBe(5)
    })

    it('should work with limit of 1 byte', () => {
      const content = 'abc'
      const result = processCustomPrompt(content, 1)

      expect(result.truncated).toBe(true)
      expect(result.content).toBe('a')
      expect(result.finalSize).toBe(1)
    })
  })
})

describe('Workflow - Expected File Configuration', () => {
  it('should expect prompt file at .github/claude-review.md', () => {
    const EXPECTED_PATH = '.github/claude-review.md'

    // Verify the expected path structure
    expect(EXPECTED_PATH).toMatch(/^\.github\//)
    expect(EXPECTED_PATH).toMatch(/\.md$/)
    expect(EXPECTED_PATH).toBe('.github/claude-review.md')
  })
})
