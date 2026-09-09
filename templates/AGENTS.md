# Mock-create mode

When working on a frontend prototype in this repository, follow mock-create
mode: frontend only, backed by fixture data, no real backend. Read
`.mock-creator/CONTRACT.md` at the repo root for the full rules (scope,
roles, the data-access seam, the `DEPENDENCY_REQUIRED` signal, required
fixture states, hard boundaries).

Before reporting a task done, run `npm run mocks:check` inside the
prototype's own directory. If that script doesn't exist yet for the
prototype you're in, say so plainly instead of skipping the check.

For a full task, start from `.mock-creator/TASK_TEMPLATE.md`.
