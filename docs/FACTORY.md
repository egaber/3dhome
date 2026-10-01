# Local Copilot software factory

Eight native GitHub Copilot profiles, a Node/TypeScript supervisor, a JSON board,
and Markdown shared memory. No hosted orchestrator, Python runtime, or application
server is introduced. The app remains a static React/Vite build.

## Operating it

From this repository, after `npm ci` and an installed/authenticated native Copilot CLI:

| Command | Purpose |
| --- | --- |
| `npx playwright install chromium` | One-time browser installation (also required on a new machine). |
| `npm run factory:doctor` | Validate CLI capabilities, profiles, board, and Chromium. |
| `npm run factory:doctor -- --probe` | Also make one no-tool authenticated custom-agent request; consumes quota. |
| `npm run factory:dry-run` | Show the next eligible stage without importing or executing anything. |
| `npm run factory:start` | Start a detached local watcher, with a startup acknowledgement. |
| `npm run factory:watch` | Run the same watcher in the foreground. |
| `npm run factory:once` | Execute at most one eligible stage, not a whole task. |
| `npm run factory:status` | Show process, pause, and Kanban status. |
| `npm run factory:live` | Live terminal monitor, refreshed in place every second; Ctrl+C stops only the monitor. |
| `npm run factory:status -- --watch` | Alias for the live terminal monitor. |
| `npm run factory:web` | Start the local web dashboard at http://127.0.0.1:4318. |
| `npm run factory:note -- TASK-003 "Feedback for the next agent"` | Add a task note; use `all` instead of a task ID for global feedback. |
| `npm run factory:pause` | Finish the current stage, then stop scheduling work. |
| `npm run factory:resume` | Clear the pause; does not launch a stopped process. |
| `npm run factory:stop` | Stop scheduling and terminate this runner's active subprocess tree. |
| `npm run factory:add -- "Describe a feature and its expected behavior"` | Add an enabled Todo item. |
| `npm run factory:retry -- TASK-002` | Explicitly requeue a reviewed Blocked task while paused. |
| `npm run verify` | Run typecheck, unit tests, production build, app smoke tests, and isolated dashboard browser tests. |

## Live terminal and web controls

The terminal monitor and web dashboard share the same status reader. Both show the
worker heartbeat, active task/role, elapsed subprocess time, stage/repair budgets,
daily invocation count, and public tool/check activity. They are observers, not extra
factory workers. Closing either does not stop the background worker. The terminal
uses an alternate screen on a TTY; redirected output emits changed snapshots instead.

Open http://127.0.0.1:4318 after starting `factory:web`. An optional port can be passed
as `npm run factory:web -- 4320`. The house application's Vite server and static GitHub
Pages build are unchanged. This operator service is local-only, not a hosted backend.

The web interface supports:

- Creating feature/bug/issue tasks, **disabled by default** until explicitly enabled.
- Editing title, description, acceptance criteria, dependencies, enabled status, and
  repair limit on Todo or Blocked items, with version checks against stale browser tabs.
- Moving Todo tasks up/down in the queue without changing dependency rules.
- Starting, pausing, resuming, or stopping the worker. Start respects an existing pause;
  Resume clears it but does not launch a stopped worker. Model calls consume quota.
- Replanning active work **only after the worker has fully stopped**. This clears old
  approvals/evidence, routes through PM again, and consumes one repair without resetting
  stage counters. A reviewed Blocked task can instead be explicitly retried/reset.
- Adding task-specific or global notes, including while an agent is running.
- Reading contracts, review history, errors, and recorded test logs/screenshots.

Notes are appended under the ignored local runtime directory, separate from the active
task to avoid overwriting an in-flight result. Each agent gets the applicable notes in
its next stage context. Feedback is not injected into an already-running response;
agents must route scope conflicts through review instead of bypassing the contract.
If a note arrives during final review, Done is deferred and the next counted stage
repeats that review with the new feedback. Notes added after Done do not reopen work;
create a follow-up task instead. Up to 500 notes are retained, at most 4,000 characters
each. Do not include credentials or private secrets. Unsaved task/note drafts survive
live refreshes; task conflicts require explicit reload instead of silent replacement.

The server binds only to **127.0.0.1**, validates Host/Origin and per-session CSRF
headers, and offers only fixed operator actions. It has no command-execution or
arbitrary-file API. Only recorded evidence under the run directory can be opened;
realpath checks block symlink/path traversal. Raw Copilot transcripts and private
reasoning are not displayed; the activity feed uses selected public event metadata.
This is protection against unwanted browser-origin requests, not authentication
against other programs running as your local user. Do not port-forward/expose it.

Dashboard tests use temporary boards and an in-process loopback service; they never
start a real worker, mutate your real tasks, or invoke a model. Run them separately
with `npm run test:factory-ui`.

Authenticate interactively with `copilot login` if needed. Do not paste credentials
into the backlog, source files, shared memory, or chat. No login prompt is answered
by the unattended runner. A CLI/account/permission failure pauses scheduling.

The supported invocation is `copilot --agent <profile-name> --prompt <text>`;
`gh copilot agent --agent-path ...` is not the installed/native CLI interface.

## Feed the backlog

