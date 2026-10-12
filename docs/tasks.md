# Daily R&D Sync — Implementation Tasks

This is the implementation checklist for [`plan.md`](plan.md). Complete tasks in order unless a task explicitly says it can proceed independently. Treat each acceptance criterion as required. Keep the Confluence page as a reference during rollout; the app scope is only Customer Commitments, Production Issues, and Release Management.

## Project decisions and shared requirements

- Frontend: React 19, Vite, TypeScript; backend: Node, Express, TypeScript; database: PostgreSQL. Keep the repo as a small monorepo by folders; do not add workspace tooling. Use MIT/Apache-compatible dependencies only.
- This phase implements the three daily-meeting boards. Model sections as boards so the deferred Confluence sections can be added later without rewriting board, row, drawer, history, or action-item components.
- Jira is read-only, using a single server-side browse-only service account. The app may write only app-owned notes and meeting coverage for commitments; it must never update Jira.
- Authentication is provider-based. Implement a development-only stub user now; keep OIDC as a future provider, without implementing real SSO in this phase.
- All mutable app records use UUID IDs, created/updated timestamps and actor IDs, and integer optimistic-lock versions. Use parameterized SQL, schema validation that rejects unknown request-body fields, sanitized rich text, escaped allow-list rendering, and no unsanitized `dangerouslySetInnerHTML`.
- Never commit credentials or put the Jira API token in `.env`, dotfiles, shell startup files, logs, or the database. Read Jira credentials from process environment. Jira requests use HTTPS with certificate verification enabled. Browser requests cannot choose arbitrary JQL, and browser responses never expose the Jira raw JSON cache.
- Shared visual language is mandatory; see **Task 2**. Every board must use the compact list plus right-side detail drawer pattern. Do not implement the primary board as a wide table.
- Keep UI keyboard accessible and meet AA contrast for body text. Color must never be the only state signal. Honor `prefers-reduced-motion`.

## Phase 1 — Foundation and design system

### Task 1 — Initialize the monorepo and local development entry point

Create the root Vite/React/TypeScript frontend, Express/TypeScript API, package scripts, Vite `/api` proxy to `localhost:3000`, TypeScript configuration, and `.gitignore`. `npm run dev` must start both frontend and API. Add `GET /api/health` returning a small JSON health response. Add `index.html` title `Daily R&D Sync | Check Point` and theme color `#151018`.

**Acceptance criteria**
- The project starts with one documented `npm run dev` command; Vite serves the frontend and proxies `/api` to Express.
- `GET /api/health` returns HTTP 200 and JSON indicating service health.
- `.env` is ignored from the first commit. No credentials or secret values are present in tracked files.
- Dependency choices comply with the MIT/Apache-only constraint.

### Task 2 — Build the Check Point visual foundation and responsive app shell

Copy the token block and relevant dark treatment from `/Users/noampo/PycharmProjects/SA2CostCalculator/src/styles.css` lines 366–484 into `src/styles/tokens.css`. Use these exact core tokens: `--surface: #1d1721`, `--surface-raised: #261c29`, `--surface-deep: #17121b`, `--line: #433044`, `--berry: #ee0c5d`, `--berry-light: #ff6c9f`, `--ink: #f2f2f2`, `--text-muted: #c4b8c3`, `--text-subtle: #a99ba9`, `--mono: Consolas, 'Courier New', monospace`, and page background `#100d13`. Add `--amber: #fcb117`, `--amber-soft: #ffd06a`, `--bronze: #bd8d5b`, `--green-soft: #7fa87f`, `--blue-soft: #78a9ce`, `--danger: #ff8d96`.

