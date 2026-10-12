# Daily R&D Sync - Release Management Web App

## Context

The team runs a daily R&D sync for ~70 developers. All team leaders and group managers join with the R&D manager. Today the meeting is driven from one Confluence page: [Meeting notes - Daily R&D Sync](https://avanan.atlassian.net/wiki/spaces/RD/pages/4301193217/Meeting+notes+-+Daily+R+D+Sync).

The flow today: before the meeting each owner edits "their" row in a big Confluence table. During the meeting the R&D manager shares the screen and walks row by row, asking for status.

Real problems with that page:

1. **Too noisy.** The tables have 7+ columns, the columns are narrow, there is no real styling, and a 26-row deployment table is a wall of text.
2. **Closing items is manual.** The manager paints a finished row green by hand, leaves it one day "to be safe", then deletes it the next day.
3. **One row holds too much.** A single deployment row packs content, risk, and a numbered rollout list with per-region state into one cell. It becomes long, hard to read, and hard to update.
4. **Lost edits.** Confluence has one page body. Two managers editing before the meeting can overwrite each other.
5. **Dead end for UX.** A wiki table cannot give grouping, filtering, presence, history, or a presentation mode.

**Goal:** a web app that replaces the three daily-meeting sections of that page - **Customer Commitments**, **Production Issues**, **Release Management** (both deployment tables) - with a Check Point styled, multi-user, data-driven tool. The slower backlog sections (Certificates, New Regions/Farms, Features & Application, Hot Topics - Infrastructure, Cost Reduction) stay on Confluence for now, so the data model and the UI must be built so those sections can be added later as extra "boards" with no rewrite.

**Decisions already made** (from the planning questions):
- Scope: daily-meeting sections only.
- Stack: React + Vite frontend, Node/Express API, Postgres.
- Jira: read-only sync (live status/assignee/link for `AV-xxxxx` keys, and a mirror of Jira dashboard 10763 for customer commitments).
- Auth: pluggable layer with a dev-only stub user now, real Check Point SSO (OIDC) wired in a later phase.

---

## Product shape - how the app is used

Three ideas drive the whole design.

**1. Compact list + detail drawer, never a wide table.**
Each board shows short rows with only what the manager needs to read out loud: title, owner avatars, status pill, risk pill, rollout progress, age. Everything else (content, risk notes, rollout steps, action items, history, comments) lives in a right-side **detail drawer** that opens on click. This kills the "narrow columns / overloaded cell" problem without hiding information.

**2. A row is a parent with children.**
A deployment row is not one text blob. It is a `deployment` record with:
- many **rollout steps** (one per farm/cluster/region group), each with its own state `pending | in_progress | done | skipped | failed` and optional date;
- many **action items**, each with its own owner, state, and optional Jira key.

A production issue is an `issue` record with many **action items** ("Engineering AIs" today). This is the direct fix for pain point 3: a long numbered list in one cell becomes a list of small typed records that each person updates on their own.

**3. Lifecycle instead of manual green paint.**
Every row has a lifecycle: `active -> done -> archived`. Owner presses **Mark done**; the row turns green and gets a `done_at` timestamp, and stays visible in a **"Closed yesterday"** group. A nightly job moves rows with `done_at` older than 24h to `archived`. Archived rows are never deleted - they are searchable in a History view. No manual coloring, no manual deleting.

---

## Sections of the app

### A. Top bar (global)

Fixed, 64px, `#151018` background, 5px magenta top border (same `--berry` treatment as the reference project), Check Point reversed logo on the left.

Contents, left to right:
- Check Point logo + app name "Daily R&D Sync".
- Date pill showing the meeting date (mono font, e.g. `MON 12 OCT 2026`). Clicking it opens a date picker to view a past meeting snapshot (read-only).
- Global search box - fuzzy search over titles, owners, Jira keys, cluster names, across all three boards.
- **Presence cluster**: small circular avatars of everyone currently in the app, magenta ring on whoever is editing a row.
- **Meeting Mode** button (prominent, magenta). Explained in section E.
- User avatar + menu.

### B. Board navigation + daily summary strip

Under the top bar: three tabs - **Customer Commitments**, **Production Issues**, **Release Management**. Each tab label carries a count badge of active rows and a small magenta dot when something changed since the user last looked.

Below the tabs, a **summary strip** of 4-5 metric cards (reuse `.summary-card` look: `--surface` background, `--line` border, 8px radius, no shadow, mono labels, large Arial numbers):
- `DEPLOYMENTS TODAY` - count of deployments with planned start date = today.
- `IN ROLLOUT` - deployments with at least one step `in_progress`.
- `OPEN PROD ISSUES` - issues not done, with a sub-line splitting High/Medium/Low.
- `COMMITMENTS AT RISK` - commitments whose Jira due date is past or inside 7 days and not done.
- `CLOSED YESTERDAY` - rows that went green in the last 24h. One of these cards uses the `featured` style (magenta left border) for whatever is most urgent today.

Each card is clickable and applies the matching filter to the board below.

### C. Board: Customer Commitments

**Purpose:** mirror the commitments the R&D org promised to specific customers, so the manager can ask "where is this" without opening Jira.

**Data source:** read-only from Jira. The app runs a saved JQL (the one behind existing dashboard 10763, configurable in app settings) every few minutes and caches the result in Postgres. Nothing about the ticket itself is editable in this app. See "Jira access" below for how authentication works - short version: one read-only Jira service account, no per-user Jira login.

**Layout:** rows grouped by **commitment date** (Overdue / This week / Next 2 weeks / Later), each group collapsible with a count.

**Row contents (one line, readable at 1.5m from a screen):**
- Customer name (bold, primary text).
- Jira key as a mono chip, magenta on hover, links out to Jira.
- Summary, truncated to one line with an ellipsis; full text in the drawer and in a hover tooltip (same tooltip pattern as `.component-tooltip`).
- Owner avatar + name.
- Jira status pill with Jira's own category color mapped to our palette.
- Committed date in mono, red-tinted if overdue.
- An **"Add note"** affordance: the only writable thing here is a short app-side note ("waiting on customer env", "blocked by X") plus a **Discussed today** toggle, both stored in our DB keyed by Jira key. This keeps the meeting value without becoming a second Jira.

**Drawer contents:** full Jira description (rendered), Jira comments (read-only, last 5), linked issues, our app-side note history, and a "Discussed in meetings" list of dates.

**Empty state:** a calm panel: "No open customer commitments. The Jira query returned 0 rows - last checked 14:32." plus a Refresh button.

### D. Board: Production Issues

**Purpose:** track live and recently resolved production problems and, more importantly, the engineering action items under each.

**Layout:** three collapsible groups, in this order: **Open**, **Monitoring**, **Closed yesterday**. Default sort inside each group: severity, then age.

**Row contents:**
- Severity bar on the far left - a 4px vertical stripe, magenta for critical, amber (`#fcb117`) for high, muted blue for medium/low.
- Issue title.
- Status pill: `Investigation | In progress | Monitoring | Resolved`.
- **Scope chips** - region/farm tags (`all regions`, `cp-us-2`, `aps1`, `eu`), mono, small. These exist today as free text; they become a typed, filterable list.
- **Customer impact** - short text, amber if non-empty, because it is the thing the manager cares about most ("email delays", "No SIEM exports").
- **Age** - `started X days ago`, mono.
- **Action items progress** - a tiny `3/5` counter plus a thin progress bar. Expanding the row (not the drawer - an inline expand, like `.component-detail`) shows the action items list inline so the manager can read them during the meeting without losing place.
- Owner avatars of all action-item owners, overlapping.

**Action item sub-row:** checkbox-style state control, text, owner, optional Jira key chip, optional ETA. Any attendee can tick their own item live during the meeting. This replaces the giant numbered lists in today's "Engineering AIs" column.

**Drawer contents:** full description, timeline of status changes (who, when, from->to), RCA link field, related deployment links, all action items with full edit, comment thread.

### E. Board: Release Management (the core)

This replaces the two deployment tables. Today they are split with no clear rule; in the app it is one board with a **category** field so the split becomes a filter, not two tables.

**Header of the board** keeps the guidance text from the page, but as a compact, collapsible "Ground rules" panel (default collapsed) with two columns:
- *Risks*: Regression (functional / performance) · Stability (downtime / timeouts / retries / errors) · Service continuity.
- *Deployment plan*: Graduality · Consider the region's local time · Variety: brands, customer size.
This keeps the shared standard visible without eating screen space every day.

**Filter bar:** category (Infrastructure / Application), risk (High / Medium / Low), owner, state, "today only", free text. Filters are reflected in the URL so the manager can bookmark his meeting view.

**Layout:** grouped by state - **In rollout**, **Planned today**, **Planned later**, **QA / Pending**, **Closed yesterday**.

**Row contents:**
- Release name (e.g. `mta-incoming-inline (milter)`), bold.
- Version chip in mono (`main-2026-09-10-1`) - deliberately monospaced, it is a technical identifier.
- Content summary, one line.
- Risk pill: High (magenta), Medium (amber), Low (muted).
- Owner avatars.
- Planned start date, mono.
- **Rollout progress** - the most important widget on the page. A segmented bar: one segment per rollout step, colored by step state (done = soft green, in progress = amber with a subtle pulse, pending = `#38283a` track, failed = magenta, skipped = outlined). Next to it a mono counter `11/42 clusters`. Hovering a segment shows the step name in a tooltip. This replaces the giant embedded numbered lists and the `🇺🇸 mt-prod-3 (N. Virginia): 11 of 42` prose.

**Row expand (inline):** the full **rollout plan** as an ordered list of steps. Each step row: order handle, step name (farm/cluster/region, e.g. `mt-prod-cp-euw2-1 (London) - 3 clusters`), state control, date, optional note, optional cluster count. The owner flips a step to `done` with one click. Steps can be reordered by drag. A step can carry a `cluster_done / cluster_total` pair so partial farms (`11 of 42`) are first-class numbers, not text - the progress bar and the counter are computed from these.

**Drawer contents:**
- Content / what is in the release (rich text, links).
- Risk management notes (free text - today's "Keep the old cluster alive. Deploy upgrade & revert to QA and verify first...").
- QA verification state: a `qa_verified` flag + date + link, shown as a green badge on the row when set. Today "QA verified" is typed into prose in almost every row; it becomes a field.
- Rollback plan text.
- Linked Jira keys (live status from Jira), linked Confluence rollout-schedule URL (the team already keeps detailed schedules like the "Postfix incoming inline + Milter - Rollout Schedule" page - the app links to it rather than duplicating it).
- Action items, same component as production issues.
- History timeline and comment thread.

**Yesterday's deployments:** because every step carries a date and every row carries history, the app can answer "status of yesterday's deployment" automatically. The board gets a **"Since yesterday"** panel at the top of Meeting Mode listing every rollout step that moved state in the last 24h, grouped by release. This is a direct answer to the meeting's second standing topic and today needs a human to remember it.

### F. Meeting Mode (presentation view)

The R&D manager presses **Meeting Mode**. The layout changes for screen sharing:

- Sidebar and filters collapse. Font sizes step up ~20%. One row is "current" at a time, full width, expanded, with its action items and rollout steps visible. The rest of the board shows as a slim navigator list on the left with a magenta marker on the current item.
- Keyboard driven: `J` / `K` or arrow keys to move, `Space` to expand/collapse, `D` to mark done, `C` to mark "covered today", `Esc` to exit.
- **Agenda order** is computed, not manual: rows that changed since the last meeting first, then overdue/at-risk, then in-rollout, then the rest. Rows already marked covered drop to the bottom and dim. This means the manager stops scrolling a 26-row table looking for what matters.
- A **"covered" tick** per row with the meeting date, so next day the app can show "not discussed yesterday".
- A progress indicator: `14 / 31 items covered · 00:12:40 elapsed`.
- When the manager exits, the app writes a **meeting snapshot**: which rows existed, their state, what was covered. The date pill in the top bar can replay any past snapshot - this is the replacement for "the page as it looked that day", and it also gives the team a real record Confluence never kept.

### G. History / Archive view

A separate route. Lets anyone answer "when did we deploy milter to London?" or "what happened with the SIEM meltdown in August?".
- Filter by board, owner, date range, free text; results as a timeline.
- Each archived row opens read-only in the same drawer.
- Per-release view: all rollout steps ever recorded for that release name, as a timeline - effectively a deployment log for free.

### H. Settings (admin)

- Jira connection status, the JQL used for Customer Commitments, sync interval, last sync result.
- Reference data lists the team will want to curate: regions/farms/clusters, release names, severity labels, risk labels. Keeping these as managed lists is what makes scope chips and rollout steps filterable instead of free text.
- Archive rule (default: 24h after done).
- Later: role mapping for SSO (who gets Meeting Mode controls).

---

## How the app solves the concurrency problem (pain point 4)

Three layers, all needed:

1. **Row-level writes.** The API never writes "the page". It writes one row, one step, or one action item. Two managers editing two different deployments never touch the same record.
2. **Optimistic locking.** Every mutable table has a `version integer` column. `PATCH` requests send the version they read; the API rejects with `409 Conflict` plus the current server value if it moved. The UI then shows a small, non-destructive conflict banner inside the drawer: "Amir changed this 30 seconds ago" with *Keep mine / Take theirs / Merge* for the specific fields that differ. Nothing is silently lost.
3. **Live updates + presence.** A Server-Sent Events stream (`GET /api/stream`) pushes row-changed events. Open boards patch in place, with a brief highlight on changed rows. When a user opens a row's edit form, a soft lock advisory is broadcast and other users see a magenta ring on that row plus "Yuri is editing". Advisory, not blocking - it is enough for a 70-person team and avoids stuck locks.

SSE over WebSocket on purpose: the traffic is one-directional, it survives corporate proxies better, and it needs no extra infrastructure.

---

## Technical plan

### Repo layout

The project directory `/Users/noampo/PycharmProjects/ReleaseManagement` is empty (only `.git` and `.idea`). Build it as a small monorepo-by-folders, no workspace tooling needed:

```
/index.html                 # theme-color + title, copied in spirit from SA2CostCalculator/index.html
/package.json               # vite + react on the front, express on the back, one dev script
/vite.config.ts             # dev proxy /api -> localhost:3000
/tsconfig.json
/src                        # frontend
  /assets/check-point-logo-reversed.svg   # copied from SA2CostCalculator/src/assets/
  /styles                   # see "Styling" below
  /components               # Row, Drawer, StatusPill, RiskPill, RolloutBar, ActionItemList, PresenceAvatars, ...
  /boards                   # CommitmentsBoard, ProductionIssuesBoard, ReleaseBoard
  /meeting                  # MeetingMode
  /history
  /settings
  /lib                      # api client, SSE client, auth context, date helpers
  main.tsx
/server
  index.ts                  # express app
  /routes                   # commitments, issues, deployments, steps, actionItems, meetings, stream
  /db                       # pg pool, query helpers (parameterized only)
  /jira                     # jira client + sync job
  /auth                     # pluggable provider: devStub now, oidc later
  /jobs                     # archive job, jira sync job
/migrations                 # numbered .sql files, run by node-pg-migrate
/tests
```

**Why this stack:** it matches the reference Check Point project (React 19 + Vite + TypeScript, no CSS framework), so the styling work carries over directly, and it keeps the dependency list short enough to pass license review (MIT/Apache only - no GPL).

### Data model (Postgres)

Shared columns on every main entity: `id uuid pk`, `created_at`, `updated_at`, `created_by`, `updated_by`, `version integer not null default 1`, `lifecycle text` (`active|done|archived`), `done_at timestamptz null`, `archived_at timestamptz null` (the 1-year retention clock starts here).

- **`person`** - `id`, `display_name`, `email`, `avatar_url`, `jira_account_id`, `active`. Seeded from Jira account lookups; the app resolves `@Name` mentions in migrated content to these.
- **`reference_item`** - `id`, `kind` (`region|farm|cluster|release|severity|risk|scope`), `label`, `parent_id`, `sort_order`, `active`. One table for all managed lists, so adding "brand" later needs no migration.
- **`deployment`** - `title`, `category` (`infrastructure|application`), `version_label`, `content` (rich text), `risk_level`, `risk_notes`, `rollback_plan`, `planned_start_date`, `qa_verified bool`, `qa_verified_at`, `qa_link`, `confluence_url`, `state` (`planned|qa|in_rollout|done|reverted`).
- **`deployment_owner`** - join table `deployment_id` + `person_id` (today's rows have 2-3 owners; a single owner column would be wrong).
- **`rollout_step`** - `deployment_id`, `sort_order`, `label`, `scope_ref_id` (-> `reference_item`), `state`, `clusters_done int`, `clusters_total int`, `occurred_on date`, `note`.
- **`production_issue`** - `title`, `description`, `severity`, `status`, `started_on`, `customer_impact`, `rca_url`.
- **`issue_scope`** - join `production_issue_id` + `reference_item_id`.
- **`action_item`** - polymorphic parent via `parent_type` (`deployment|production_issue`) + `parent_id`, plus `text`, `owner_id`, `state`, `eta_date`, `jira_key`, `sort_order`.
- **`commitment_cache`** - `jira_key pk`, `customer`, `summary`, `status`, `status_category`, `assignee_person_id`, `due_date`, `raw jsonb`, `synced_at`. Read-only mirror.
- **`commitment_note`** - `jira_key`, `body`, `author_id`, `created_at`. Our only writable data on that board.
- **`jira_link`** - `entity_type`, `entity_id`, `jira_key`, plus cached `status`, `status_category`, `assignee`, `synced_at`.
- **`change_event`** - append-only audit: `entity_type`, `entity_id`, `field`, `old_value`, `new_value`, `actor_id`, `occurred_at`. Powers every history timeline and the "changed since yesterday" agenda ordering. Written by one helper in the DB layer so no route can forget it.
- **`meeting`** - `meeting_date unique`, `started_at`, `ended_at`, `led_by`.
- **`meeting_coverage`** - `meeting_id`, `entity_type`, `entity_id`, `covered_at`, `note`.
- **`meeting_snapshot`** - `meeting_id`, `payload jsonb` - the frozen board state, written on Meeting Mode exit.
- **`comment`** - `entity_type`, `entity_id`, `body`, `author_id`, `created_at`.

Indexes that matter: `(lifecycle, planned_start_date)` on deployment, `(parent_type, parent_id, sort_order)` on action_item, `(entity_type, entity_id, occurred_at desc)` on change_event, `(deployment_id, sort_order)` on rollout_step.

### API

REST, JSON, all under `/api`. Representative routes:

```
GET    /api/boards/summary                  # the metric cards
GET    /api/deployments?category&risk&state&owner&q
POST   /api/deployments
PATCH  /api/deployments/:id                 # body carries `version`
POST   /api/deployments/:id/done
GET    /api/deployments/:id                 # with steps, action items, history, comments
POST   /api/deployments/:id/steps
PATCH  /api/rollout-steps/:id
POST   /api/rollout-steps/reorder
GET    /api/issues?status&severity&scope&q
POST   /api/issues  ·  PATCH /api/issues/:id  ·  POST /api/issues/:id/done
POST   /api/action-items  ·  PATCH /api/action-items/:id
GET    /api/commitments                     # from commitment_cache
POST   /api/commitments/:jiraKey/notes
GET    /api/meetings/today  ·  POST /api/meetings/today/start  ·  /end
POST   /api/meetings/today/coverage
GET    /api/meetings/:date/snapshot
GET    /api/history?board&owner&from&to&q
GET    /api/stream                          # SSE: row-changed, presence, lock advisory
GET    /api/reference/:kind  ·  POST/PATCH  (admin)
GET    /api/settings/jira  ·  POST /api/settings/jira/sync
```

Hard rules for the implementation:
- Every SQL statement uses parameterized queries (`pg` placeholders) - never string concatenation.
- Every request body validated with a schema validator (zod) at the route boundary; unknown fields rejected.
- Rich-text fields are sanitized on write and rendered as escaped HTML with an allow-list; no `dangerouslySetInnerHTML` on unsanitized input.
- Jira base URL, email, and API token come from environment variables injected into the process, never from a file in the repo and never committed. `.env` is in `.gitignore` from the first commit. Tokens are not logged.
- All outbound Jira calls over HTTPS with certificate verification left on.
- The Jira API token is a service credential; for local development it must be exported into the shell session only, not persisted to `.env`, a dotfile, or a shell startup file.

### Auth (pluggable, stub now)

`server/auth/index.ts` exports `getUser(req): Promise<User | null>` backed by a provider chosen by `AUTH_PROVIDER`:
- `dev-stub` (default in development): reads a user from a signed dev cookie set by a `/api/dev/login` route that only mounts when `NODE_ENV !== 'production'`. Picking a user from a dropdown is enough to exercise presence, locking, and "updated by".
- `oidc` (phase 2): standard authorization-code + PKCE flow against Check Point's identity provider, session in an httpOnly, Secure, SameSite=Lax cookie.

Every route reads the user through this one function and a `requireUser` middleware, and `requireRole('meeting_lead')` guards Meeting Mode start/end and settings. The server refuses to boot in production with `AUTH_PROVIDER=dev-stub`. This way phase 2 is a config change plus one new file, not a refactor.

### Jira access (read-only)

**Authentication: one read-only service account, server-side.** Users never log in to Jira through this app.

- A Jira admin creates a service account (e.g. `rnd-sync-bot@checkpoint.com`) with **browse-only** permission on the relevant projects, and issues an API token for it.
- The server calls Atlassian Cloud REST v3 with basic auth:
  `GET https://avanan.atlassian.net/rest/api/3/search/jql?jql=...&fields=summary,status,assignee,duedate,priority,labels`
  with header `Authorization: Basic base64(<account-email>:<api-token>)`.
- Email and token come from the process environment (`JIRA_BASE_URL`, `JIRA_ACCOUNT_EMAIL`, `JIRA_API_TOKEN`). For local development they are exported into the shell session only - never written to `.env`, a dotfile, or a shell startup file, and never committed. Nothing Jira-related is logged.
- HTTPS with certificate verification left on. No write scopes are used; the client module exposes only `GET` helpers so a write is not reachable by mistake.

**Effort: small.** The read side is two REST calls plus a timer. The real work is the mapping - Jira `statusCategory` -> our status pills, Jira `accountId` -> our `person` rows, `duedate` -> our commitment-date grouping.

**Two safety rules built in from day one:**
1. The JQL is **server-side config only** (Settings, admin role). The browser can never send a JQL string - otherwise any app user could read anything the service account can see.
2. The API returns only the fields we render. The `raw jsonb` column stays server-side and is never sent to the browser.

**Alternative, and why not now:** OAuth 2.0 3LO per user means each person sees exactly what Jira lets them see, and there is no shared credential - but it costs roughly a week (app registration, consent flow, refresh-token handling, encrypted token storage) and it cannot pre-sync before someone logs in, so the board would be empty at the start of the meeting. Keep the `server/jira` module behind a small interface so a second `oidc`-style provider can be added later without touching the routes, exactly like the auth plan.

### Jira sync job

A job every 5 minutes (and on demand from Settings):
1. Run the configured JQL -> upsert `commitment_cache`.
2. Collect all `jira_key` values from `jira_link` and `action_item` -> batch `search` by key -> update cached status/assignee.

Failures are recorded and surfaced as a banner ("Jira sync failed 14:05 - showing data from 13:35") rather than an empty board. The job never writes to Jira.

### Data retention / TTL

Two very different kinds of data live in this database, and they get opposite treatment.

**Jira cache - short TTL, disposable.** These are copies; losing the whole table is harmless because the next sync rebuilds it.

| Data | Refresh | Considered stale | Deleted |
|---|---|---|---|
| `commitment_cache` | every 5 min | 15 min (UI shows "data from 13:35") | 7 days after the key stops matching the JQL |
| cached status on `jira_link` | every 5 min | 15 min | with its parent row |

**Our own data - kept 1 year, then deleted.** One uniform rule, no per-table exceptions: everything the team writes in the app is kept for **365 days** and then removed by a nightly cleanup job. This covers `deployment`, `rollout_step`, `production_issue`, `issue_scope`, `action_item`, `comment`, `commitment_note`, `change_event`, `meeting`, `meeting_coverage`, `meeting_snapshot`, and `jira_link`.

The clock starts from the row's **archive date** (`archived_at`), not its creation date, so a long-running deployment that stays open for eight months still gets a full year of history after it closes. Children go with their parent: deleting a deployment deletes its steps, action items, comments, and change events in one transaction (`ON DELETE CASCADE` on the child foreign keys, with `change_event` keyed by `(entity_type, entity_id)` cleaned by the same job since it has no FK).

Two consequences worth knowing up front:
- `lifecycle = 'archived'` still means "hidden from the daily boards", and the **History view therefore covers a rolling 1 year** - which is well past the "what happened yesterday / last month" questions the meeting actually asks.
- Nothing in the app offers a manual hard delete. The only deletion path is the age-based job, so a mistaken edit is always recoverable from `change_event` while the row lives.

Volume is not a concern at this scale - roughly 50 active rows with a few edits each per day means about 50k `change_event` rows a year - so the 1-year rule is about keeping the data footprint predictable, not about performance.

| Data | Kept | Then |
|---|---|---|
| all app-authored rows (list above) | 365 days from `archived_at` | hard-deleted by the nightly cleanup job, children cascaded |

**Operational:** nightly `pg_dump` to an encrypted store, 30 daily + 12 monthly copies. Customer names and commitment summaries count as customer data, so backups stay on Check Point-controlled, encrypted storage (AES-256) and never leave it.

**Sessions and credentials:** session cookie 12 hours, httpOnly + Secure + SameSite=Lax. In the service-account model no Jira token is ever stored in the database at all.

### Styling

Follow the reference project closely so the two apps look like one family.

- Copy the token block and dark treatment from `/Users/noampo/PycharmProjects/SA2CostCalculator/src/styles.css` (lines 366-484) into `src/styles/tokens.css`: `--surface: #1d1721`, `--surface-raised: #261c29`, `--surface-deep: #17121b`, `--line: #433044`, `--berry: #ee0c5d`, `--berry-light: #ff6c9f`, `--ink: #f2f2f2`, `--text-muted: #c4b8c3`, `--text-subtle: #a99ba9`, `--mono: Consolas, 'Courier New', monospace`, page background `#100d13`.
- Add tokens the new app needs, in the same deep, muted register: `--amber: #fcb117`, `--amber-soft: #ffd06a`, `--bronze: #bd8d5b`, `--green-soft: #7fa87f`, `--blue-soft: #78a9ce`, `--danger: #ff8d96`. Green and blue only for status and data, never for chrome.
- Reuse the proven patterns rather than inventing: `.summary-card` for the metric strip, `.component-group` / `.component-row` / `.component-trigger` / `.component-detail` for expandable rows (it already has the hover, focus ring, chevron, and tooltip behavior we need), `.component-tooltip` for truncated text, `.bar-track` + `.category-bar` as the base for the rollout progress bar, `.date-stamp` / `.unit-tag` for mono chips, `.panel-note` and `.estimate-status` for banners.
- Typography: Arial/Helvetica for headings and numbers (same as the reference), readable body text, `var(--mono)` for versions, cluster names, dates, counters, and all small labels. `font-variant-numeric: tabular-nums` on every number so counters do not jitter when they update live.
- Chrome details that carry the brand: 5px `--berry` top border on the app shell, magenta focus rings (`outline: 2px solid var(--berry-light)`), 8px radius on cards, 5-7px on controls, no heavy shadows, `--line` hairline borders.
- Copy `/Users/noampo/PycharmProjects/SA2CostCalculator/src/assets/check-point-logo-reversed.svg` into `src/assets/` and use it as-is - it is the official reversed mark; do not recolor it.
- `index.html`: `<meta name="theme-color" content="#151018">`, `<title>Daily R&D Sync | Check Point</title>`, matching the reference file.
- Respect `prefers-reduced-motion`: the "in progress" pulse and the row-changed highlight become static.
- Accessibility is not optional for a screen-shared app: keep contrast at AA for body text, make every pill carry a text label and not only a color (severity also shows `H`/`M`/`L`), and make the whole board keyboard reachable.

---

## Build order

1. **Skeleton + theme.** Vite + React + TS, express server, `/api/health`, the token stylesheet, top bar with logo, three empty board tabs. The thing to prove here is that the Check Point look is right before any feature exists.
2. **Schema + migrations + seed.** All tables above, plus a seed script that loads the reference lists (regions, farms, release names) and a handful of people.
3. **Release Management board, read-only.** Rows, grouping, rollout progress bar, inline expand, drawer. Fed by seeded data.
4. **Writes + optimistic locking + change_event.** Create/edit deployment, steps, action items. Conflict UI. This is the core risk of the project - do it before adding more boards.
5. **Production Issues board.** Reuses almost every component from step 3-4.
6. **SSE + presence + lock advisory.**
7. **Done / archive lifecycle** and the two nightly jobs - archive (24h after done) and retention cleanup (365 days after archive) - plus the "Closed yesterday" group.
8. **Jira read-only sync** and the Customer Commitments board. *Prerequisite with a lead time - ask a Jira admin for the browse-only service account and its API token early, at step 1, so it is ready by the time we get here.*
9. **Meeting Mode** and meeting snapshots.
10. **History view** and Settings.
11. **Migration of today's content** - a one-off script that parses the current Confluence page body (available through the Confluence REST API, which we already read in this session) into `deployment` / `rollout_step` / `production_issue` / `action_item` rows. It will not be perfect: the prose cells mix state, dates, and region lists. Plan it as *script gets ~80% in, then the owners fix their own rows in the app during the first week*, and keep the Confluence page as read-only reference for one sprint.
12. **Cutover.** Run both in parallel for one week, with the Confluence page carrying only a banner linking to the app. Then freeze the page.

A later phase, out of scope now but designed for: the remaining Confluence sections (Certificates, New Regions/Farms, Features & Application, Hot Topics - Infrastructure, Cost Reduction) are all "topic + owner + AI + status + notes + ETA" shaped. They become extra boards over a single generic `topic` entity reusing `action_item`, `change_event`, and the same row/drawer components.

---

## Verification

- **Unit tests** (`node --test`, matching the reference project's test setup) for: rollout progress computation from `clusters_done/clusters_total` and step states, agenda ordering in Meeting Mode, the archive rule boundary at exactly 24h, the retention boundary at exactly 365 days from `archived_at`, lifecycle transitions, and the Jira field mapping.
- **API tests** against a throwaway Postgres (docker or a local test database): every route's happy path, plus explicitly: `PATCH` with a stale `version` returns `409` and does not write; `POST /done` sets `done_at`; the archive job moves only rows past the cutoff; the cleanup job deletes only rows archived over 365 days ago and cascades their children, leaving nothing orphaned (assert no stray `change_event` or `rollout_step` rows remain); unauthenticated requests are rejected.
- **Concurrency test** - the one that proves the main point: two API clients read the same deployment, both `PATCH` a different field with the same version; assert one succeeds, one gets `409`, and no field is lost. Repeat with the same field and assert the conflict payload names it.
- **SQL safety check** - a test (or a grep in CI) asserting no template-literal interpolation in the `server/db` layer.
- **Manual run:** `npm run dev` starts Vite and the API together; log in as two different stub users in two browser windows, edit two rows at once, then the same row, and watch presence, live patching, and the conflict banner. Then run Meeting Mode end to end on a shared screen at 1920x1080 and at a projector's 1280x720 to check the font sizes actually read from across a room.
- **Visual check:** open the new app and `SA2CostCalculator` side by side and confirm they read as the same design system - same magenta, same surfaces, same mono treatment.
- **Data check after migration:** compare counts and titles from the Confluence page against the imported rows, and have 2-3 owners confirm their own rows survived the parse.

---

**🔰 CISO Guidance Plugin** · Check Point policies applied:
· Secure Software Development Lifecycle (SSDLC) → Required parameterized SQL only, schema validation of all request bodies, and sanitized rich-text rendering.
· Passwords and Credentials Policy → Jira API token injected through the shell environment, never stored in `.env`, dotfiles, or the repository.
· Network Security Policy → Jira calls over HTTPS with certificate verification left enabled; plain HTTP kept only for the local dev server.
· Acceptable Use Policy → Customer commitment data stays inside the Check Point-hosted app and Jira; no export to outside services.