#!/usr/bin/env node
/**
 * Sets the DEPLOY_VERSION in local KV storage for development
 * This ensures /health returns the correct version during local dev
 */

import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
const version = packageJson.version

console.log(`Setting local DEPLOY_VERSION to v${version}`)

try {
  execSync(
    `npx wrangler kv key put DEPLOY_VERSION "v${version}" --binding=EEN_OAUTH_SESSIONS --local`,
    {
      cwd: projectRoot,
      stdio: 'inherit'
    }
  )
} catch (error) {
  // Non-fatal - dev server will still work, just with 'unknown' version
  console.warn('Warning: Could not set local version (this is non-fatal)')
}
