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
// CLAUDE.md and AGENTS.md are the two exceptions: they live at the project
// root, so something else may have already created one before mock-creator
// ever runs. Those two get wrapped in a `<!-- mock-creator:start -->` /
// `<!-- mock-creator:end -->` marker pair (every other installed file is
// untouched by this). --merge, independent of --write, lets init append its
// block to an existing file that has no block yet, or update the block in
// place on a later reinstall — never touching the rest of the file.
//
// check-install: reads the digests init recorded in
// .mock-creator/VERSION.json and reports, per file, whether it's
// unchanged, locally drifted since install, outdated against the
// package's current templates, or missing. For CLAUDE.md/AGENTS.md it
// compares only the content between the markers, so a file customized
// around the mock-creator block doesn't show up as drifted.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const templatesRoot = join(__dirname, '..', 'templates')
const targetRoot = process.cwd()
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
const PACKAGE_VERSION = packageJson.version

const VERSION_FILE = '.mock-creator/VERSION.json'

// Files every install needs regardless of which tool adapters are picked.
const CORE_FILES = [
  '.mock-creator/CONTRACT.md',
  VERSION_FILE,
  '.mock-creator/TASK_TEMPLATE.md',
  '.mock-creator/bin/check.mjs',
]

// Per-tool files. AGENTS.md is shared by codex and pi (both discover it),
// not duplicated — requesting either pulls it in once.
const ADAPTER_FILES = {
  claude: ['CLAUDE.md', '.claude/agents/mock-designer.md', '.claude/agents/mock-verifier.md'],
  pi: ['AGENTS.md', '.pi/agents/mock-designer.md', '.pi/agents/mock-verifier.md'],
  codex: ['AGENTS.md'],
}

// The only two files that get wrapped in mock-creator markers and can be
// merged into a pre-existing file. Everything else is copied verbatim.
const MERGE_FILES = new Set(['CLAUDE.md', 'AGENTS.md'])
const START_MARKER = '<!-- mock-creator:start -->'
const END_MARKER = '<!-- mock-creator:end -->'

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
// generated on the fly instead of copied. For MERGE_FILES the digest is of
// the template's own body, not the wrapped block or the whole (possibly
// merged) destination file — that's what makes the marker-aware comparison
// in check-install possible.
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

// Ensures content ends with exactly one trailing newline before it gets
// wrapped or spliced, so marker lines always land on their own line.
function withTrailingNewline(content) {
  return content.endsWith('\n') ? content : content + '\n'
}

function wrapBlock(templateContent) {
  return `${START_MARKER}\n${withTrailingNewline(templateContent)}${END_MARKER}\n`
}

// Looks for the marker pair in an existing file's content.
// - { present: false } — no start marker at all (something else created
//   this file, or a pre-mock-creator version).
// - { present: true, malformed: true } — start marker with no matching end
//   marker. Treated like `diverged` — reported, never touched.
// - { present: true, malformed: false, blockContent, startIdx, endIdx } —
//   well-formed pair. blockContent is the text strictly between them.
function extractBlock(fileContent) {
  const startIdx = fileContent.indexOf(START_MARKER)
  if (startIdx === -1) return { present: false }
  const endIdx = fileContent.indexOf(END_MARKER, startIdx)
  if (endIdx === -1) return { present: true, malformed: true }
  let contentStart = startIdx + START_MARKER.length
  if (fileContent[contentStart] === '\n') contentStart += 1
  return {
    present: true,
    malformed: false,
    startIdx,
    endIdx,
    blockContent: fileContent.slice(contentStart, endIdx),
  }
}

// Appends a marker-wrapped block to the end of a file: the file's existing
// content untouched (normalized to end with exactly one newline), then one
// blank line, then the block.
function appendBlock(existingContent, block) {
  return withTrailingNewline(existingContent).replace(/\n*$/, '\n') + '\n' + block
}

// Replaces only the content between an existing, well-formed marker pair —
// everything before the start marker and after the end marker is left
// byte-for-byte untouched.
function replaceBlock(existingContent, extracted, templateContent) {
  const before = existingContent.slice(0, extracted.startIdx + START_MARKER.length)
  const afterNewline = existingContent[extracted.startIdx + START_MARKER.length] === '\n' ? '\n' : ''
  const after = existingContent.slice(extracted.endIdx)
  return before + afterNewline + withTrailingNewline(templateContent) + after
}

