# @mock-creator/mock-creator

English | [Español (España)](README.es-ES.md)

Installer for the mock-create prototyping method: one canonical contract,
tool-specific adapters (Claude Code, Codex, Pi), and a dependency-free
validator — so an AI agent can build a UI prototype without ever drifting
into real backend work.

## Why

An AI coding agent building a frontend prototype will happily wire up a real
database, call a real API, or reach for a real `.env` file if the
conversation drifts there — nothing stops it by default. This package
installs a contract that does: a role split (one agent builds, a different
one verifies, and only the orchestrator session can install a dependency —
and only after a human approves it), a fixed shape for mock data, and a
validator that fails the build the moment any of that gets crossed.

## Benefits

Every claim below is something you can go verify in
`ai/mock-creator/CONTRACT.md` or `bin/check.mjs` — no invented numbers, just
what actually happens when you run it.

### For designers prototyping with AI

- **Ship the full story, not just the best day.** `states.json` +
  `mocks:check` won't let a resource out the door with only the happy path —
  empty, error, and loading are either covered or explicitly declared not
  applicable, with a reason. What you hand off already answers "what if
  there's nothing" and "what if it breaks," instead of raising those
  questions for the first time in review.
- **A prototype that behaves like the product.** Loading states simulate
  real latency instead of resolving instantly, so what you put in front of a
  user already carries the friction a real product would.
- **The AI stays a prototyping tool, not a liability.** No real `fetch`,
  no `.env`, no database driver gets in without `mocks:check` failing —
  "just make it work" can't quietly turn into wiring up infrastructure you
  never asked for and now have to explain.
- **Design once, hand off clean.** Every screen reads through a single
  `src/data/` seam. When it's time to go real, engineering rewrites those
  functions — your layouts and components ship untouched.

### For frontend engineers picking it up

- **You inherit working code, not a picture of one.** The data-access seam
  means the only rewrite is inside `src/data/*` — swap mock for a real call
  and everything above it (components, layouts, routing) keeps working as-is.
- **The states you'd normally discover in QA are already built.** Empty,
  error, and loading aren't left to your imagination three sprints in —
  they're rendered, styled, and sitting in the tree, waiting for real data
  to flow through them.
- **Nothing fake to untangle first.** The hard boundaries guarantee there's
  no half-real `fetch` call or a login that almost works — what's mocked is
  cleanly mocked, so integration starts from a clean seam, not a guessing
  game about what's real.

### For backend engineers reading the handoff

- **A first API spec, before anyone writes an endpoint.** `src/mocks/schemas/`
  already names every field and type the frontend is built against — read it
  once and you know the shape you're building toward.
- **`states.json` is your acceptance checklist.** Whatever's declared `true`
  (empty results, errors, pagination) is behavior your API is expected to
  support; whatever's marked inapplicable comes with a reason attached, so
  you're never guessing what was skipped and why.
- **The error contract, already agreed on.** The frontend is coded against a
  specific error fixture shape — you know exactly what envelope to return
  before integration day, instead of negotiating it live.

### And the process stays honest the whole way

- **A real CI gate, not a lint suggestion.** `mocks:check` is dependency-free
  and exits non-zero the instant scope gets crossed — wire it into CI and a
  violation blocks the merge, it doesn't wait for someone to notice in
  review.
- **The boundary is structural, not a policy someone forgets.**
  `mock-designer` has no `Bash` and no install access — every new dependency
  surfaces as an explicit `DEPENDENCY_REQUIRED` line someone has to approve,
  so `package.json` never changes quietly.

## Installation

```sh
npx github:koshhi/mock-creator init
```

Locally, from a cloned copy of this repo:

```sh
node path/to/mock-creator/bin/init.mjs init
```

Or, once packed:

```sh
npm pack   # produces mock-creator-mock-creator-<version>.tgz
npx ./mock-creator-mock-creator-<version>.tgz init
```

## Usage

### Commands

- **`init`** — writes the contract, adapters, and validator into the current
  directory. A fresh install (nothing exists yet) writes everything
  immediately. If anything already exists, it defaults to a dry run: shows
  what it would create, what's already identical, and a diff for anything
  that's diverged — and writes nothing until you re-run with `--write`.
  `--write` only creates missing files; it never touches one that already
  exists, identical or diverged.
- **`init --adapters claude,codex,pi`** — only install the files a given set
  of AI coding tools needs, instead of everything: `claude` for Claude Code,
  `codex` for the OpenAI Codex CLI, `pi` for Pi. `AGENTS.md` is shared by
  `codex` and `pi` (both discover it) and only gets written once even if both
  are requested.
- **`check-install`** — reads the digests `init` recorded in
  `ai/mock-creator/VERSION.json` and reports each installed file as
  unchanged, drifted (edited locally since install), outdated (the
  package's own template moved on since install), or missing.

### What gets installed

```
AGENTS.md
CLAUDE.md
.claude/agents/mock-designer.md
.claude/agents/mock-verifier.md
.pi/agents/mock-designer.md
.pi/agents/mock-verifier.md
ai/mock-creator/
├── CONTRACT.md
├── VERSION.json
├── TASK_TEMPLATE.md
└── bin/check.mjs
```

Read `ai/mock-creator/CONTRACT.md` after installing — it's the operative
document every agent file points back to. Short version:

- **Data contract**: every resource needs a schema (`src/mocks/schemas/`), a
  fixture validated against it (`src/mocks/fixtures/`), and a data-access
  function (`src/data/`) — UI code never imports a fixture directly.
- **Required states**: `src/mocks/states.json` declares, per resource,
  whether happy/empty/error/loading/pagination is covered (`true`) or
  genuinely doesn't apply (`{ "applicable": false, "reason": "..." }`).
- **Hard boundaries**: no DB/ORM/backend-framework dependency, no
  `fetch`/`axios` to a non-mock URL, no `.env` or real credentials, no
  server-side code — never, regardless of how the request is phrased.

### Wiring the validator

Add this to each prototype's own `package.json` (adjusting the relative path
to `ai/mock-creator/bin/check.mjs`), then run it from inside that prototype's
own directory before treating a change as done:

```json
"scripts": {
  "mocks:check": "node ai/mock-creator/bin/check.mjs"
}
```

It scans that prototype's `src/` and fails on: missing
`src/data|mocks/fixtures|mocks/schemas` structure, a fixture imported outside
`src/data/`, a banned backend dependency in `package.json`, a real
`fetch`/`axios`/`WebSocket`/GraphQL call outside `src/data/`, an `.env*` file
at the prototype root, an `api/` or `server/` directory under `src/`, or
`states.json` missing the happy/empty/error/loading state for any fixture it
finds. Pagination is contract guidance — `check.mjs` doesn't enforce it
automatically yet.

## License

MIT
