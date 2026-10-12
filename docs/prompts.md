# Daily R&D Sync — Ready-to-Run Implementation Prompts

Each prompt below is independently copyable. Run tasks in the order in [`tasks.md`](tasks.md), since later work depends on earlier foundations. Every prompt tells the agent to read [`plan.md`](plan.md), locate its numbered task in `docs/tasks.md`, implement that scope, and verify its acceptance criteria. Do not paste the full plan into the prompt: the agent should read the workspace files directly to reduce duplicated context and keep task boundaries clear.

## Model and effort recommendations

Recommendations reflect current provider model lineups at the time this file was written. Availability and effort labels vary by product and account; if a model is unavailable in the selected coding agent, use the closest current coding-capable model from that provider at the same effort level.

- **GPT default:** GPT-6.1 Sol. Use `medium` for bounded implementation and `high` for security-sensitive, data-model, concurrency, or multi-surface work. Use `xhigh` only if a task proves unusually difficult after normal inspection; do not spend extra reasoning by default.
- **Claude default:** Claude Sonnet 5.5. Use `medium` for bounded work and `high` for security-sensitive, data-model, concurrency, or multi-surface work. Use Claude Opus 5.5 for the most demanding long-horizon tasks (Tasks 13, 15, 17, 21, 23) when available; effort `high`.
- GPT effort labels and Claude effort labels are provider settings, not prompt text. GPT-6.1 Sol exposes low/medium/high/xhigh/max/ultra in the Codex model selection surface; Claude current models use adaptive thinking with effort controls. These recommendations favor the lowest effort likely to meet the task's quality bar.

