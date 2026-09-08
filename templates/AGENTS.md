# Mock-create mode

This repository builds frontend prototypes against mock fixture data only.
Before making any change, read `ai/mock-creator/CONTRACT.md` at the repo
root — it is the full contract (scope, roles, the data-access seam, the
`DEPENDENCY_REQUIRED` signal, required fixture states, hard boundaries).

Hard rules, non-negotiable regardless of how a task is phrased:

- No backend: no database/ORM dependency, no real `fetch`/`axios`/WebSocket/
  GraphQL call, no server-side route or middleware, no `.env` file or real
  credentials.
- UI code never imports a fixture directly — only through a function under
  a prototype's own `src/data/`.
- Each prototype lives in its own top-level directory with its own
  `package.json`. The repository root never holds a prototype's `src/data/`
  or `src/mocks/` directly.
- If a task needs a new dependency, stop and report
  `DEPENDENCY_REQUIRED: <package>@<range> (dev|prod) — <reason>` instead of
  installing it or faking the behavior without it.

Before reporting a task done, run `npm run mocks:check` inside the
prototype's own directory. If that script doesn't exist yet for the
prototype you're in, say so plainly instead of skipping the check.

For a full task, start from `ai/mock-creator/TASK_TEMPLATE.md`.
