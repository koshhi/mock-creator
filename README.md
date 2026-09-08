# @mock-creator/mock-creator

Installer for the mock-create prototyping method: one canonical contract,
tool-specific adapters (Claude Code, Codex, Pi), and a dependency-free
validator — so an AI agent can build a UI prototype without ever drifting
into real backend work.

This is the working copy — changes are made here first. The published,
installable version lives at
[koshhi/mock-creator](https://github.com/koshhi/mock-creator) (public); this
repo ([mock-creator-development](../../README.md)) is private, where the
method itself gets designed and piloted. Syncing changes over is currently a
manual copy, not automated.

## Usage

From any repo, once a change here has been copied over and pushed:

```sh
npx github:koshhi/mock-creator init
```

Locally, straight from this working copy:

```sh
node path/to/mock-creator/bin/init.mjs init
```

Or, once packed:

```sh
npm pack   # produces mock-creator-mock-creator-<version>.tgz
npx ./mock-creator-mock-creator-<version>.tgz init
```

### Commands

- **`init`** — writes the contract, adapters, and validator into the current
  directory. A fresh install (nothing exists yet) writes everything
  immediately. If anything already exists, it defaults to a dry run: shows
  what it would create, what's already identical, and a diff for anything
  that's diverged — and writes nothing until you re-run with `--write`.
  `--write` only creates missing files; it never touches one that already
  exists, identical or diverged.
- **`init --adapters claude,codex,pi`** — only install the files a given set
  of tools needs, instead of everything. `AGENTS.md` is shared by `codex`
  and `pi` (both discover it) and only gets written once even if both are
  requested.
- **`check-install`** — reads the digests `init` recorded in
  `ai/mock-creator/VERSION.json` and reports each installed file as
  unchanged, drifted (edited locally since install), outdated (the
  package's own template moved on since install), or missing.

## What gets installed

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

Wire `"mocks:check": "node ai/mock-creator/bin/check.mjs"` into each
prototype's own `package.json` (adjusting the relative path to
`ai/mock-creator/bin/check.mjs`), then run it from inside that prototype's
own directory before treating a change as done.