Copy `/Users/noampo/PycharmProjects/SA2CostCalculator/src/assets/check-point-logo-reversed.svg` to `src/assets/` unchanged. Build the global shell with a fixed 64px top bar, 5px berry top border, dark `#151018` bar, logo + `Daily R&D Sync` title, date pill, search input, presence placeholder, prominent Meeting Mode button, and user menu placeholder. Add the three board tabs with count badge and changed indicator placeholders, plus the summary strip placeholder. Use Arial/Helvetica for headings and numbers; use `var(--mono)` for technical identifiers, dates, counters, and small labels; apply tabular numerals to dynamic numbers. Use 8px card radii, 5–7px control radii, hairline `--line` borders, no heavy shadows, magenta focus rings, and no green/blue chrome. Build reusable styles/components based on `.summary-card`, `.component-group`, `.component-row`, `.component-trigger`, `.component-detail`, `.component-tooltip`, `.bar-track`, `.category-bar`, `.date-stamp`, `.unit-tag`, `.panel-note`, and `.estimate-status` from the reference project.

**Acceptance criteria**
- The shell is visually consistent with SA2CostCalculator’s dark surfaces, berry accent, typography, logo, and component treatment.
- Logo is used as-is and has not been recolored.
- The shell and navigation remain usable at 1280x720 and 1920x1080; no horizontal overflow is introduced by global chrome.
- Every control has visible keyboard focus. State pills always have text labels, not color alone.
- Reduced-motion preference disables animations and pulsing states.

### Task 3 — Add reusable board, row, drawer, and status primitives

Implement shared components for board headers, filter controls, grouped sections, compact one-line rows, right-side detail drawers, status/risk/severity pills, avatars, tooltip for truncated text, banners, empty states, action-item rows, and loading/error states. Make board-specific content composable without board-specific wide-table layouts.

**Acceptance criteria**
- Clicking a row opens its right-side detail drawer; expanded inline content can coexist with the drawer pattern where specified.
- Drawer is keyboard reachable, has an accessible name, closes with Escape, and returns focus to its triggering row.
- Truncated text shows its full value on hover and is also accessible to keyboard and assistive technology.
- Components support loading, empty, and recoverable error states without layout shifts that hide controls.

## Phase 2 — Database, API foundation, and authentication

### Task 4 — Add migrations, database access, and seed data

Configure PostgreSQL and `node-pg-migrate`. Implement numbered migrations for every table and index in the data model in `plan.md`: `person`, `reference_item`, `deployment`, `deployment_owner`, `rollout_step`, `production_issue`, `issue_scope`, `action_item`, `commitment_cache`, `commitment_note`, `jira_link`, `change_event`, `meeting`, `meeting_coverage`, `meeting_snapshot`, and `comment`. Include shared audit/version/lifecycle fields on main app-authored entities. Use foreign keys and cascading child deletes where specified; because `change_event` is polymorphic without an FK, cleanup must explicitly remove its events. Add a seed script for reference lists (regions/farms/clusters, release names, severity, and risk) and a handful of people.

Create indexes specified in the plan: deployment `(lifecycle, planned_start_date)`, action item `(parent_type, parent_id, sort_order)`, change event `(entity_type, entity_id, occurred_at DESC)`, rollout step `(deployment_id, sort_order)`. Add other indexes only when justified by implemented queries.

**Acceptance criteria**
- A clean database can be migrated and seeded from documented commands.
- Schema enforces valid enum-like values and required relationships where practical.
- Seed data is deterministic and contains enough deployments, issues, people, steps, and references to exercise every board state.
- Database helpers accept values separately from SQL text; no query uses string concatenation or interpolation for values.

### Task 5 — Implement request validation, error conventions, and audit writes

Create common Zod request schemas and Express error handling. Reject unknown body fields. Define consistent JSON error responses including validation errors and version conflicts. Implement one database-layer mutation helper that updates a row, increments its `version`, sets `updated_at`/`updated_by`, and writes corresponding `change_event` rows in the same transaction. Use it for all mutable entity updates so routes cannot omit history.

**Acceptance criteria**
- Every mutating route validates its body at the route boundary and rejects extra keys.
- SQL uses parameterized `pg` placeholders for all user-controlled values.
- Audit records capture entity type/id, field, old/new values, actor, and occurrence time for each changed field.
- Failed validation or failed transactions make no partial writes.

