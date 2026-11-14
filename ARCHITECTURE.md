# Architecture

This document describes the system as it is built. Where something was considered and left
out, the reason is given.

## Overview

```text
 Browser
    │  same-origin requests (cookies + CSRF header)
    ▼
 Next.js frontend (Vercel) ──── /api/* rewrite ────►  FastAPI backend (Render, one instance)
    │                                                   │
    │  file uploads go direct, with a                   ├── HTTP layer        app/api
    └─ short-lived upload ticket ──────────────────────►├── services          app/services
                                                        ├── agent             app/agents
                                                        ├── analytical tools  app/tools
                                                        └── worker thread     app/workers
                                                              │            │           │
                                                              ▼            ▼           ▼
                                                         PostgreSQL   S3-compatible   Groq API
                                                         (Supabase)   object storage  (LLM)
```

The backend is a **modular monolith**: one deployable process with clear internal boundaries.
There is no message broker, no separate worker service and no cache server, because the
free-tier target offers a single small instance and none of those would earn their keep at
this scale. The boundaries are drawn so each part can be moved out later (see
[Scaling path](#scaling-path)).

## Repository layout

```text
backend/
  app/
    main.py            application factory, request middleware, CORS
    cli.py             the original command-line interface, on the new engine
    api/               routes and request dependencies (auth, CSRF, rate limits, pagination)
    core/              settings, database, security primitives, logging, errors, rate limiter
    models/            SQLAlchemy models
    schemas/           Pydantic request/response and report schemas
    services/          business logic: auth, datasets, analyses, reports, storage
    agents/            LangGraph workflow, model gateway, prompts, evidence, verification
    tools/             deterministic pandas analytics (no LLM calls)
    workers/           background job runner
    utils/             upload validation, DataFrame helpers, Markdown rendering
  migrations/          Alembic migrations
  tests/               pytest suite
  scripts/smoke_test.py  end-to-end check against a running deployment
frontend/              Next.js application
docs/                  OpenAPI schema and a real sample report
data/                  sample datasets
```

There is no separate repository layer. Services use SQLAlchemy sessions directly; with eight
tables and queries that are each used once, a repository per model would be indirection
without a second caller.

## Request flow

1. The browser only ever talks to the frontend's origin. Next.js rewrites `/api/*` to the
   backend, so session cookies are first-party and no cross-site cookie configuration is
   needed.
2. `app/main.py` middleware assigns a request id, rejects oversized bodies from their declared
   length, adds security headers, converts unexpected exceptions into a generic 500, and
   writes one structured log line per request.
3. Route dependencies authenticate the session cookie, check the CSRF header on state-changing
   requests, and apply per-user rate limits.
4. Routes call services. Every service function that reads a user-owned resource takes the
   user id and filters on it; a resource owned by someone else is reported as 404.

File uploads are the one exception to step 1. The frontend host's proxy is not documented to
accept large request bodies, so the browser asks for a five-minute **upload ticket** and sends
the file straight to the backend with it. The ticket is signed, names one user, and is
accepted by the upload route only.

## Data model

| Table | Purpose |
| --- | --- |
| `users` | Account. Password stored as an Argon2id hash. |
| `user_sessions` | Server-side sessions. Stores a SHA-256 digest of the token, never the token. |
| `datasets` | Uploaded table: metadata, storage key, and the profile computed at ingest. |
| `analyses` | A conversation about one dataset, and the job state of its latest turn. |
| `analysis_messages` | User questions and assistant summaries, per turn. |
| `analysis_events` | Progress events written by the worker and polled by the client. |
| `reports` | One structured report per completed turn (JSON). |
| `usage_records` | One row per turn: outcome, model calls, tool calls, tokens, duration. |

All user-owned tables cascade from `users`. Deleting a dataset sets `analyses.dataset_id` to
null and keeps the analysis and its reports, which carry a snapshot of the dataset name.
Usage records deliberately do not reference analyses, so quota history survives deletions.

Indexes cover the queries that exist: listings by `(user_id, created_at)`, the job queue by
`(status, queued_at)`, and event polling by `(analysis_id, id)`.

## Datasets

`app/utils/file_validation.py` turns an upload into a typed DataFrame:

- The format is decided from the extension **and** confirmed against the file's leading bytes.
- `.xlsx` archives are inspected before opening (entry count, total uncompressed size,
  compression ratio).
- CSV encoding and delimiter are detected. The list of missing-value markers is explicit,
  because pandas' default treats `NA` as missing and would silently drop a region coded "NA".
- Text columns that are really numbers (`$1,200.50`, `45%`, `(300)`) or dates are converted,
  and each conversion is recorded as a note the user can see.
- Row, column and cell limits are enforced during parsing.

The result is stored as **Parquet** in object storage under an application-generated key
(`datasets/<user id>/<dataset id>.parquet`). Parquet is typed and several times smaller than
CSV, and it loads without re-running inference. A profile (column kinds, statistics, quality
score and issues) is computed once and stored with the row.

A small in-process LRU cache keeps recently used DataFrames parsed, bounded by memory. Cached
frames are shared and treated as read-only; any tool that needs to change data works on a
copy.

DuckDB was considered for larger files and left out: within the documented limits pandas
answers every tool call in well under a second, and a second query engine would double the
surface to test.

## The analysis agent

The original project was a two-node LangGraph ReAct loop (`agent ⇄ tools`). That loop is still
the core; four stages were added around it.

```text
 START → plan → agent ⇄ tools → verify → report → ground → END
                  ▲               │        ▲         │
                  └── evidence ───┘        └─ fix ───┘
                      missing              unverified numbers
```

| Node | What it does | Uses the LLM |
| --- | --- | --- |
| `plan` | States the steps and selects which tools the run needs. | yes |
| `agent` | Reads the transcript and either requests tool calls or says it is done. | yes |
| `tools` | Validates and executes the requested calls against the dataset. | no |
| `verify` | Checks that results were actually computed; sends the agent back once if not. | no |
| `report` | Writes a structured report draft that cites evidence ids. | yes |
| `ground` | Checks every number in the draft against tool results. | no |

**Tools compute, the model narrates.** The sixteen tools in `app/tools` are plain functions
from a DataFrame and validated arguments to a `ToolResult` (summary, scalars, table, chart).
The model never sees a file path or dataset id: the executor binds every call to the one
DataFrame the analysis was authorised for. Charts and tables in a report are taken from tool
results on the server; the model only chooses which charts to show.

**The evidence ledger.** Every tool call becomes an evidence record (`E1`, `E2`, …). The
report cites these ids, and the stored report includes the records as its methodology
section, so each figure can be traced to the computation that produced it.

**Numeric grounding.** After the draft is written, `app/agents/verification.py` extracts every
number from its factual sections and requires each to match a value in the evidence, the
dataset profile or the user's question — after rounding to the precision shown, or within
0.5% for abbreviations such as "1.23M". Numbers that match nothing are sent back to the model
once for correction; anything still unmatched is listed in the report as unverified and the
report is marked *partially verified*.

What this does and does not guarantee is stated in [SECURITY.md](SECURITY.md#limits-of-verification).

**Bounded execution.** A run is limited by a cap on agent rounds, a cap on tool calls, a cap
on calls per batch, LangGraph's recursion limit as a backstop, and a wall-clock deadline.
Cancellation and the deadline are checked before every model request and tool execution.

**Token budgeting.** Groq's free tier rejects any single request above 8,000 tokens and allows
8,000 tokens per minute. Three things keep runs inside that: the planner chooses a subset of
tools so only their schemas are sent; tool schemas are compacted; and older tool results are
re-rendered with fewer table rows when a request would exceed the budget (the full results
stay in the ledger). A `run_batch` tool lets models without parallel tool calling request
several results in one step. A 429 from the provider is treated as an expected event: the
gateway waits for the interval the provider asks for, tells the user it is waiting, and
retries within the deadline.

**Conversations.** A follow-up question starts a new turn on the same analysis. Earlier
questions and their answer summaries are passed in as context. This state lives in the
application's own tables; LangGraph checkpointing is not used, because a turn is short and is
simply re-run if the process dies.

## Background jobs

Analyses never run inside an HTTP request.

- **Queue**: the `analyses` table. Creating a turn sets `status = 'queued'`.
- **Claim**: a worker takes the oldest queued row with a conditional `UPDATE … WHERE status =
  'queued'`, so two workers cannot take the same job.
- **Progress**: the worker inserts `analysis_events` rows; the client polls
  `GET /analyses/{id}/events?after=<id>`. Polling was chosen over server-sent events because
  it passes through the frontend proxy and survives instance restarts without special
  handling.
- **Recovery**: a running job refreshes a heartbeat. A job whose heartbeat goes stale (the
  instance restarted) is requeued once, then failed with a clear message.

The worker is a thread inside the API process. All coordination goes through the database, so
the same class can run as a separate process, or several, without code changes.

## Reports and exports

A report is stored as validated JSON (`ReportContent`). The API serves it as-is; the frontend
renders KPI cards, findings, charts and the methodology from it. Exports are generated on
request from the same structure: Markdown, PDF (fpdf2 with bundled DejaVu fonts for Unicode;
charts drawn as vector graphics), Excel (a summary sheet plus one sheet per evidence table)
and CSV (one evidence table).

## Observability

- One JSON log line per request with request id, method, path, status, duration and user id.
  Bodies, cookies and query strings are never logged.
- Worker logs carry the analysis id and end with outcome, duration, model calls, tool calls
  and tokens.
- `usage_records` holds the same per-turn metrics for quotas and for answering "how long do
  analyses take, and how often do they fail?" with a SQL query.
- `GET /health` (liveness) and `GET /ready` (database, storage, model key), also under
  `/api/v1`.
- Sentry is initialised when `SENTRY_DSN` is set, with request bodies and local variables
  excluded.

## Scaling path

Each step is a configuration or deployment change, not a redesign.

| Limit reached | Change |
| --- | --- |
| Analyses queue up | Raise `WORKER_CONCURRENCY`; then run the worker as its own service. |
| Model rate limits | Move to Groq's paid tier and raise `LLM_REQUEST_TOKEN_BUDGET`. |
| Memory on large files | Larger instance; raise `MAX_ROWS`, `MAX_UPLOAD_MB`, `FRAME_CACHE_MB`. |
| More than one API instance | Replace the in-memory rate limiter with a Redis-backed one behind the same `check` interface. Nothing else holds per-process state. |
| Storage or database quota | Any S3-compatible store and any PostgreSQL work unchanged. |
