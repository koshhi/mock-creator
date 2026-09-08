#!/usr/bin/env node
// mock-creator — installer for the mock-create method.
//
// init: copies templates/ into the current directory. Fresh install
// (nothing exists yet) writes everything immediately. Any conflict (a
// target file already exists) defaults to a dry run — prints the plan and
// writes nothing — until re-run with --write. Even then, --write only
// creates missing files; it never touches a file that already exists,
// identical or diverged. --adapters narrows which files are considered.
//
// check-install: reads the digests init recorded in
// ai/mock-creator/VERSION.json and reports, per file, whether it's
// unchanged, locally drifted since install, outdated against the
// package's current templates, or missing.
//
// No merge yet — deferred to a later version.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const templatesRoot = join(__dirname, '..', 'templates')
const targetRoot = process.cwd()
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
const PACKAGE_VERSION = packageJson.version

const VERSION_FILE = 'ai/mock-creator/VERSION.json'

// Files every install needs regardless of which tool adapters are picked.
const CORE_FILES = [
  'ai/mock-creator/CONTRACT.md',
  VERSION_FILE,
  'ai/mock-creator/TASK_TEMPLATE.md',
  'ai/mock-creator/bin/check.mjs',
]

// Per-tool files. AGENTS.md is shared by codex and pi (both discover it),
// not duplicated — requesting either pulls it in once.
const ADAPTER_FILES = {
  claude: ['CLAUDE.md', '.claude/agents/mock-designer.md', '.claude/agents/mock-verifier.md'],
  pi: ['AGENTS.md', '.pi/agents/mock-designer.md', '.pi/agents/mock-verifier.md'],
  codex: ['AGENTS.md'],
}

function sha256(content) {
  return 'sha256:' + createHash('sha256').update(content).digest('hex')
}

function listTemplateFiles(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listTemplateFiles(full, base))
    else out.push(relative(base, full))
  }
  return out
}

// VERSION.json isn't a static template file — its content (the digest
// manifest) depends on which files this run actually installs, so it's
// generated on the fly instead of copied.
function generateVersionJson(fileList) {
  const files = {}
  for (const rel of fileList) {
    if (rel === VERSION_FILE) continue
    files[rel] = sha256(readFileSync(join(templatesRoot, rel), 'utf8'))
  }
  return JSON.stringify({ packageVersion: PACKAGE_VERSION, files }, null, 2) + '\n'
}

function getSrcContent(rel, fileList) {
  if (rel === VERSION_FILE) return generateVersionJson(fileList)
  return readFileSync(join(templatesRoot, rel), 'utf8')
}

function resolveAdapters(adaptersFlagValue) {
  if (!adaptersFlagValue) return null // null = no filter, everything
  const requested = adaptersFlagValue.split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = requested.filter((name) => !(name in ADAPTER_FILES))
  if (unknown.length) {
    console.error(
      `Unknown adapter(s): ${unknown.join(', ')}\nValid adapters: ${Object.keys(ADAPTER_FILES).join(', ')}`,
    )
    process.exit(1)
  }
  const selected = new Set(CORE_FILES)
  for (const name of requested) {
    for (const f of ADAPTER_FILES[name]) selected.add(f)
  }
  return selected
}

function printDiff(rel, srcContent) {
  const dest = join(targetRoot, rel)
  const tmpSrc = join(dirname(dest), `.mock-creator-tmp-${Date.now()}`)
  writeFileSync(tmpSrc, srcContent)
  const result = spawnSync('diff', ['-u', dest, tmpSrc], { encoding: 'utf8' })
  try {
    unlinkSync(tmpSrc)
  } catch {
    // best effort cleanup
  }
  if (result.error) {
    console.log(`    (diff unavailable: ${result.error.message})`)
    return
  }
  const lines = result.stdout.split('\n')
  for (const line of lines.slice(0, 20)) console.log(`    ${line}`)
  if (lines.length > 20) console.log('    ... (truncated)')
}

