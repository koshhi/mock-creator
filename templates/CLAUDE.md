# Mock-create mode

@.mock-creator/CONTRACT.md

When working on a frontend prototype in this repository, follow mock-create
mode: frontend only, backed by fixture data, no real backend. Full rules
(scope, roles, the data-access seam, `DEPENDENCY_REQUIRED`, required
fixture states, hard boundaries) are in the imported contract above.

Prefer the `mock-designer` subagent (`.claude/agents/mock-designer.md`) for
implementation — no `Bash` by design. Use `mock-verifier`
(`.claude/agents/mock-verifier.md`) to check a change before calling it
done — `Bash`, but no `Write`/`Edit`.

The main session is the parent/orchestrator: the only one that installs an
approved dependency after `DEPENDENCY_REQUIRED`, and the only one with
unrestricted shell access.

Before reporting a task done, run `npm run mocks:check` inside the
prototype's own directory. If that script doesn't exist yet for the
prototype you're in, say so plainly instead of skipping the check.

For a full task, start from `.mock-creator/TASK_TEMPLATE.md`.
