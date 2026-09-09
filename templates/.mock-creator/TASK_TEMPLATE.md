# Mock-create task template

Copy this as the start of a task prompt (for Codex CLI, Codex app, or any
tool without a named custom-agent format):

---

Mock-create task. Read `.mock-creator/CONTRACT.md` at the repo root and
follow `AGENTS.md`. Work only inside `<prototype-directory>/`, through its
own `src/data/` seam — never import a fixture directly, never add a backend
dependency, never make a real network call.

Task: <describe the UI/prototype work>

Before reporting done:

- Run `npm run mocks:check` inside `<prototype-directory>/`. If it fails,
  fix the reported violations or explain why not.
- If a new dependency is genuinely needed, stop and report
  `DEPENDENCY_REQUIRED: <package>@<range> (dev|prod) — <reason>` instead of
  installing it.
- List changed files, which fixture states you covered, and the validator
  result.

---