// After a --write/--merge run, VERSION.json needs to reflect the digests of
// whatever was actually just written or merged — otherwise a file that was
// just brought up to date (e.g. via --merge replacing an outdated block)
// keeps its stale recorded digest and check-install misreports it as
// "drifted" instead of "unchanged". If VERSION.json didn't exist yet,
// writeMissing() already generated it fresh from the full file list, so
// there's nothing to patch.
function syncVersionFile(writtenRels) {
  if (!writtenRels.length) return
  const versionPath = join(targetRoot, VERSION_FILE)
  if (!existsSync(versionPath)) return
  const installed = JSON.parse(readFileSync(versionPath, 'utf8'))
  installed.packageVersion = PACKAGE_VERSION
  installed.files = installed.files ?? {}
  for (const rel of writtenRels) {
    if (rel === VERSION_FILE) continue
    installed.files[rel] = sha256(readFileSync(join(templatesRoot, rel), 'utf8'))
  }
  writeFileSync(versionPath, JSON.stringify(installed, null, 2) + '\n')
}

// exitOnError defaults to true (the original CLI-flag-validation behavior).
// --interactive's reprompt loop passes { exitOnError: false } so a bad
// answer can be re-asked instead of killing the process; it's told apart
// from the "no filter" `null` result by getting `undefined` back instead.
function resolveAdapters(adaptersFlagValue, { exitOnError = true } = {}) {
  if (!adaptersFlagValue) return null // null = no filter, everything
  const requested = adaptersFlagValue.split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = requested.filter((name) => !(name in ADAPTER_FILES))
  if (unknown.length) {
    console.error(
      `Unknown adapter(s): ${unknown.join(', ')}\nValid adapters: ${Object.keys(ADAPTER_FILES).join(', ')}`,
    )
    if (exitOnError) process.exit(1)
    return undefined
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

function printBlock(block) {
  const lines = block.split('\n')
  for (const line of lines) console.log(`    ${line}`)
}

// Categorizes every template file (already filtered down to the selected
// adapters) relative to the target directory. Shared by the non-interactive
// dry-run/--write/--merge path and the --interactive path so both compute
// identical toCreate/identical/diverged/mergeable/outdatedBlock results for
// the same selected files.
function categorizeFiles(filesToProcess) {
  const toCreate = []
  const identical = []
  const diverged = []
  const mergeable = [] // { rel, block }
  const outdatedBlock = [] // { rel, extracted, templateContent, destContent }

  for (const rel of filesToProcess) {
    const dest = join(targetRoot, rel)
    if (!existsSync(dest)) {
      toCreate.push(rel)
      continue
    }

    if (MERGE_FILES.has(rel)) {
      const destContent = readFileSync(dest, 'utf8')
      const templateContent = getSrcContent(rel, filesToProcess)
      const extracted = extractBlock(destContent)
      if (!extracted.present) {
        mergeable.push({ rel, block: wrapBlock(templateContent) })
      } else if (extracted.malformed) {
        diverged.push(rel)
      } else if (extracted.blockContent === withTrailingNewline(templateContent)) {
        identical.push(rel)
      } else {
        outdatedBlock.push({ rel, extracted, templateContent, destContent })
      }
      continue
    }

    const same = getSrcContent(rel, filesToProcess) === readFileSync(dest, 'utf8')
    ;(same ? identical : diverged).push(rel)
  }

  return { toCreate, identical, diverged, mergeable, outdatedBlock }
}

function writeMissingFiles(toCreate, filesToProcess) {
  for (const rel of toCreate) {
    const dest = join(targetRoot, rel)
    mkdirSync(dirname(dest), { recursive: true })
    if (rel === VERSION_FILE) writeFileSync(dest, getSrcContent(rel, filesToProcess))
    else if (MERGE_FILES.has(rel)) writeFileSync(dest, wrapBlock(getSrcContent(rel, filesToProcess)))
    else copyFileSync(join(templatesRoot, rel), dest)
  }
}

function applyMergeFiles(mergeable, outdatedBlock) {
  for (const { rel, block } of mergeable) {
    const dest = join(targetRoot, rel)
    const existingContent = readFileSync(dest, 'utf8')
    writeFileSync(dest, appendBlock(existingContent, block))
  }
  for (const { rel, extracted, templateContent, destContent } of outdatedBlock) {
    const dest = join(targetRoot, rel)
    writeFileSync(dest, replaceBlock(destContent, extracted, templateContent))
  }
}

function runInit(argv) {
  const write = argv.includes('--write')
  const merge = argv.includes('--merge')
  const adaptersFlagIndex = argv.indexOf('--adapters')
  const adaptersFlagValue = adaptersFlagIndex === -1 ? null : argv[adaptersFlagIndex + 1]
  const selectedFiles = resolveAdapters(adaptersFlagValue)

  const allTemplateFiles = listTemplateFiles(templatesRoot).concat(VERSION_FILE)
  const filesToProcess = selectedFiles ? allTemplateFiles.filter((f) => selectedFiles.has(f)) : allTemplateFiles

  const { toCreate, identical, diverged, mergeable, outdatedBlock } = categorizeFiles(filesToProcess)

  function writeMissing() {
    writeMissingFiles(toCreate, filesToProcess)
  }

  function applyMerge() {
    applyMergeFiles(mergeable, outdatedBlock)
  }

  const hasConflicts =
    identical.length > 0 || diverged.length > 0 || mergeable.length > 0 || outdatedBlock.length > 0

  if (!hasConflicts) {
    writeMissing()
    console.log(`mock-creator init: ${toCreate.length} file(s) written (fresh install, no conflicts).\n`)
    for (const f of toCreate) console.log(`  + ${f}`)
    return
  }

  if (!write && !merge) {
    console.log('mock-creator init: dry run — existing files found, nothing written yet.\n')
    if (toCreate.length) {
      console.log('Would create:')
      for (const f of toCreate) console.log(`  + ${f}`)
    }
    if (identical.length) {
      console.log('\nAlready up to date (identical to the template):')
      for (const f of identical) console.log(`  = ${f}`)
    }
    if (mergeable.length) {
      console.log('\nMergeable — no mock-creator block yet, would append:')
      for (const { rel, block } of mergeable) {
        console.log(`  ~ ${rel}`)
        printBlock(block)
      }
    }
    if (outdatedBlock.length) {
      console.log('\nMock-creator block outdated, would update:')
      for (const { rel, templateContent } of outdatedBlock) {
        console.log(`  ^ ${rel}`)
        printBlock(withTrailingNewline(templateContent))
      }
    }
    if (diverged.length) {
      console.log('\nDiverged from the template — never auto-overwritten, review by hand:')
      for (const f of diverged) {
        console.log(`  ! ${f}`)
        printDiff(f, MERGE_FILES.has(f) ? wrapBlock(getSrcContent(f, filesToProcess)) : getSrcContent(f, filesToProcess))
      }
    }
    console.log(
      `\nRun with --write to create the ${toCreate.length} missing file(s) above.` +
        (mergeable.length || outdatedBlock.length
          ? ` Run with --merge to append/update the ${mergeable.length + outdatedBlock.length} mock-creator ` +
            'block(s) above.'
          : '') +
        ' Diverged files are never touched automatically, in dry run, with --write, or with --merge.',
    )
    return
  }

  if (write) writeMissing()
  if (merge) applyMerge()
  syncVersionFile([
    ...(write ? toCreate : []),
    ...(merge ? mergeable.map((m) => m.rel) : []),
    ...(merge ? outdatedBlock.map((o) => o.rel) : []),
  ])

  const parts = []
  if (write) parts.push(`${toCreate.length} file(s) written`)
  parts.push(`${identical.length} already up to date`)
  if (merge) parts.push(`${mergeable.length} mock-creator block(s) appended, ${outdatedBlock.length} updated`)
  else if (mergeable.length || outdatedBlock.length) {
    parts.push(`${mergeable.length + outdatedBlock.length} mock-creator block(s) mergeable (left untouched — run with --merge)`)
  }
  parts.push(`${diverged.length} diverged (left untouched)`)

  console.log(`mock-creator init${write ? ' --write' : ''}${merge ? ' --merge' : ''}: ${parts.join(', ')}.\n`)

  if (write && toCreate.length) {
    console.log('Written:')
    for (const f of toCreate) console.log(`  + ${f}`)
  }
  if (!write && toCreate.length) {
    console.log('Not created (pass --write too):')
    for (const f of toCreate) console.log(`  + ${f}`)
  }
  if (merge && mergeable.length) {
    console.log('\nAppended:')
    for (const { rel } of mergeable) console.log(`  ~ ${rel}`)
  }
  if (merge && outdatedBlock.length) {
    console.log('\nBlock updated:')
    for (const { rel } of outdatedBlock) console.log(`  ^ ${rel}`)
  }
  if (!merge && (mergeable.length || outdatedBlock.length)) {
    console.log('\nMock-creator block mergeable (left untouched — run with --merge):')
    for (const { rel } of mergeable) console.log(`  ~ ${rel}`)
    for (const { rel } of outdatedBlock) console.log(`  ^ ${rel}`)
  }
  if (diverged.length) {
    console.log('\nDiverged (left untouched — review by hand):')
    for (const f of diverged) console.log(`  ! ${f}`)
  }
}

// --interactive/-i walks the user through the same decisions --write/--merge
// make blindly: which adapters to install, and per mergeable/outdated file
// whether to touch it. This is opt-in only (never auto-detected from a TTY)
// so a scripted/agent caller's behavior can never change by surprise — see
// the isTTY guard below for the other half of that guarantee.
async function runInteractiveInit(argv) {
  // MOCK_CREATOR_FORCE_INTERACTIVE=1 is an internal testing hook, not
  // documented for end users: piped stdin normally reports isTTY: false, so
  // this lets a test still drive the prompts below via scripted stdin.
  const forceInteractive = process.env.MOCK_CREATOR_FORCE_INTERACTIVE === '1'
  if (!process.stdin.isTTY && !forceInteractive) {
    console.log('--interactive requires an interactive terminal — falling back to the normal dry run.')
    runInit(argv.filter((a) => a !== '--interactive' && a !== '-i'))
    return
  }

  const adaptersFlagIndex = argv.indexOf('--adapters')
  const adaptersExplicit = adaptersFlagIndex !== -1
  const adaptersFlagValue = adaptersExplicit ? argv[adaptersFlagIndex + 1] : null

  if (argv.includes('--write') || argv.includes('--merge')) {
    console.log(
      'Note: --write/--merge are ignored with --interactive — the prompts below decide what gets written.\n',
    )
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  // rl.question() adds a one-shot 'line' listener per call. If several
  // answers arrive in one stdin chunk (as they do with fast piped input —
  // the exact way the escape hatch above is used for testing), readline
  // emits all buffered lines synchronously and any line with no listener
  // attached at that instant is silently dropped before the next
  // rl.question() call gets a chance to listen for it. Registering a single
  // persistent 'line' listener up front and pulling from our own queue
  // avoids that loss regardless of how fast the input arrives.
  const lineBuffer = []
  const lineWaiters = []
  let inputClosed = false
  rl.on('line', (line) => {
    if (lineWaiters.length) lineWaiters.shift().resolve(line)
    else lineBuffer.push(line)
  })
  // If stdin closes while a prompt is pending (e.g. Ctrl-D, or the piped
  // input simply runs out), don't leave the process hanging forever on an
  // unresolved promise — reject it so the top-level .catch can report a
  // clean error and exit instead of an invisible hang.
  rl.on('close', () => {
    inputClosed = true
    while (lineWaiters.length) {
      lineWaiters.shift().reject(new Error('Input closed before an answer was given.'))
    }
  })
  function nextLine() {
    if (lineBuffer.length) return Promise.resolve(lineBuffer.shift())
    if (inputClosed) return Promise.reject(new Error('Input closed before an answer was given.'))
    return new Promise((resolve, reject) => lineWaiters.push({ resolve, reject }))
  }
  async function prompt(text) {
    process.stdout.write(text)
    return nextLine()
  }
  try {
    let selectedFiles = adaptersExplicit ? resolveAdapters(adaptersFlagValue) : null
    if (!adaptersExplicit) {
      for (;;) {
        const answer = await prompt(
          'Which AI coding tools do you use in this project? (claude, codex, pi — comma-separated, or press enter for all): ',
        )
        const trimmed = answer.trim()
        if (!trimmed) {
          selectedFiles = null
          break
        }
        const result = resolveAdapters(trimmed, { exitOnError: false })
        if (result === undefined) continue // invalid — resolveAdapters already printed why; re-prompt
        selectedFiles = result
        break
      }
    }

    const allTemplateFiles = listTemplateFiles(templatesRoot).concat(VERSION_FILE)
    const filesToProcess = selectedFiles ? allTemplateFiles.filter((f) => selectedFiles.has(f)) : allTemplateFiles

    const { toCreate, diverged, mergeable, outdatedBlock } = categorizeFiles(filesToProcess)

    // Nothing to lose by writing files that didn't exist before — no prompt.
    writeMissingFiles(toCreate, filesToProcess)

    const appended = []
    const updated = []
    const leftForManualCopy = []

    for (const { rel, block } of mergeable) {
      printBlock(block)
      const answer = await prompt(`Append this block to ${rel}? (y/N): `)
      if (/^y/i.test(answer.trim())) {
        const dest = join(targetRoot, rel)
        const existingContent = readFileSync(dest, 'utf8')
        writeFileSync(dest, appendBlock(existingContent, block))
        appended.push(rel)
      } else {
        console.log(`\nNot touching ${rel}. Copy this into it yourself:\n`)
        printBlock(block)
        leftForManualCopy.push(rel)
      }
    }

    for (const { rel, extracted, templateContent, destContent } of outdatedBlock) {
      const newBlock = wrapBlock(templateContent)
      printBlock(newBlock)
      const answer = await prompt(`Update the mock-creator block in ${rel}? (y/N): `)
      if (/^y/i.test(answer.trim())) {
        const dest = join(targetRoot, rel)
        writeFileSync(dest, replaceBlock(destContent, extracted, templateContent))
        updated.push(rel)
      } else {
        console.log(`\nNot touching ${rel}. Copy this into it yourself:\n`)
        printBlock(newBlock)
        leftForManualCopy.push(rel)
      }
    }

    // Only paths actually written this run may have their recorded digest
    // updated — files left for manual copy weren't touched on disk, so their
    // digest must not move either (see syncVersionFile's own comment).
    syncVersionFile([...toCreate, ...appended, ...updated])

    console.log('\nmock-creator init --interactive: done.\n')
    if (toCreate.length) {
      console.log('Written:')
      for (const f of toCreate) console.log(`  + ${f}`)
    }
    if (appended.length) {
      console.log('\nAppended:')
      for (const f of appended) console.log(`  ~ ${f}`)
    }
    if (updated.length) {
      console.log('\nBlock updated:')
      for (const f of updated) console.log(`  ^ ${f}`)
    }
    if (leftForManualCopy.length) {
      console.log('\nLeft for manual copy (see above):')
      for (const f of leftForManualCopy) console.log(`  ? ${f}`)
    }
    if (diverged.length) {
      console.log('\nDiverged (never touched):')
      for (const f of diverged) console.log(`  ! ${f}`)
    }
  } finally {
    rl.close()
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

    if (MERGE_FILES.has(rel)) {
      if (!existsSync(dest)) {
        results.missing.push(rel)
        continue
      }
      const extracted = extractBlock(readFileSync(dest, 'utf8'))
      if (!extracted.present) {
        // No mock-creator block installed here, regardless of whether some
        // unrelated file happens to exist at this path.
        results.missing.push(rel)
        continue
      }
      if (extracted.malformed) {
        results.drifted.push(rel)
        continue
      }
      const currentDigest = sha256(extracted.blockContent)
      if (currentDigest !== recordedDigest) {
        results.drifted.push(rel)
        continue
      }
      const templatePath = join(templatesRoot, rel)
      if (existsSync(templatePath)) {
        const packageDigest = sha256(readFileSync(templatePath, 'utf8'))
        if (packageDigest !== recordedDigest) {
          results.outdated.push(rel)
          continue
        }
      }
      results.unchanged.push(rel)
      continue
    }

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
  const initArgv = argv.slice(1)
  if (initArgv.includes('--interactive') || initArgv.includes('-i')) {
    runInteractiveInit(initArgv).catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
  } else {
    runInit(initArgv)
  }
} else if (command === 'check-install') {
  runCheckInstall()
} else {
  console.error(
    `Unknown command: ${command ?? '(none)'}\n\nUsage:\n` +
      '  mock-creator init [--adapters claude,codex,pi] [--write] [--merge] [--interactive|-i]\n' +
      '  mock-creator check-install',
  )
  process.exit(1)
}