### Task 6 — Implement provider-based auth and role guards

Create `server/auth/index.ts` exporting `getUser(req)`, backed by `AUTH_PROVIDER`. Implement development `dev-stub`: a development-only `/api/dev/login` route sets a signed dev cookie and lets a developer select one of seeded users. Do not mount the route when `NODE_ENV === 'production'`. Add `requireUser` and `requireRole('meeting_lead')` middleware. Ensure the server refuses to boot in production when `AUTH_PROVIDER=dev-stub`. Keep a provider interface ready for a later OIDC implementation; OIDC itself is out of scope.

**Acceptance criteria**
- Unauthenticated protected API requests return 401; role-restricted requests without the role return 403.
- Dev login is unavailable in production, and production startup fails with the dev provider selected.
- All route handlers obtain the actor through the shared auth function, not route-specific identity parsing.
- Dev session cookie is signed and has an explicit expiry; production session settings for future OIDC are documented as httpOnly, Secure, SameSite=Lax.

## Phase 3 — Release Management core

### Task 7 — Implement deployment, rollout-step, and action-item APIs

Implement list/detail/create/update/done endpoints for deployments; list/detail/create/update/reorder endpoints for rollout steps; and create/update endpoints for action items. The deployment list accepts category, risk, state, owner, and free-text query filters. Detail returns steps, action items, change history, comments, and Jira links. Implement `POST /api/rollout-steps/reorder` with a validated ordered ID list scoped to one deployment. Every update carries the expected `version`; on stale version return HTTP 409 with the current server record and changed-field information. Enforce actor auth on all routes.

**Acceptance criteria**
- CRUD behavior matches the route contract in `plan.md`; no route can update Jira.
- Stale version never writes, returns 409 and current server state, and identifies fields changed since the client version.
- Step reorder rejects missing, duplicate, or foreign deployment step IDs.
- Deployment done transition sets lifecycle and `done_at`; invalid lifecycle transitions are rejected consistently.

### Task 8 — Build the Release Management board and rollout progress UI

Build the release board over seeded API data. Add the collapsed-by-default Ground rules panel with two columns containing exact guidance:
- Risks: Regression (functional / performance) · Stability (downtime / timeouts / retries / errors) · Service continuity.
- Deployment plan: Graduality · Consider the region's local time · Variety: brands, customer size.

Add filter bar for Infrastructure/Application category, High/Medium/Low risk, owner, state, “today only,” and free text. Reflect filters in URL query parameters and restore them from a bookmarked URL. Group rows as In rollout, Planned today, Planned later, QA / Pending, Closed yesterday. Each compact row shows release name, mono version, one-line content summary, risk pill, owner avatars, mono planned date, segmented rollout progress, `N/total clusters` counter, and QA verified badge when applicable. Use one segment per rollout step: done soft green, in progress amber with subtle pulse, pending `#38283a`, failed magenta, skipped outlined. Hover/focus on a segment identifies its step. Compute progress using cluster counts where present and step states otherwise; never parse cluster progress from prose.

Inline expansion displays ordered rollout steps with drag handle, step label, state control, date, note, and optional cluster counts. State changes update the server. Drawer displays rich-text content, risk notes, rollback plan, QA flag/date/link, linked Jira keys with cached live status, Confluence rollout-schedule URL, action items, history timeline, and comments. Include `qa_verified` green badge and allow setting its date/link through the deployment editor.

**Acceptance criteria**
- No wide table; each row remains a compact readable line, with overflow detail in drawer/inline expansion.
- Every planned filter is usable, reflected in URL, and can be restored on refresh.
- Rollout bar and counter recalculate after step state or cluster count updates; step tooltip works with pointer and keyboard.
- In-progress pulse becomes static with reduced motion enabled.
- UI matches the shared tokens and patterns in Task 2 and remains readable at 1280x720 and 1920x1080.

