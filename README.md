# Daily R&D Sync

## Local development

Install dependencies with `npm install`, then run `npm run dev` to start the Vite frontend and Express API.

## PostgreSQL setup

Use a local or disposable development PostgreSQL database. Set `DATABASE_URL` in the process environment to its connection string. Do not point development commands at a valuable or production database. The schema requires PostgreSQL's `pgcrypto` extension (used for UUID defaults); the migration creates it if the database role has permission.

Run `npm run db:migrate` to apply numbered migrations and `npm run db:seed` to insert deterministic development people, reference data, deployments, rollout steps, issues, and action items. Seeds use stable IDs and conflict-safe inserts, and are safe to rerun. To roll back the last migration, use `npm run db:rollback`.

The `action_item`, `jira_link`, `change_event`, `meeting_coverage`, and `comment` tables use polymorphic entity references and therefore cannot enforce a parent foreign key. Retention or deletion workflows must explicitly delete matching polymorphic rows by `(entity_type, entity_id)` in the same transaction before deleting a parent. Foreign-key-backed children cascade. Audit events remain append-only during normal operation; retention cleanup is responsible for removing them.
