# Mock-create mode

@.mock-creator/CONTRACT.md

This repository builds frontend prototypes against mock fixture data only —
see the imported contract above for the full rules (scope, roles, the
data-access seam, `DEPENDENCY_REQUIRED`, required fixture states, hard
boundaries).

For implementation work, prefer the `mock-designer` subagent
(`.claude/agents/mock-designer.md`) — it has no `Bash` by design. Use
`mock-verifier` (`.claude/agents/mock-verifier.md`) to check a change before
treating it as done; it has `Bash` but no `Write`/`Edit`.

This main session acts as the parent/orchestrator: it is the only one that
installs an approved dependency after a `DEPENDENCY_REQUIRED` report, and the
only one with unrestricted shell access.