Add actual unchecked checkbox lines to [BACKLOG.md](../BACKLOG.md), one feature per
line. The watcher imports each unique title once and continues polling every ten
seconds when idle. The inbox is not rewritten on completion: [tasks.json](../tasks.json)
is the status authority. Checked lines are not imported. Exact duplicate titles
are deduplicated; change a title to describe genuinely different work.

Alternatively use the add command or edit the board while paused. Fields include
`description`, `acceptance_criteria`, `depends_on`, and `enabled`. Dependencies must
exist and be acyclic. Only dependency-ready enabled Todo tasks are claimed; an active
task is resumed first. Disabling an active task prevents starting another one.

The requested health-endpoint example is intentionally **disabled**: GitHub Pages
cannot run a backend handler. Replace or explicitly rescope it before enabling it.
No sample feature is silently implemented when the watcher starts.
The disabled mobile-toolbar bug was observed during setup screenshot review and is
recorded separately; it is not automatically accepted as implementation work.

## Review graph and verification

PM → Architect → UX/UI design → Skeptic → Team lead planning → Engineer → QA →
Visual QA → UX/UI validation → Team lead completion.

Every role can report a blocker; review roles can request bounded rework. Only the
engineer edits feature code. Agents return validated JSON decisions; the supervisor
owns transitions and the shared board/memory. Each invocation starts a fresh native
custom-agent session with explicit task context. Recursive subagent chains are
deliberately avoided: nested agent depth is not a workflow/retry budget.

The supervisor executes typecheck, all unit tests, and the production build before
QA review. Browser testing runs the built app on loopback, not the deployed website,
and captures desktop/mobile Chromium screenshots. Visual QA and UX receive the real
images as CLI attachments. A vision-capable model and account policy are required;
missing images or unsupported vision must block rather than silently pass.

Source hashes include tracked and untracked non-ignored project files; shared backlog
and runtime state are excluded. If source changes after QA, old evidence cannot finish
the task. A changed control file or a write during a read-only review pauses the run.
New feature-specific tests are still required: the seeded smoke test only checks
basic rendering and view-mode interactions, not arbitrary future acceptance criteria.

## State, recovery, and budgets

- [MEMORY.md](../MEMORY.md): stack, task-scoped architectural contracts, UX notes,
  approval records, and short live logs. Never use another task's APPROVED marker.
- [factory.config.json](../factory.config.json): ten-second polling; ten-minute
  command/agent timeout; three repair attempts; 32 total stages; five generated
  descendants per original task; 200 board items; 40 agent invocations per UTC day.
- The 30-AI-credit per-stage limit is **soft**, not a hard monetary budget. The
  installed CLI can exceed it on the last response. Timeouts and invocation limits
  are independent. No billed calls occur when no enabled work is ready.
- The ignored `.factory` runtime directory holds a heartbeat, lock, pause/stop flags,
  daily invocation ledger, per-stage decisions/logs/context, verification evidence,
  and a write-ahead transaction journal. Logs are bounded per child process, but
  historical artifacts are retained; stop the factory before archiving old runs.
- The board and memory are replaced atomically per file under a short board lock.
  A journal repairs a crash between replacements; conflicting human edits stop
  recovery rather than being overwritten. Other backlog items may be appended
  while an agent works; conflicting edits to the active item are preserved.
- A repository-wide lock prevents two watchers. A crashed lock becomes eligible
  for recovery after 60 seconds, but a still-running recorded child must be inspected
  before restart. Never blindly delete locks or kill an unrelated PID.
- Stop preserves partial code edits and the active stage. Restart re-executes that
  stage; stages are counted before invocation so repeated crashes are bounded.
  Review diffs after an interruption. Protocol/infrastructure failures block the
  affected task and pause the watcher rather than consuming the entire backlog.
- Once a limit is reached, the task is Blocked or scheduling is paused. Requeue and
  budget resets require explicit operator action, not an agent-generated task.
  Follow-up bugs/issues/tasks stay local and share their original task's expansion cap.

The watcher survives closing its launch terminal, but not machine shutdown or sleep.
It does not install a Windows service or scheduled task. Restart it after reboot;
unattended startup can be configured separately by the machine owner.

## Trust and release boundary

This is **local orchestration**, not offline inference: Copilot still sends context
to its model service and consumes your account quota. CLI tool availability is limited
to local reading and, for the engineer, editing and selected npm/git-read commands.
It does not use blanket `--allow-all`, `--allow-all-tools`, or unrestricted path/URL
approval. Custom/user MCP servers may still initialize under CLI configuration, but
their tools are not in the supervisor's available-tool list. Repository extensions
and workspace MCP auto-loading are disabled for supervised prompt runs.

Factory/profile/CI/test configuration and package manifests are protected during a
run. A necessary dependency or tooling change is a deliberate pause-and-review
operation, not an autonomous permission escalation. The factory doesn't commit,
push, deploy, create remote issues, change machine policy, or read secrets.

These controls are **not a security sandbox**: permitted source edits and npm tests
execute local code as your user. Use trusted backlog input, isolated worktrees or a
dedicated machine for risky code, and preserve/review local diffs. Tests and AI review
cannot guarantee defect-free, secure, production-ready software. Done means the
specified local quality gates and reviews passed; release remains a separate decision.