### Task 9 — Implement release create/edit and optimistic conflict experience

Add deployment editor and step/action-item editing. Validate required fields and types in both client and API. On edit start, broadcast an advisory lock through the realtime service once available (Task 14); until then, keep the editor interface ready for lock state. On a 409, show a non-destructive conflict banner inside the drawer identifying the editor and differing fields, with **Keep mine**, **Take theirs**, and **Merge** actions for those fields. Never silently discard local edits.

**Acceptance criteria**
- User can create and edit deployments, owners, rollout steps, action items, QA metadata, notes, and rollback details.
- Version is included in every update; conflict resolution sends a fresh version and the user's selected field values.
- Rich text is sanitized on write and rendered from escaped, allow-listed content.
- The UI gives a recoverable error if save fails and preserves unsaved form data.

## Phase 4 — Production Issues

### Task 10 — Implement production issue APIs and lifecycle fields

Implement filtered issue list, issue detail/create/update/done endpoints, typed scope joins to `reference_item`, and action item support shared with deployments. Issue detail returns description, status history, RCA URL, related deployment links, action items, comments, and owners derived from action items. Accept status, severity, scope, and text filters.

**Acceptance criteria**
- Issue scope values are managed reference IDs and can be filtered; arbitrary display text is not used as the canonical scope.
- Action items support owner, state, ETA, optional Jira key, and stable order.
- Issue updates obey version locking and create audit events.
- Mark done uses the shared lifecycle and timestamp behavior.

### Task 11 — Build the Production Issues board

Render three collapsible groups, in this order: Open, Monitoring, Closed yesterday. Sort within groups by severity then age. Each compact row shows a 4px severity stripe (critical berry, high amber, medium/low muted blue), severity text/letter, title, status pill (Investigation, In progress, Monitoring, Resolved), scope chips, customer impact, age, action-item completion count and thin progress bar, and overlapping action-item-owner avatars. Customer impact is amber when non-empty. Inline expansion shows action items with checkbox-style state control, text, owner, optional Jira chip, and optional ETA. Any attendee with app access can update an action item. Drawer shows description, status timeline with actor/time/from/to, RCA link, related deployments, full action-item editor, and comment thread.

**Acceptance criteria**
- Open, Monitoring, Closed yesterday groups appear in the specified order and can collapse independently.
- Severity is understandable without color; scope chips are filterable and use mono styling.
- Action-item count/progress updates immediately after an item is changed.
- Row and drawer follow the compact-list/shared-design system; keyboard users can expand and update items.

## Phase 5 — Summary, lifecycle, realtime, and board navigation

### Task 12 — Implement global summary, tabs, search, and date navigation

Implement `GET /api/boards/summary` and global board navigation. Summary cards are: Deployments today (planned start date = current meeting date), In rollout (deployment has at least one in-progress step), Open prod issues (not done, with High/Medium/Low split), Commitments at risk (Jira due date past or within 7 days and not done), Closed yesterday (rows completed within prior 24 hours). Clicking a card applies its corresponding board filter. Highlight the single most urgent card with featured berry left border. Board tabs show active row counts and a berry changed-since-last-look dot. Add fuzzy global search across titles, owners, Jira keys, and cluster names. Date pill opens date picker for a past meeting snapshot in read-only mode.

**Acceptance criteria**
- Counts use the meeting date/time zone consistently and match underlying board data.
- Each metric card applies the specified filter; opening a past date uses its saved snapshot and cannot mutate live rows.
- Search can find records by each specified searchable field and navigates to the corresponding board/row.
- The summary strip uses `.summary-card` styling and remains horizontally usable on supported meeting displays.

### Task 13 — Implement done/archive lifecycle and nightly retention jobs

