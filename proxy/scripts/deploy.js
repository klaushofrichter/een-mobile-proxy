#!/usr/bin/env node

/**
 * Deployment script for EEN OAuth Proxy
 *
 * This script:
 * 1. Reads version from package.json
 * 2. Deploys the worker to Cloudflare
 * 3. Sets secrets from .env file
 * 4. Stores DEPLOY_VERSION in KV
 */

import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

// Load .env file
const envPath = join(projectRoot, '.env')
if (existsSync(envPath)) {
  config({ path: envPath })
}

// Read package.json
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
const version = packageJson.version
const name = packageJson.name

// Generate version string with timestamp
const deployTime = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
const versionString = `${name} - ${version} - ${deployTime}`

console.log('========================================')
console.log('EEN OAuth Proxy Deployment')
console.log('========================================')
console.log(`Version: ${versionString}`)
console.log('')

function run(command, options = {}) {
  console.log(`> ${command}`)
  try {
    execSync(command, {
      cwd: projectRoot,
      stdio: 'inherit',
      ...options
    })
  } catch (error) {
    console.error(`Command failed: ${command}`)
    process.exit(1)
  }
}

function runSilent(command) {
  try {
    return execSync(command, {
      cwd: projectRoot,
      encoding: 'utf-8'
    }).trim()
  } catch (error) {
    return null
  }
}

// Check if KV namespace exists, create if not
console.log('Checking KV namespace...')
const wranglerToml = readFileSync(join(projectRoot, 'wrangler.toml'), 'utf-8')

if (!wranglerToml.includes('id = "') || wranglerToml.includes('# id = "')) {
  console.log('KV namespace not configured. Creating...')

  const output = runSilent('npx wrangler kv namespace create EEN_OAUTH_SESSIONS')
  if (output) {
    // Extract namespace ID from output
    const match = output.match(/id = "([^"]+)"/)
    if (match) {
      const namespaceId = match[1]
      console.log(`Created KV namespace with ID: ${namespaceId}`)
      console.log('')
      console.log('Please update wrangler.toml with:')
      console.log('[[kv_namespaces]]')
      console.log('binding = "EEN_OAUTH_SESSIONS"')
      console.log(`id = "${namespaceId}"`)
      console.log('')
      process.exit(1)
    }
  }
}

// Deploy worker
console.log('')
console.log('Deploying worker...')
run('npx wrangler deploy')

// Set secrets
console.log('')
console.log('Setting secrets...')

const secrets = ['CLIENT_ID', 'CLIENT_SECRET', 'ADMIN_EMAILS', 'ALLOWED_ORIGINS', 'ALLOWED_API_DOMAINS', 'REFRESH_TOKEN_TTL']

for (const secret of secrets) {
  const value = process.env[secret]
  if (value) {
    // Validate secret name contains only safe characters (defense in depth)
    if (!/^[A-Z_]+$/.test(secret)) {
      console.warn(`Warning: Invalid secret name format: ${secret}`)
      continue
    }
    console.log(`Setting ${secret}...`)
    try {
      // Pass secret value via stdin to prevent shell injection
      // Using input option instead of shell interpolation for security
      execSync(`npx wrangler secret put ${secret}`, {
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        input: value
      })
    } catch (error) {
      console.warn(`Warning: Failed to set ${secret}`)
    }
  } else {
    console.warn(`Warning: ${secret} not found in environment`)
  }
}

// Store version in KV
console.log('')
console.log('Storing deploy version in KV...')

// Extract namespace ID from wrangler.toml
const namespaceMatch = wranglerToml.match(/id = "([^"]+)"/)
if (namespaceMatch) {
  const namespaceId = namespaceMatch[1]
  try {
    execSync(
      `npx wrangler kv key put DEPLOY_VERSION "${versionString}" --namespace-id="${namespaceId}" --remote`,
      {
        cwd: projectRoot,
        stdio: 'inherit'
      }
    )
  } catch (error) {
    console.warn('Warning: Failed to store deploy version')
  }
}

console.log('')
console.log('========================================')
console.log('Deployment complete!')
console.log('========================================')

// Verify deployment with production tests
console.log('')
console.log('Waiting 5 seconds for deployment to propagate...')

await new Promise(resolve => setTimeout(resolve, 5000))

console.log('')
console.log('Running production verification tests...')
console.log('')

const testScript = join(__dirname, '..', '..', 'scripts', 'test-production-proxy.sh')
const testResult = (() => {
  try {
    execSync(`BRIEF=1 bash "${testScript}"`, {
      cwd: projectRoot,
      stdio: 'inherit'
    })
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
})()

console.log('')
if (testResult.success) {
  console.log('========================================')
  console.log('Deployment verified successfully!')
  console.log('========================================')
} else {
  console.log('========================================')
  console.log('WARNING: Production verification failed!')
  console.log('The deployment completed but tests failed.')
  if (testResult.error) {
    console.log(`Exit code: ${testResult.error.status || 'unknown'}`)
    if (testResult.error.stderr && testResult.error.stderr.length > 0) {
      console.log(`Error output: ${testResult.error.stderr.toString()}`)
    }
  }
  console.log('Please investigate the proxy status.')
  console.log('========================================')
  process.exit(1)
}