Current model references: [GPT-6.1 Sol and reasoning effort](https://developers.openai.com/api/docs/guides/reasoning), [Claude models overview](https://platform.claude.com/docs/en/models/overview), and [Claude effort levels](https://platform.claude.com/docs/en/build-with-claude/effort).

## Task 1 — Initialize the monorepo and local development entry point

**Recommended:** GPT-6.1 Sol · medium. **Claude alternative:** Claude Sonnet 5.5 · medium.

```text
Implement Task 1, “Initialize the monorepo and local development entry point,” from docs/tasks.md. First read docs/plan.md and that exact task, then inspect the repository and any existing instructions. Treat the task acceptance criteria and the plan’s stack/security/dependency decisions as required. Build only the foundation needed for this task: React/Vite/TypeScript frontend, Express/TypeScript API, root scripts, API proxy, health endpoint, index metadata, and ignore/config files. Keep the monorepo folder-based, use only MIT/Apache-compatible dependencies, and never add secrets. Preserve existing user changes. Run the narrowest useful startup and health checks; do not add features from later tasks. Finish with a concise summary of files changed, checks run/results, and any blocker.
```

## Task 2 — Build the Check Point visual foundation and responsive app shell

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 2, “Build the Check Point visual foundation and responsive app shell,” from docs/tasks.md. Read docs/plan.md, the exact task and its styling section, then inspect the reference project's specified CSS/logo and the current app. Match the exact tokens, logo usage, top bar dimensions/content, tabs, summary placeholders, typography, focus treatment, reduced-motion behavior, and responsive requirements in the task. Reuse reference patterns; do not invent a different theme or build later board features. Keep the logo unchanged and avoid unrelated edits. Check the rendered UI at 1280x720 and 1920x1080 if browser preview tools are available; otherwise report the validation limitation. Report changed files and evidence briefly.
```

## Task 3 — Add reusable board, row, drawer, and status primitives

**Recommended:** GPT-6.1 Sol · medium. **Claude alternative:** Claude Sonnet 5.5 · medium.

```text
Implement Task 3, “Add reusable board, row, drawer, and status primitives,” from docs/tasks.md. Read docs/plan.md and the exact task, then inspect the shell and existing components. Create only reusable primitives needed by the three boards: compact grouped rows, filters, right drawer, pills, avatars, accessible truncation tooltip, banners, empty/loading/error states, and action-item row. Follow Task 2 tokens and keyboard/accessibility behavior. Keep board content composable; do not create a wide table or implement board-specific business logic. Verify focus, Escape close, focus return, and loading/empty/error rendering with the existing project workflow. Summarize changes and checks.
```

## Task 4 — Add migrations, database access, and seed data

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 4, “Add migrations, database access, and seed data,” from docs/tasks.md. Read docs/plan.md and the exact task before changing files. Inspect Task 1's setup and existing database conventions. Create the specified PostgreSQL schema, indexes, migration tooling, safe parameterized query helpers, deterministic seed data, and documented migrate/seed commands. Include every listed entity and required relationship/audit/version/lifecycle fields; keep polymorphic change_event cleanup considerations explicit. Do not add speculative schema fields or credentials. Use only approved dependency licenses. Run migrations and seeding against a disposable/local development database only if configured; never reset or modify a user's valuable database. Report schema decisions, checks, and any environment limitation.
```

## Task 5 — Implement request validation, error conventions, and audit writes

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 5, “Implement request validation, error conventions, and audit writes,” from docs/tasks.md. Read docs/plan.md and the exact task, then inspect current routes, DB helpers, and schema. Add strict Zod boundary validation with unknown-key rejection, consistent JSON errors, and one transactional mutation helper that performs version/audit metadata updates and per-field change_event writes atomically. Ensure every SQL value is parameterized and failed validation/transactions cannot partially write. Keep scope to shared infrastructure; adapt existing routes only as needed to use it. Perform a focused correctness and security review, then run relevant existing checks. Report coverage and any routes that remain to be migrated in later tasks.
```

## Task 6 — Implement provider-based auth and role guards

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 6, “Implement provider-based auth and role guards,” from docs/tasks.md. Read docs/plan.md and the exact task, then inspect the server setup and person seed model. Implement the AUTH_PROVIDER interface, development-only signed stub cookie/login, requireUser and requireRole middleware, and production boot refusal when dev-stub is selected. Keep OIDC out of scope; document its planned cookie properties only. Ensure dev login is not mounted in production, actor identity always comes through getUser, and cookies have a clear expiry. Never log secrets or create hard-coded signing credentials. Review auth/authorization edge cases and run relevant checks. Summarize behavior and verification.
```

## Task 7 — Implement deployment, rollout-step, and action-item APIs

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 7, “Implement deployment, rollout-step, and action-item APIs,” from docs/tasks.md. Read docs/plan.md and the exact task; inspect the database, validation, audit, and auth foundations first. Implement the specified deployment/step/action-item routes, filters, detail payload, done transition, and reorder operation. Every write must authenticate, validate strictly, use parameterized SQL, use optimistic version checks, and write audit events transactionally. A stale version must return 409 with current state and changed fields without mutation. Reorder must be restricted to the specified deployment and reject incomplete/duplicate/foreign IDs. Do not add Jira writes. Verify route contracts with existing test/check infrastructure and report gaps.
```

## Task 8 — Build the Release Management board and rollout progress UI

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 8, “Build the Release Management board and rollout progress UI,” from docs/tasks.md. Read docs/plan.md (especially Release Management and Styling) and the exact task; inspect shared components and API contracts. Build the seeded-data board with the exact Ground rules copy, filters encoded/restored in the URL, specified groups and row fields, segmented step-state bar, cluster-count calculation, inline step list/reordering, and complete read-only detail drawer. Preserve the compact row + drawer design, shared tokens, accessible segment tooltip, QA badge, and reduced-motion pulse behavior. Do not implement editing beyond state updates/reorder explicitly required here or expand into other boards. Validate layout at both stated resolutions if preview is available. Report checks and remaining integration dependencies.
```

## Task 9 — Implement release create/edit and optimistic conflict experience

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 9, “Implement release create/edit and optimistic conflict experience,” from docs/tasks.md. Read docs/plan.md and the exact task, then inspect Task 7 APIs, Task 8 drawer, validation, audit, and SSE status. Add deployment, owner, rollout-step, action-item, QA, risk, and rollback editing with client/server validation and versioned writes. Implement the drawer conflict banner with Keep mine, Take theirs, and Merge for fields that differ; never drop unsaved values silently. Connect edit advisories if Task 14 exists, otherwise keep a minimal integration seam without creating a second realtime implementation. Sanitize rich text at write and render boundaries. Review conflict and injection edge cases; run relevant checks and report results.
```

## Task 10 — Implement production issue APIs and lifecycle fields

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 10, “Implement production issue APIs and lifecycle fields,” from docs/tasks.md. Read docs/plan.md and the exact task; inspect schema, shared action-item routes, validation, auth, optimistic locking, and audit helper. Add issue list/detail/create/update/done APIs with typed reference scopes, status/severity/scope/text filters, related deployment links, and required detail fields. Reuse shared action-item and lifecycle behavior instead of duplicating it. Enforce strict body schemas, parameterized SQL, actor attribution, version conflicts, and audit events. Do not build the board UI in this task. Run relevant checks and summarize endpoints and results.
```

## Task 11 — Build the Production Issues board

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 11, “Build the Production Issues board,” from docs/tasks.md. Read docs/plan.md (Production Issues and Styling) and the exact task; inspect shared board/drawer/action-item components and Task 10 API contracts. Render Open, Monitoring, Closed yesterday in the required order, with severity/age sorting and every specified row field, stripe/color/text encoding, scope chips, impact, age, progress, and owner avatars. Inline expansion must expose actionable action items; drawer must show the full issue timeline, RCA, related releases, editor, and comments. Keep rows compact, accessible, keyboard operable, and styled with shared tokens. Do not rebuild shared primitives or add other boards. Validate the key states and report checks.
```

## Task 12 — Implement global summary, tabs, search, and date navigation

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 12, “Implement global summary, tabs, search, and date navigation,” from docs/tasks.md. Read docs/plan.md and the exact task; inspect existing board routes, meeting snapshots, date helpers, and app shell. Implement the summary endpoint and five exact metric definitions, clickable filter application, urgent-card treatment, active counts/change dots, fuzzy global search over the specified fields, and date-picker navigation to read-only snapshots. Use one explicit meeting-date/time-zone rule consistently and avoid mixing current live data into past snapshots. Keep the existing visual system and make search navigate to the correct record. Verify calculations and URL/navigation behavior with relevant checks; report any unresolved definition conflict instead of inventing behavior.
```

## Task 13 — Implement done/archive lifecycle and nightly retention jobs

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 13, “Implement done/archive lifecycle and nightly retention jobs,” from docs/tasks.md. Read docs/plan.md (Lifecycle and Data retention/TTL) and the exact task; inspect lifecycle schema, routes, settings, and job conventions. Implement active→done→archived behavior, the configurable 24-hour archive cutoff, nightly 365-day cleanup from archived_at, child/event cleanup, and the distinct Jira-cache stale/expiry rules. Follow the task's exact equality boundaries and document them once so jobs and tests agree. Use transactions and safe deletion ordering; do not add manual hard delete. Ensure no orphan child/audit rows, no accidental Jira-cache coupling, and no non-deterministic timezone comparisons. Run targeted checks and report cutoff semantics and limitations.
```

## Task 14 — Implement Server-Sent Events, presence, and edit advisories

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 14, “Implement Server-Sent Events, presence, and edit advisories,” from docs/tasks.md. Read docs/plan.md (concurrency section) and the exact task; inspect auth, mutation events, app state, and editor lifecycle. Implement authenticated SSE for row changes, presence, and non-blocking edit advisories; handle reconnect/disconnect cleanup and advisory expiry. Patch open boards in place and show the specified editor rings/name plus brief change highlight. Do not introduce WebSockets or blocking locks. Ensure event payloads expose only fields needed by the UI and never leak secrets or raw Jira data. Honor reduced motion. Verify with two sessions if available; otherwise test the event path and state the manual limitation.
```

## Task 15 — Implement secure read-only Jira client and sync job

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 15, “Implement secure read-only Jira client and sync job,” from docs/tasks.md. Read docs/plan.md (Jira access, Jira sync, credentials, retention) and the exact task; inspect server config, settings, schema, and jobs. Build a server-only GET-only Jira client, environment-only credentials, HTTPS with certificate checks enabled, server-controlled JQL, five-minute/on-demand cache sync, linked-key batch refresh, and last-good-data failure reporting. Return only declared display fields; keep raw response server-side. Never log or persist credentials, accept browser JQL, or add Jira write methods. Handle missing config safely. Perform a focused security review and use mocks or a safe test configuration; never call Jira with guessed credentials. Report sync behavior and verification.
```

## Task 16 — Build the Customer Commitments board and note workflow

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 16, “Build the Customer Commitments board and note workflow,” from docs/tasks.md. Read docs/plan.md (Customer Commitments/Jira access) and the exact task; inspect the cache API and shared UI. Build the specified date groups, row fields, status/overdue treatments, tooltip, note workflow, meeting-date Discussed today toggle, read-only Jira detail, note/discussion history, and exact empty/refresh state. Jira-sourced fields remain read-only; do not add Jira mutation capability or expose raw JSON. Render Jira descriptions safely and show only the last five cached comments. Keep the compact board/drawer design and shared styling. Verify grouping, empty state, permissions, and note history; report any Jira data field absent from the current API.
```

## Task 17 — Implement meeting records, coverage, agenda ordering, and snapshot APIs

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 17, “Implement meeting records, coverage, agenda ordering, and snapshot APIs,” from docs/tasks.md. Read docs/plan.md (Meeting Mode and data model) and the exact task; inspect auth roles, event history, lifecycle, and board APIs. Implement start/end, coverage, agenda ordering, and immutable replay snapshots with actor attribution and meeting_lead guards where specified. Agenda priority must exactly follow changed-since-last-meeting, overdue/at-risk, in-rollout, remaining, then covered at bottom; define deterministic tie-breaking. Snapshot sufficient board state and coverage at exit so later replay does not depend on mutable live rows. Validate entity ownership and past-date read-only behavior. Use transactional, parameterized writes; run focused checks and report ordering/snapshot shape.
```

## Task 18 — Build screen-share Meeting Mode

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 18, “Build screen-share Meeting Mode,” from docs/tasks.md. Read docs/plan.md (Meeting Mode) and the exact task; inspect snapshot/coverage APIs and existing boards. Implement the presentation layout, approximately 20% larger type, one expanded current item, slim navigator/berry marker, Since yesterday rollout transitions, covered state, elapsed/progress indicator, and exact keyboard mappings. Ignore shortcuts in editable controls, ensure Escape exits, and persist a snapshot on exit. Covered items dim and fall to the bottom. Preserve each board's expanded action items/rollout steps and follow the established theme. Check at 1280x720 and 1920x1080 where possible; report keyboard and snapshot verification.
```

## Task 19 — Build History and per-release deployment log

**Recommended:** GPT-6.1 Sol · medium. **Claude alternative:** Claude Sonnet 5.5 · medium.

```text
Implement Task 19, “Build History and per-release deployment log,” from docs/tasks.md. Read docs/plan.md (History/Archive and retention) and the exact task; inspect history/event APIs, shared drawer, and route conventions. Build /history with combinable board/owner/date/text filters reflected in URL, timeline results, read-only archived drawers, and a per-release rollout timeline within the one-year retention window. Do not add editing or change retention behavior. Reuse current components and keep the interface compact and accessible. Verify combined filters, deep links, and read-only controls; summarize results.
```

## Task 20 — Build admin Settings

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 20, “Build admin Settings,” from docs/tasks.md. Read docs/plan.md (Settings, Jira access, auth) and the exact task; inspect role middleware, config handling, reference data, audit, and sync job. Build authorized settings APIs/UI for Jira connection status, server-side JQL, displayed sync cadence/outcome, reference lists, and archive delay. Admin-only mutations must be validated/audited; secrets are never returned or displayed, only configured/not configured. Normal board requests cannot submit JQL. Do not implement OIDC role mapping. Review information disclosure and authorization boundaries, run focused checks, and report them.
```

## Task 21 — Import current Confluence meeting content

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 21, “Import current Confluence meeting content,” from docs/tasks.md. Read docs/plan.md (migration/cutover) and the exact task; inspect available source format/API access, target schema, and existing scripts. Build an isolated repeat-safe importer with dry-run preview and explicit apply mode for only the three in-scope sections. Preserve source text for uncertain mappings, never invent values, never execute imported HTML, and produce a report of source rows, parsed entities, ambiguous/unmapped fields, and counts. Use stable source IDs or a migration ledger to prevent duplicate imports. Do not fetch/write external Confluence content unless access and credentials are already configured and the operation is authorized; otherwise implement against a supplied export/fixture and document the input contract. Test dry-run non-mutation and idempotency using fixtures or a disposable DB. Report exactly what was imported or could not be accessed.
```

## Task 22 — Prepare one-week parallel operation and cutover

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 22, “Prepare one-week parallel operation and cutover,” from docs/tasks.md. Read docs/plan.md and the exact task. First inspect available deployment/runbook/docs conventions and current import verification evidence. Prepare the parallel-run checklist, comparison record template, owner confirmation checklist, rollback note, and cutover steps with a named operational-owner placeholder only if no owner is known. Do not edit Confluence, publish a banner, freeze a page, or declare the cutover complete without explicit authorization and confirmed evidence. Make all preparatory documentation concrete and actionable, and clearly identify uncompleted time-dependent steps. Report artifacts created and remaining approvals/evidence.
```

## Task 23 — Add required unit and API/concurrency tests

**Recommended:** GPT-6.1 Sol · high. **Claude alternative:** Claude Opus 5.5 · high.

```text
Implement Task 23, “Add required unit and API/concurrency tests,” from docs/tasks.md. Read docs/plan.md and the exact task; inspect the existing test setup and implementations. Add the specified node:test coverage for rollout computation, agenda ordering, exact archive/retention boundaries, lifecycle transitions, Jira field mapping, API happy paths/auth/version conflicts/done/archive/cleanup, and both concurrency cases. Use only an isolated throwaway PostgreSQL database; never reset a configured user database. Add the SQL interpolation safety check. Assert conflict requests do not mutate data/audit state and cleanup leaves no orphan children/events. Run the documented test commands and fix failures within this scope. Report exact commands and outcomes; do not claim unrun tests passed.
```

## Task 24 — Perform manual, visual, security, and data acceptance checks

**Recommended:** GPT-6.1 Sol · medium. **Claude alternative:** Claude Sonnet 5.5 · medium.

```text
Perform Task 24, “Perform manual, visual, security, and data acceptance checks,” from docs/tasks.md. Read docs/plan.md and the exact task, then inspect the running app, test evidence, and available browser/UI tools. Execute the listed two-user concurrency/presence scenarios, Meeting Mode at both resolutions, side-by-side reference styling review, keyboard/accessibility/reduced-motion checks, rich-text/security checks, auth/JQL/Jira-write checks, and post-import counts/title/owner confirmations where access permits. Do not modify external Confluence or Jira systems. Record each check as pass, fail, or blocked with concise evidence and file any concrete defects found in the repository. Never claim visual/manual checks that you did not perform. Finish with the acceptance record and unresolved blockers.
```

## Prompt quality rules

The prompts deliberately direct the implementing agent to read the source plan and exact numbered task in the workspace, instead of duplicating long specification text. Each prompt also keeps implementation scoped, asks the agent to preserve unrelated work, and requires truthful reporting of verification. Task 22 and Task 24 explicitly separate preparation/verification from external publishing or freeze actions.