Implement lifecycle transitions `active -> done -> archived`. Mark done sets `done_at`; rows stay visible in Closed yesterday for 24 hours. Nightly archive job sets `archived_at` and hides rows from daily boards once `done_at` is older than 24 hours. Nightly retention cleanup deletes all app-authored data 365 days after `archived_at`, including children and polymorphic audit/comment/meeting references as appropriate. No manual hard-delete endpoint or UI is allowed. Jira cache has separate policy: mark commitment cache stale after 15 minutes; remove keys seven days after they stop matching configured JQL; Jira-linked cached fields refresh every five minutes and cascade with their parent where applicable.

Add a Settings-configurable archive delay defaulting to 24 hours. Use a single documented time-zone/cutoff rule and ensure the exact-boundary behavior is deterministic.

**Acceptance criteria**
- Done rows have a timestamp and appear green/closed for the full 24-hour period, then archive.
- Archive job moves only rows strictly beyond the configured cutoff; cleanup removes only rows whose `archived_at` is strictly more than 365 days old, using the explicitly documented equality rule.
- Child rows and `change_event` rows do not remain orphaned after retention cleanup.
- No regular user action can permanently delete app-authored data.
- Stale Jira data remains visible with its last sync time rather than being replaced by an empty board.

### Task 14 — Implement Server-Sent Events, presence, and edit advisories

Implement `GET /api/stream` as an authenticated Server-Sent Events endpoint. Push row-changed events, presence updates, and soft-lock advisory events when users open/close an edit form. Broadcast which user is editing which row; do not block edits or leave persistent locks. Open boards patch changed rows in place and briefly highlight them. Presence cluster displays circular attendee avatars; active editor has berry ring. Rows under active edit show berry ring and “{name} is editing”.

**Acceptance criteria**
- Two signed-in browser sessions see presence changes and row updates without manual reload.
- Editing advisories clear on editor close or disconnect/heartbeat expiry and never prevent a save.
- SSE handles reconnects and cleans up disconnected clients; authentication is checked before stream setup.
- Row-change highlight respects reduced-motion preference.

## Phase 6 — Jira commitments

### Task 15 — Implement secure read-only Jira client and sync job

Create a server-only Jira interface whose current provider exposes GET operations only. Use `JIRA_BASE_URL`, `JIRA_ACCOUNT_EMAIL`, and `JIRA_API_TOKEN` from process environment; require HTTPS and leave certificate validation enabled. Never log credentials or sensitive Jira response data. JQL is configured server-side by an authorized admin and cannot be supplied by the browser. Initial commitments JQL mirrors Jira dashboard 10763 and is configurable in settings. Every five minutes and on demand: query the configured JQL and upsert only required fields into `commitment_cache`; then collect linked Jira keys from `jira_link` and `action_item`, batch-fetch their status/assignee, and update cached link fields. Store raw response only in DB and never send it to frontend. Surface failures with last good sync timestamp and a banner.

**Acceptance criteria**
- Jira client has no write methods and uses HTTPS with normal certificate verification.
- Browser cannot change JQL or access raw cached Jira response.
- Sync updates only the declared commitment and Jira-link fields; failed sync preserves last-good cache and records failure status.
- Sync interval is five minutes; Settings can trigger immediate sync.
- Missing credentials/configuration produces an actionable server-side status without printing secret values.
- Document the prerequisite for a Jira admin to provision a browse-only service account and inject its token into the development shell only.

### Task 16 — Build the Customer Commitments board and note workflow

Implement `GET /api/commitments` from `commitment_cache` and app-side note/discussion endpoints keyed by Jira key. Do not expose any Jira-ticket write endpoint. Group rows by commitment date: Overdue, This week, Next 2 weeks, Later; groups collapse and show counts. Row shows customer name, Jira key chip linking to Jira, one-line truncated summary with full tooltip, owner avatar/name, Jira status pill mapped from Jira category to app palette, mono committed date (red-tinted overdue), Add note affordance, and Discussed today toggle. Store notes and discussion records in the app; associate Discussed today with meeting coverage/date so each meeting is historically accurate. Drawer shows rendered full Jira description, last five Jira comments read-only, linked issues, app-side note history, and meeting discussion dates. Empty state text: “No open customer commitments. The Jira query returned 0 rows - last checked {time}.” with Refresh button.

