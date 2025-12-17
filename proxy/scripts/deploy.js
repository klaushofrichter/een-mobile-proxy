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

  const output = runSilent('npx wrangler kv:namespace create "EEN_OAUTH_SESSIONS"')
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

const secrets = ['CLIENT_ID', 'CLIENT_SECRET', 'ADMIN_EMAILS', 'ALLOWED_ORIGINS']

for (const secret of secrets) {
  const value = process.env[secret]
  if (value) {
    console.log(`Setting ${secret}...`)
    try {
      execSync(`echo "${value}" | npx wrangler secret put ${secret}`, {
        cwd: projectRoot,
        stdio: 'pipe'
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
      `npx wrangler kv:key put --namespace-id="${namespaceId}" "DEPLOY_VERSION" "${versionString}"`,
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
