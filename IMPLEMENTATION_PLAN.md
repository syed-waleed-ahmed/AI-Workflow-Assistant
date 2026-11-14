# Implementation plan and status

The record of how the CLI demo became the platform: what the audit found, the order of work,
and where each acceptance criterion stands. Statuses use four terms:

- **Verified** — implemented and exercised by an automated test or a recorded run.
- **Implemented** — in the code, but not exercised against real external infrastructure.
- **Blocked** — needs an action only the repository owner can take.
- **Not implemented** — deliberately left out; see the note.

## Audit of the original project

The starting point was a 250-line CLI: a two-node LangGraph ReAct loop (`agent ⇄ tools`),
three pandas tools, a Groq model, and a Markdown report printed to the terminal.

| Finding | Consequence | Resolution |
| --- | --- | --- |
| Default model `llama-3.3-70b-versatile` returns 404 from Groq | The CLI could not run at all | Moved to `openai/gpt-oss-120b` |
| `filter_rows` passed model-written text to `DataFrame.query()` | Model-controlled expression evaluation | Structured filters; arithmetic-only calculated columns via a validated AST |
| No aggregation, grouping or time tools | "Regional sales performance" could only be answered by eyeballing filtered rows | Sixteen analytical tools |
| The model wrote every number in the report | Figures could be invented | Tools compute; a grounding step checks every stated number |
| pandas read the region code `NA` as missing | North America silently dropped from the project's own sample data | Explicit missing-value markers |
| CSV re-read from disk on every tool call | Wasteful beyond toy files | Parquet storage and a bounded in-memory cache |
| No loop limit beyond LangGraph's default | A looping run ended in an exception | Round, tool-call, batch and time limits |
| No tests, no error handling, no persistence, single user | Not deployable | The rest of this document |

Kept from the original: the `AgentState` message list with LangGraph's `add_messages`
reducer, the `agent`/`tools` nodes and the `should_continue` router, the intent of the
five-section report, and the command-line interface (`python -m app.cli`).

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 1 | Repository audit and target architecture | Done |
| 2 | Backend foundation: FastAPI, settings, models, migrations, auth | Done |
| 3 | Analytical engine: deterministic tools, safe filtering | Done |
| 4 | LangGraph orchestration: plan, ReAct loop, verification, structured report, limits | Done |
| 5 | Dataset infrastructure: validation, parsing, profiling, storage, quotas | Done |
| 6 | Frontend: Next.js application wired to the real API | Done |
| 7 | Reporting: charts from tool results, persistence, exports | Done |
| 8 | Security and performance: isolation tests, injection tests, memory profile | Done |
| 9 | CI/CD and deployment | Done: Vercel, Render and Supabase, see DEPLOYMENT.md |
| 10 | Production verification | Done: smoke test and browser journey against the live URLs |

## Acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| Existing CLI audited, valuable logic preserved | Verified | Table above; `backend/app/cli.py` runs the same workflow |
| FastAPI backend operational | Verified | 375 tests; CI |
| Next.js frontend operational | Verified | 131 tests, lint, strict typecheck and production build; `frontend/e2e/journey.mjs` (36 checks) passed in a real browser against the production build |
| Database configured and persistent | Verified | `backend-postgres` CI job (PostgreSQL 17); hosted Supabase PostgreSQL 17, reports persisted across sessions in the production smoke test |
| User authentication | Verified | `test_api_auth.py` |
| User-level authorisation | Verified | `test_isolation.py` (17 routes × wrong user and anonymous) |
| CSV uploads | Verified | `test_file_validation.py`, `test_api_datasets.py` |
| Excel uploads, including sheet selection | Verified | same |
| Dataset preview and profiling | Verified | `test_api_datasets.py`, `test_tools.py` |
| Advanced analytical tools | Verified | `test_tools.py` compares each with hand-computed values |
| LangGraph agent and ReAct tool execution | Verified | `test_agent_graph.py`; live runs against Groq |
| Analysis verification | Verified | `test_verification.py`, `test_agent_graph.py` |
| Structured reports | Verified | `test_api_analyses.py` |
| Interactive charts from backend data | Verified | Chart tests use real report output; charts rendered in the browser journey |
| Reports persist across sessions | Verified | `scripts/smoke_test.py` and the browser journey (sign out, sign in, list) |
| Markdown, PDF, Excel and CSV export | Verified | `test_reports_and_platform.py` |
| Responsive UI, light and dark themes | Verified | Browser journey: both themes; no horizontal scroll at 390 px on six pages; mobile navigation |
| Security tests | Verified | See the checklist in SECURITY.md |
| Backend and frontend tests passing | Verified | CI |
| Production builds | Verified | `next build` and the Docker image build in CI |
| CI/CD configured | Verified | `.github/workflows/ci.yml` |
| Database migrations | Verified | Applied, checked for drift and reversed on PostgreSQL in CI |
| Live frontend and backend deployed | Verified | <https://ai-workflow-assistant-app.vercel.app> and <https://ai-workflow-assistant-api.onrender.com>; `/ready` reports database, storage and model `ok` |
| Frontend–backend integration | Verified in production | Requests through Vercel's proxy, and direct uploads to the API with upload tickets |
| Production smoke tests | Verified | `smoke_test.py` 41/41 (including a real analysis, 22 figures verified) and `npm run e2e` 36/36 against the live URLs |
| Documentation | Done | README and the four documents it links |
| Free-tier constraints and upgrade path documented | Done | DEPLOYMENT.md |

## Deliberately not built

| Item | Reason |
| --- | --- |
| Password reset, email verification | No email provider; Render's free tier blocks SMTP ports. Stated in the UI and SECURITY.md. |
| Server-sent event streaming | Polling passes through the frontend proxy and survives restarts with no special handling; progress events are real either way. |
| Redis, a message broker, a separate worker service | One free instance; the database coordinates everything a broker would. |
| DuckDB / model-written SQL | pandas answers every tool call in well under a second within the documented limits. |
| LangGraph checkpointing | A turn is short and is re-run if the process dies; conversation state lives in the application's tables. |
| Persistent data cleaning, dataset versioning | Filters and calculated columns apply per question. Replacing a dataset means uploading a new one. |
| Joining several datasets in one analysis | Out of scope for this version. |
| A repository layer | Services call SQLAlchemy directly; no query has a second caller. |

## Possible next steps

1. Several datasets in one analysis, with validated joins.
2. Saved analysis templates and scheduled reports (needs an email provider).
3. Dataset comparison between two uploads of the same shape.
4. Server-sent events for progress once the API has an always-on host.
5. A Redis-backed rate limiter and a separate worker service when running more than one instance.