**Acceptance criteria**
- Jira-sourced fields cannot be edited in this board; only app notes and discussed coverage can be changed.
- Groups and overdue treatment use due date consistently; status category maps to readable labeled pills.
- Empty state includes last checked time and triggers on-demand sync via Refresh.
- Jira descriptions/comments are rendered safely; no raw JSON or unsanitized HTML reaches the browser.

## Phase 7 — Meeting Mode and snapshots

### Task 17 — Implement meeting records, coverage, agenda ordering, and snapshot APIs

Implement today meeting start/end, coverage, and snapshot endpoints. `requireRole('meeting_lead')` guards starting/ending meetings and other meeting-lead controls. Agenda order: changed since last meeting first, then overdue/at-risk, then in-rollout, then remaining rows; covered rows go to bottom and dim. Coverage is recorded with meeting date/time and row identity. On exit, save a frozen snapshot of which rows existed, their state, and coverage. Past snapshots are read-only.

**Acceptance criteria**
- Meeting start/end and coverage are actor-attributed and validate board/entity IDs.
- Agenda ordering is deterministic when priorities tie and follows the exact priority groups above.
- Snapshot data is sufficient to replay the board state and coverage for that date without depending on current mutable records.
- Past snapshot endpoints are read-only.

### Task 18 — Build screen-share Meeting Mode

Implement the Meeting Mode view. Hide/collapse sidebar and filters; increase type sizes by approximately 20%; show one current row full-width and expanded with action items/rollout steps, with a slim left navigator and berry marker on current item. Add “Since yesterday” panel listing every rollout step whose state changed in prior 24h, grouped by release. Show covered tick per row and meeting date. Show progress exactly as `{covered} / {total} items covered · HH:MM:SS elapsed`.

Keyboard controls: `J`/Down next, `K`/Up previous, Space expand/collapse, `D` mark done, `C` mark covered today, Escape exit. Ignore these shortcuts while focus is in a text input, textarea, select, or editable content. On exit, persist meeting snapshot.

**Acceptance criteria**
- All specified keyboard controls work and do not hijack form typing; Escape exits reliably.
- Current row is visually distinct and readable at 1280x720 and 1920x1080.
- Covered items dim and sort to bottom; progress/time update during the meeting.
- Since yesterday includes every qualifying rollout-step transition exactly once and groups steps by release.
- Exiting saves a snapshot and returning to a prior date renders that snapshot in read-only mode.

## Phase 8 — History, Settings, migration, and cutover

### Task 19 — Build History and per-release deployment log

Implement `/history` with filters for board, owner, date range, and free text; show results in a timeline. Archived rows open in the shared drawer in read-only mode. Add a per-release timeline of every recorded rollout step for the release name. History covers the rolling retention window of one year.

**Acceptance criteria**
- Each filter can be combined and reflected in URL parameters.
- Archived row detail is read-only and includes available history.
- Per-release timeline shows ordered rollout events, date/state/scope and any recorded cluster counts.
- Records older than retention are absent after cleanup.

### Task 20 — Build admin Settings

Implement authorized Settings UI and endpoints for Jira connection status, server-side JQL, five-minute sync interval display, last sync outcome, managed reference lists (regions/farms/clusters, release names, severity, risk), and archive delay (24h default). Protect mutations with admin role. Do not expose service credentials; show only whether required variables are configured. Defer role mapping for SSO to the future OIDC phase.

**Acceptance criteria**
- Non-admin cannot read sensitive configuration or mutate settings.
- JQL can only be changed by an admin through server validation and never arrives from normal board requests.
- Reference list entries can be added/edited/activated/deactivated with audit trail and are consumed by corresponding filters/chips.
- Jira token and account secret are never returned by settings API or included in logs/UI.

### Task 21 — Import current Confluence meeting content

