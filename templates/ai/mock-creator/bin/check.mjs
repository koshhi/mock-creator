#!/usr/bin/env node
// Dependency-free mock-create validator. Run from a prototype's own
// directory (npm sets cwd to wherever package.json lives), scans that
// directory only. See /ai/mock-creator/CONTRACT.md for the rules this enforces.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const failures = []

function fail(rule, message) {
  failures.push({ rule, message })
}

function walk(dir, skip = []) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.vite'].includes(entry.name)) continue
    const full = join(dir, entry.name)
    if (skip.includes(full)) continue
    if (entry.isDirectory()) out.push(...walk(full, skip))
    else out.push(full)
  }
  return out
}

const srcDir = join(root, 'src')
const dataDir = join(srcDir, 'data')
const fixturesDir = join(srcDir, 'mocks', 'fixtures')
const schemasDir = join(srcDir, 'mocks', 'schemas')
const statesFile = join(srcDir, 'mocks', 'states.json')

// 1. Required structure
for (const [label, dir] of [
  ['src/data/', dataDir],
  ['src/mocks/fixtures/', fixturesDir],
  ['src/mocks/schemas/', schemasDir],
]) {
  if (!existsSync(dir)) fail('STRUCTURE', `Missing required directory: ${label}`)
}
if (!existsSync(statesFile)) {
  fail('STRUCTURE', 'Missing src/mocks/states.json — declare fixture-state coverage per resource')
}

const sourceFiles = walk(srcDir).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
const nonDataFiles = sourceFiles.filter((f) => !f.startsWith(dataDir + '/') && f !== dataDir)

// 2. UI code never imports a fixture directly
for (const file of nonDataFiles) {
  const content = readFileSync(file, 'utf8')
  for (const m of content.matchAll(/from\s+['"]([^'"]*mocks\/fixtures[^'"]*)['"]/g)) {
    fail('FIXTURE_IMPORT', `${relative(root, file)}: imports a fixture directly (${m[1]}) — go through src/data/ instead`)
  }
}

// 3. No backend/database/ORM dependency
const BANNED_DEPS = [
  'express', 'fastify', 'koa', 'hapi', '@nestjs/core',
  'prisma', '@prisma/client', 'sequelize', 'mongoose', 'typeorm', 'knex', 'drizzle-orm',
  'pg', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3', 'mongodb', 'redis', 'ioredis',
]
const pkgPath = join(root, 'package.json')
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const banned of BANNED_DEPS) {
    if (deps[banned]) fail('BACKEND_DEPENDENCY', `package.json declares "${banned}" — not allowed in mock-create mode`)
  }
} else {
  fail('STRUCTURE', 'Missing package.json — every prototype needs its own')
}

// 4. No real network calls outside the src/data/ seam
const NETWORK_PATTERNS = [/\bfetch\s*\(/, /\baxios\b/, /new\s+WebSocket\s*\(/, /\bgraphql\b/i]
for (const file of nonDataFiles) {
  const content = readFileSync(file, 'utf8')
  for (const pattern of NETWORK_PATTERNS) {
    if (pattern.test(content)) {
      fail('REAL_NETWORK', `${relative(root, file)}: matches ${pattern} outside src/data/`)
      break
    }
  }
}

// 5. No secret/env files
for (const entry of existsSync(root) ? readdirSync(root) : []) {
  if (/^\.env(\..+)?$/.test(entry) && entry !== '.env.example') {
    fail('SECRET_FILE', `${entry} present at prototype root — no real credentials in mock-create mode`)
  }
}

// 6. No server-side code directories
for (const name of ['api', 'server']) {
  if (existsSync(join(srcDir, name))) {
    fail('SERVER_CODE', `src/${name}/ present — server-side code is not allowed in mock-create mode`)
  }
}

// 7. states.json covers every resource's required states
if (existsSync(statesFile) && existsSync(fixturesDir)) {
  let states
  try {
    states = JSON.parse(readFileSync(statesFile, 'utf8'))
  } catch (err) {
    fail('STATES_INVALID', `src/mocks/states.json is not valid JSON: ${err.message}`)
    states = {}
  }
  const resources = readdirSync(fixturesDir)
    .filter((f) => /\.(ts|js)$/.test(f))
    .map((f) => f.replace(/\.(ts|js)$/, ''))
  const REQUIRED_STATES = ['happy', 'empty', 'error', 'loading']
  for (const resource of resources) {
    const entry = states[resource]
    if (!entry) {
      fail('STATES_MISSING', `states.json has no entry for resource "${resource}"`)
      continue
    }
    for (const state of REQUIRED_STATES) {
      const value = entry[state]
      const declared =
        value === true ||
        (value && typeof value === 'object' && value.applicable === false && typeof value.reason === 'string')
      if (!declared) {
        fail('STATES_MISSING', `states.json: resource "${resource}" is missing state "${state}" (must be true, or {applicable:false, reason})`)
      }
    }
  }
}

if (failures.length === 0) {
  console.log('mocks:check passed — no violations found.')
  process.exit(0)
}

console.error(`mocks:check found ${failures.length} violation(s):\n`)
for (const f of failures) console.error(`  [${f.rule}] ${f.message}`)
process.exit(1)