function runInit(argv) {
  const write = argv.includes('--write')
  const adaptersFlagIndex = argv.indexOf('--adapters')
  const adaptersFlagValue = adaptersFlagIndex === -1 ? null : argv[adaptersFlagIndex + 1]
  const selectedFiles = resolveAdapters(adaptersFlagValue)

  const allTemplateFiles = listTemplateFiles(templatesRoot).concat(VERSION_FILE)
  const filesToProcess = selectedFiles ? allTemplateFiles.filter((f) => selectedFiles.has(f)) : allTemplateFiles

  const toCreate = []
  const identical = []
  const diverged = []

  for (const rel of filesToProcess) {
    const dest = join(targetRoot, rel)
    if (!existsSync(dest)) {
      toCreate.push(rel)
      continue
    }
    const same = getSrcContent(rel, filesToProcess) === readFileSync(dest, 'utf8')
    ;(same ? identical : diverged).push(rel)
  }

  function writeMissing() {
    for (const rel of toCreate) {
      const dest = join(targetRoot, rel)
      mkdirSync(dirname(dest), { recursive: true })
      if (rel === VERSION_FILE) writeFileSync(dest, getSrcContent(rel, filesToProcess))
      else copyFileSync(join(templatesRoot, rel), dest)
    }
  }

  const hasConflicts = identical.length > 0 || diverged.length > 0

  if (!hasConflicts) {
    writeMissing()
    console.log(`mock-creator init: ${toCreate.length} file(s) written (fresh install, no conflicts).\n`)
    for (const f of toCreate) console.log(`  + ${f}`)
    return
  }

  if (!write) {
    console.log('mock-creator init: dry run — existing files found, nothing written yet.\n')
    if (toCreate.length) {
      console.log('Would create:')
      for (const f of toCreate) console.log(`  + ${f}`)
    }
    if (identical.length) {
      console.log('\nAlready up to date (identical to the template):')
      for (const f of identical) console.log(`  = ${f}`)
    }
    if (diverged.length) {
      console.log('\nDiverged from the template — never auto-overwritten, review by hand:')
      for (const f of diverged) {
        console.log(`  ! ${f}`)
        printDiff(f, getSrcContent(f, filesToProcess))
      }
    }
    console.log(
      `\nRun with --write to create the ${toCreate.length} missing file(s) above.` +
        ' Diverged files are never touched automatically, in dry run or with --write.',
    )
    return
  }

  writeMissing()
  console.log(
    `mock-creator init --write: ${toCreate.length} file(s) written, ${identical.length} already up to date, ` +
      `${diverged.length} diverged (left untouched).\n`,
  )
  if (toCreate.length) {
    console.log('Written:')
    for (const f of toCreate) console.log(`  + ${f}`)
  }
  if (diverged.length) {
    console.log('\nDiverged (left untouched — review by hand):')
    for (const f of diverged) console.log(`  ! ${f}`)
  }
}

function runCheckInstall() {
  const versionPath = join(targetRoot, VERSION_FILE)
  if (!existsSync(versionPath)) {
    console.error(`${VERSION_FILE} not found — run "mock-creator init" here first.`)
    process.exitCode = 1
    return
  }

  const installed = JSON.parse(readFileSync(versionPath, 'utf8'))
  const results = { unchanged: [], outdated: [], drifted: [], missing: [] }

  for (const [rel, recordedDigest] of Object.entries(installed.files ?? {})) {
    const dest = join(targetRoot, rel)
    if (!existsSync(dest)) {
      results.missing.push(rel)
      continue
    }
    const currentDigest = sha256(readFileSync(dest, 'utf8'))
    if (currentDigest !== recordedDigest) {
      results.drifted.push(rel)
      continue
    }
    // Not drifted from what was installed — is what was installed still
    // what the package ships today?
    const templatePath = join(templatesRoot, rel)
    if (existsSync(templatePath)) {
      const packageDigest = sha256(readFileSync(templatePath, 'utf8'))
      if (packageDigest !== recordedDigest) {
        results.outdated.push(rel)
        continue
      }
    }
    results.unchanged.push(rel)
  }

  console.log(`mock-creator check-install (installed packageVersion: ${installed.packageVersion ?? 'unknown'}, ` +
    `current package version: ${PACKAGE_VERSION})\n`)

  if (results.unchanged.length) {
    console.log('Unchanged:')
    for (const f of results.unchanged) console.log(`  = ${f}`)
  }
  if (results.outdated.length) {
    console.log('\nOutdated (package templates have moved on, file was never edited locally):')
    for (const f of results.outdated) console.log(`  ^ ${f}`)
  }
  if (results.drifted.length) {
    console.log('\nDrifted (edited locally since install):')
    for (const f of results.drifted) console.log(`  ! ${f}`)
  }
  if (results.missing.length) {
    console.log('\nMissing (recorded at install, not found now):')
    for (const f of results.missing) console.log(`  ? ${f}`)
  }

  const clean = results.outdated.length === 0 && results.drifted.length === 0 && results.missing.length === 0
  console.log(clean ? '\nClean install.' : '\nNot clean — see above.')
  process.exitCode = clean ? 0 : 1
}

const argv = process.argv.slice(2)
const command = argv[0]

if (command === 'init') {
  runInit(argv.slice(1))
} else if (command === 'check-install') {
  runCheckInstall()
} else {
  console.error(`Unknown command: ${command ?? '(none)'}\n\nUsage:\n  mock-creator init [--adapters claude,codex,pi] [--write]\n  mock-creator check-install`)
  process.exit(1)
}