Write a one-off, repeatable migration script that parses the current Confluence page body into deployment, rollout step, production issue, and action item records. Keep the parser isolated from request-serving code. Since prose mixes state, dates, and region lists, import best-effort values and preserve source text where mapping is uncertain; do not invent data. Produce a review report with source row, parsed entity, unmapped/ambiguous fields, and counts. Provide a safe preview/dry-run and an explicit apply mode that avoids duplicate imports on rerun. Do not import the slower backlog sections.

**Acceptance criteria**
- Preview mode performs no database writes; apply mode is repeat-safe using stable source identifiers or a migration ledger.
- Report includes row/title counts and every ambiguous/unmapped field for owner review.
- Import only the three in-scope sections and preserve relevant content without executing source HTML.
- Owners can correct imported rows through the app during the first week; Confluence remains read-only reference for one sprint.

### Task 22 — Prepare one-week parallel operation and cutover

Document and execute a one-week period where app and Confluence are both available, but the Confluence page carries only a banner linking to the app. Verify imported row counts and titles against the source and have 2–3 owners confirm their rows. Resolve data discrepancies. After the week, freeze the Confluence page as read-only. Keep a rollback note with the app URL, last verified import, and the process to resume Confluence if a cutover blocker appears.

**Acceptance criteria**
- App is the active meeting tool during the parallel period and users have a clear link from Confluence.
- Data comparison and owner confirmations are recorded before page freeze.
- Confluence is frozen only after the parallel period and discrepancy resolution.
- Cutover/rollback steps and operational owner are documented.

## Verification and release gates

### Task 23 — Add required unit and API/concurrency tests

Use `node --test` to cover: rollout progress from `clusters_done`/`clusters_total` and step states; meeting agenda ordering; archive cutoff; 365-day retention cutoff from `archived_at`; lifecycle transitions; Jira field mapping. Add API tests against throwaway PostgreSQL for route happy paths, unauthenticated rejection, stale-version 409/no write, done timestamp, archive cutoff, retention cleanup/cascades/no orphan events or steps. Add concurrency test: two clients read the same deployment; updates with same version produce one success and one 409, with no lost field. Repeat on same field and assert conflict names that field. Add SQL-safety check that disallows template-literal interpolation in `server/db`.

**Acceptance criteria**
- Tests run from documented commands and use an isolated test database.
- Exact cutoff boundaries are tested, including equality behavior documented in Task 13.
- Tests prove failed conflict requests do not mutate row or audit state.
- SQL safety check runs in CI or as a documented test command.

### Task 24 — Perform manual, visual, security, and data acceptance checks

Run the app with `npm run dev`. In two browser windows, sign in as different stub users and edit different rows, then the same row; verify presence, live updates, advisory editing rings, and conflict resolution. Run Meeting Mode on a shared screen at 1920x1080 and 1280x720. Compare the app and SA2CostCalculator side-by-side for color, surfaces, mono treatment, and component styling. Verify keyboard-only use, AA body text contrast, reduced motion, safe rich-text rendering, production rejection of dev auth, no secret logging, no client-controlled JQL, and no Jira writes. After import, compare counts/titles and obtain 2–3 owner confirmations.

**Acceptance criteria**
- All manual scenarios above are recorded with pass/fail and follow-up issues.
- Visual check confirms the same design family without unreadable or clipped meeting content.
- Security checks confirm parameterized SQL, request validation, sanitized rich text, HTTPS Jira calls, and secrets confined to environment injection.
- Data acceptance check is complete before cutover.

## Deferred scope

- OIDC/Check Point SSO implementation and role mapping.
- Boards for Certificates, New Regions/Farms, Features & Application, Hot Topics - Infrastructure, and Cost Reduction. Preserve the generic board, action-item, audit, and drawer architecture so these can be added later without schema or UI rewrites where practical.
- Jira write access, per-user Jira OAuth, and replacing the Confluence rollout schedule with duplicated app content.
