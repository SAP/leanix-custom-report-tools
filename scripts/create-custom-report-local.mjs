#!/usr/bin/env node
// Script to run the creation tool and vite plugin locally.
// Builds both packages, runs create-custom-report, and links the local vite plugin.

import { execSync, spawn } from 'child_process'
import { join, basename } from 'path'

const TOOL_DIR = process.cwd()

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts })
}

console.log('Building packages...')
run('npm run build')

run('npm link --force', { cwd: join(TOOL_DIR, 'packages/vite-plugin') })
run('npm link', { cwd: join(TOOL_DIR, 'packages/create-custom-report') })

console.log('Running creation tool...')

const extraArgs = process.argv.slice(2)

console.log('-----------------------------------------------------------------')

let output = ''
let exitCode = 0
await new Promise((resolve) => {
  const child = spawn(
    'npm',
    ['exec', '--yes', '--', 'create-leanix-custom-report', ...extraArgs],
    { cwd: join(TOOL_DIR, '..'), shell: true, stdio: ['inherit', 'pipe', 'inherit'] }
  )
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    output += chunk.toString()
  })
  child.on('close', (code) => {
    exitCode = code ?? 0
    resolve()
  })
})

console.log('-----------------------------------------------------------------')

const projectDirMatch = output.match(/^Creating project in (.+)$/m)
const PROJECT_DIR = projectDirMatch?.[1]?.trim()

if (exitCode !== 0 || !PROJECT_DIR) {
  console.error('Error: project creation failed.')
  process.exit(1)
}

const PROJECT_NAME = basename(PROJECT_DIR)

console.log('Linking local vite plugin to project...')
run('npm link @sap/vite-plugin-leanix-custom-report', {
  cwd: join(TOOL_DIR, '..', PROJECT_NAME),
})

console.log('')
console.log('✅ Setup complete!')
console.log(`   Using the vite plugin from: ${TOOL_DIR}/packages/vite-plugin`)
console.log('   npm install would revert to using the published version of the plugin.')
console.log(`   Project location: ${join(TOOL_DIR, '..', PROJECT_NAME)}`)
console.log('')
