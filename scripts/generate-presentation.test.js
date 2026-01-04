/**
 * Tests for generate-presentation.js
 * Run with: node scripts/generate-presentation.test.js
 */
const { sanitizeUrl, convertSshToHttps } = require('./generate-presentation');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\n    Expected: ${expected}\n    Actual: ${actual}`);
  }
}

console.log('\n=== sanitizeUrl tests ===\n');

test('should accept valid HTTPS URL', () => {
  assertEqual(sanitizeUrl('https://github.com/user/repo'), 'https://github.com/user/repo');
});

test('should accept valid HTTP URL', () => {
  assertEqual(sanitizeUrl('http://example.com/path'), 'http://example.com/path');
});

test('should reject javascript: protocol (XSS prevention)', () => {
  assertEqual(sanitizeUrl('javascript:alert(1)'), null);
});

test('should reject file: protocol', () => {
  assertEqual(sanitizeUrl('file:///etc/passwd'), null);
});

test('should reject ftp: protocol', () => {
  assertEqual(sanitizeUrl('ftp://example.com'), null);
});

test('should reject data: protocol', () => {
  assertEqual(sanitizeUrl('data:text/html,<script>alert(1)</script>'), null);
});

test('should reject invalid URLs', () => {
  assertEqual(sanitizeUrl('not-a-url'), null);
});

test('should reject empty string', () => {
  assertEqual(sanitizeUrl(''), null);
});

test('should handle URL with trailing slash', () => {
  const result = sanitizeUrl('https://github.com/user/repo/');
  assertEqual(result, 'https://github.com/user/repo/');
});

console.log('\n=== convertSshToHttps tests ===\n');

test('should convert SSH URL to HTTPS', () => {
  assertEqual(
    convertSshToHttps('git@github.com:user/repo.git'),
    'https://github.com/user/repo'
  );
});

test('should convert SSH URL without .git extension', () => {
  assertEqual(
    convertSshToHttps('git@github.com:user/repo'),
    'https://github.com/user/repo'
  );
});

test('should handle GitLab SSH URL', () => {
  assertEqual(
    convertSshToHttps('git@gitlab.com:org/project.git'),
    'https://gitlab.com/org/project'
  );
});

test('should handle custom git host SSH URL', () => {
  assertEqual(
    convertSshToHttps('git@git.company.com:team/app.git'),
    'https://git.company.com/team/app'
  );
});

test('should remove .git from HTTPS URL', () => {
  assertEqual(
    convertSshToHttps('https://github.com/user/repo.git'),
    'https://github.com/user/repo'
  );
});

test('should pass through clean HTTPS URL unchanged', () => {
  assertEqual(
    convertSshToHttps('https://github.com/user/repo'),
    'https://github.com/user/repo'
  );
});

test('should handle nested paths', () => {
  assertEqual(
    convertSshToHttps('git@github.com:org/team/repo.git'),
    'https://github.com/org/team/repo'
  );
});

console.log('\n=== Results ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
