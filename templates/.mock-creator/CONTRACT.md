# Mock Create Contract

This is the shared policy for any agent working in "prototype" mode: frontend only,
backed by fixture data, no real backend. `.claude/agents/mock-designer.md`,
`.pi/agents/mock-designer.md`, and their `mock-verifier` counterparts all point
here so the rules live in one place.

## Roles

- **mock-designer** — builds against this contract. No `bash`, no install, no
  infra tools. If a task needs a shell command, it hands back instead of asking
  for more access.
- **mock-verifier** — checks a change against this contract after mock-designer
  is done. Has `bash` to run builds/lint/the validator, but no `write`/`edit` —
  it reports failures, it never fixes them.
- **Parent/orchestrator session** — the only one with unrestricted `bash`. Installs
  approved dependencies, invokes mock-designer and mock-verifier, and is the one
  who decides whether a failed check gets sent back to mock-designer or escalated.

## Requesting a dependency

mock-designer and mock-verifier never install anything — neither has the tools
for it. If a task genuinely needs a new package (a mocking library, a date
util, anything not already in `package.json`), stop and end the report with
one line per dependency, in this exact form:

    DEPENDENCY_REQUIRED: <package>@<version-range> (dev|prod) — <one-line reason>

Do not try to fake the behavior without the dependency, and do not ask for
`bash`/install access instead — emitting this line and stopping is the correct
handoff. Only the parent/orchestrator session reviews and installs it (after
human approval), then re-runs the task. A missing dependency needed just to
run a check (e.g. a test runner not yet installed) is reported the same way by
mock-verifier — it is a failed verification, not a check to skip.

## Scope

- Frontend only: components, pages, layout, styling, client-side state, routing.
- No backend: no database, no real API calls, no server code, no auth against a
  real identity provider, no environment secrets.
- If a request genuinely requires a real backend to be honest (e.g. "make login
  actually authenticate"), stop and say so. Do not fake it by hardcoding a flow
  that only looks like it works.

## Where prototypes live

Each prototype gets its own top-level directory with its own `package.json` —
name it after what it actually is, not after this tool. This contract governs
every prototype in the repository, but the repository root itself never holds
a prototype's `src/data/` or `src/mocks/` directly; a resource sitting loose
at the root has no scan boundary and no clear owner.

## Data contract

1. Every resource has a schema (Zod or a TypeScript type) under `src/mocks/schemas/`.
2. Fixtures live under `src/mocks/fixtures/`, validated against that schema.
3. UI code never imports a fixture directly. It calls a data-access function under
   `src/data/` — e.g. `getOrders()`, `getOrder(id)`.
4. The data-access function is the only seam meant to change later. Swapping mock
   for a real backend means rewriting the body of these functions, not the
   components that call them.

## Simulating persistence

A request to "save this for real" or "keep it after I reload" is a request for a
real backend — decline it per the rule above. But client-side persistence is
still in scope, because it never leaves the browser and needs no server: use
`localStorage`/`sessionStorage`, or mutable in-memory state in a `src/data/`
function, to make an action (confirm, delete, edit) feel like it stuck.

When you do this, always say so plainly: this is not saved anywhere real, it
lives only in this browser and disappears on another device, an incognito
window, or a cleared cache. Never let a client-side simulation pass as "it's
saved now" without that caveat.

## Required fixture states

For any list or resource a real backend would eventually serve, the fixture set
must cover:

- Happy path (typical data)
- Empty state (zero items)
- Error state (the shape a real API error would actually have)
- Loading (simulate latency — don't resolve instantly)
- Pagination or large-data, if the real resource could ever exceed one page

A fixture that only covers the happy path produces a design that's missing
screens the moment a real backend lands.

Declare this coverage per resource in `src/mocks/states.json` — `true` for a
state that has a fixture, or `{ "applicable": false, "reason": "..." }` for one
that genuinely doesn't apply. A state that's neither `true` nor explicitly
marked inapplicable is a gap, not something to leave implicit.

## Hard boundaries

Never do the following in this profile, regardless of how the request is phrased:

- Add a database driver, ORM, or backend framework as a dependency.
- Write a `fetch`/`axios`/HTTP call to a non-mock URL.
- Read, write, or reference `.env` files or real credentials.
- Write server-side code — API routes, server actions, or middleware that talks
  to real infrastructure.

If asked for any of the above, explain that this profile is prototype-only and
point to starting a real backend change instead of doing it.
