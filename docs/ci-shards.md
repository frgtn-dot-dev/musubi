# CI test shards

`Quality` runs database integration and web end-to-end tests in four separate
jobs each. A database job has its own Postgres service and applies every committed
migration to an empty database. Suites within that job run sequentially.

Preview a job's selection from the repository root:

```sh
node scripts/ci-shards.mjs db 1/4 --list
node scripts/ci-shards.mjs web 1/4 --list
```

Omit `--list` to execute it. Database jobs need the same environment and migrated
Postgres as `pnpm test:db`; the local command `pnpm test:db` still runs everything.
Web jobs keep the existing Playwright configuration, fixtures, retries and browser.

## Coverage and balancing

The database inventory expands the existing `test:db` package scripts. Adding a
suite there includes it in CI automatically. Unsupported commands or recursive
scripts fail collection instead of being silently skipped. The 70 current suites
are spread across four jobs, preserving their original relative order within each
job. Each suite now reports its duration separately.

Web tests are collected with Playwright, including generated cases and nested
groups. `scripts/ci-web-timings.json` records successful test durations from the
linked CI run. Long tests are assigned first to the least loaded shard; tests with
no recorded duration receive a six-second estimate. New or renamed tests remain
included. Durations affect placement only, never whether a test runs.

The runner checks that every inventory entry occurs once and verifies each
generated `--test-list` against Playwright before executing it. This matters because
Playwright accepts a test list that matches nothing without failing the command.

## Timing artifacts

Every job uploads its selected test list and timing results, including on failure:

- `database-timings-N`: `db-results.json`, one duration and exit code per suite.
- `web-timings-N`: `web-results.json`, the standard Playwright JSON report.

When a shard becomes substantially slower, refresh the web timing baseline from
successful runs. Match tests by browser project, path relative to the Playwright
test directory, and full title path; do not use line numbers. Keep the source run
and recording date in the baseline. Do not include failed attempts in durations.

`node --test scripts/ci-shards.test.mjs` checks the partitioning, inventory expansion,
unknown tests, duplicate detection, and rejection of incomplete Playwright selections.
