/**
 * Generates PRESENTATION.md from template by injecting repository URL
 * Usage: npm run build:presentation
 * @requires git - for detecting repository URL
 */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

/**
 * Validates and sanitizes a URL to prevent XSS/injection attacks
 * @param {string} url - The URL to sanitize
 * @returns {string} - Sanitized URL or null if invalid
 */
function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Gets the repository URL from git remote, converting SSH to HTTPS if needed
 * @returns {string} - The sanitized repository URL
 */
function getRepoUrl() {
  const DEFAULT_URL = 'https://github.com/your-username/een-oauth-proxy';

  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf8',
      timeout: 5000,  // 5 second timeout
      stdio: ['ignore', 'pipe', 'ignore']  // Don't expose stderr
    }).trim();

    let httpsUrl;

    // Convert SSH to HTTPS using proper regex
    if (remoteUrl.startsWith('git@')) {
      // Match: git@host:user/repo.git -> https://host/user/repo
      httpsUrl = remoteUrl
        .replace(/^git@([^:]+):/, 'https://$1/')
        .replace(/\.git$/, '');
    } else if (remoteUrl.endsWith('.git')) {
      // Handle HTTPS ending in .git
      httpsUrl = remoteUrl.slice(0, -4);
    } else {
      httpsUrl = remoteUrl;
    }

    // Validate and sanitize the URL
    const sanitized = sanitizeUrl(httpsUrl);
    if (!sanitized) {
      console.warn('Invalid repository URL format, using default.');
      return DEFAULT_URL;
    }

    return sanitized;
  } catch (error) {
    console.warn('Could not detect git remote URL, using default.');
    return DEFAULT_URL;
  }
}

const repoUrl = getRepoUrl();
console.log(`Using repository URL: ${repoUrl}`);

const templatePath = path.join(__dirname, 'PRESENTATION_TEMPLATE.md');
const outputPath = path.join(__dirname, '..', 'PRESENTATION.md');

try {
  // Check if template exists
  if (!fs.existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    process.exit(1);
  }

  let content = fs.readFileSync(templatePath, 'utf8');

  // Validate template contains expected placeholders
  if (!content.includes('{{REPO_URL}}')) {
    console.warn('Warning: No {{REPO_URL}} placeholders found in template');
  }

  content = content.replace(/\{\{REPO_URL\}\}/g, repoUrl);
  fs.writeFileSync(outputPath, content);
  console.log('PRESENTATION.md generated successfully.');
} catch (err) {
  console.error('Error generating presentation:', err);
  process.exit(1);
}
