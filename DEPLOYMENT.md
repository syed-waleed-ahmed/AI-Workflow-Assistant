# Deployment

How to put the platform on the internet using free tiers, what those tiers limit, and how to
move off them. Provider limits below were checked against the providers' own documentation in
November 2026; they change, so confirm them before relying on a number.

## Current deployment

| | |
| --- | --- |
| Application | <https://ai-workflow-assistant-app.vercel.app> |
| API | <https://ai-workflow-assistant-api.onrender.com> (`/ready`, `/docs`) |
| Database and storage | Supabase project in `eu-central-1` (Frankfurt), next to the Render region |

Verified on 14 November 2026 against the live URLs: `/ready` reported database, storage and
model `ok`; `scripts/smoke_test.py` passed all 40 checks, including a real analysis whose 22
figures were all traced to computed results; and `npm run e2e` passed all 36 browser checks
with no console errors.

## Chosen infrastructure

| Part | Provider | Why this one |
| --- | --- | --- |
| Frontend | **Vercel** (Hobby) | Native Next.js hosting. Its proxy waits up to 120 s for an origin, which covers the backend's cold start. |
| Backend API + worker | **Render** (free web service) | Runs the Docker image as a long-lived process, which the in-process worker needs. |
| Database | **Supabase** PostgreSQL (free) | Persistent Postgres with an IPv4 pooler. One account also provides storage. |
| File storage | **Supabase Storage** via its S3 API (free) | Durable and S3-compatible, so the code is not tied to it. |
| LLM | **Groq** free tier, `openai/gpt-oss-120b` | Supports tool calling and strict structured output. |
| CI | **GitHub Actions** | Lint, types, tests on SQLite and PostgreSQL, image build, daily health check. |

Options that were evaluated and not chosen:

- **Hugging Face Spaces** — Docker Spaces now require a paid plan; only static Spaces are free.
- **Render's free PostgreSQL** — expires 30 days after creation.
- **Cloudflare R2** — a good fit technically (10 GB free); Supabase Storage was preferred to
  keep the number of accounts down. R2 works with the same settings if you prefer it.
- **Neon** PostgreSQL — also works unchanged (set `DATABASE_URL`). It does not pause after a
  week idle, at the cost of one more account.
- **Serverless functions for the API** — an analysis runs for one to two minutes with a
  background worker, which does not fit a request-scoped function.

## Free-tier limits that shape the product

| Provider | Limit | Effect |
| --- | --- | --- |
| Groq | 8,000 tokens/minute, 200,000 tokens/day, 1,000 requests/day for this model | An analysis uses about 13,000–17,000 tokens, so it takes 45–90 s (part of it waiting for the per-minute allowance) and the **whole deployment** can run roughly 12–15 analyses a day. When the allowance is spent, users see a clear "usage limit reached" message. |
| Render | 512 MB RAM, 0.1 CPU, sleeps after 15 minutes without traffic, about a minute to wake, 750 instance-hours a month, ephemeral disk | The first request after a quiet period is slow; the frontend shows a "waking up the server" state. Upload and row limits are lowered (below). Nothing durable is written to the instance's disk. |
| Supabase | 500 MB database, 1 GB file storage, 50 MB per file, project paused after a week without database activity | The daily health-check workflow queries the database, which prevents pausing. |
| Vercel | Hobby plan is for non-commercial use; 120 s proxy timeout | Fine for a personal deployment. A commercial launch needs the Pro plan. |

`render.yaml` sets conservative limits for the 512 MB instance: 10 MB uploads, 150,000 rows,
a 64 MB dataset cache and one worker. Measured locally, the API idles at about 200 MB and
peaked near 355 MB while ingesting and analysing a 250,000-row, nine-column CSV (13.6 MB).

## What you need

Accounts on GitHub (the repository is already there), Supabase, Render, Vercel and Groq.
None of these steps can be done from the repository alone, because each needs you to sign in.

## Steps

### 1. Supabase: database and storage

1. Create a project. Choose a region close to your users (and to the Render region) and set
   a database password. Under **Security**, untick **Enable Data API**: the backend connects
   to Postgres directly, and leaving the Data API on would expose its tables through the
   project's public key. Ticking **Enable automatic RLS** as well is harmless, because the
   backend connects as the tables' owner.
2. **Database URL.** Open **Connect** and copy the **Session pooler** connection string. It
   looks like
   `postgresql://postgres.<project-ref>:<password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres`.
   Use the pooler, not the direct connection: on the free plan the direct connection is
   IPv6-only and Render connects over IPv4.
3. **Bucket.** In **Storage**, create a bucket named `datasets`. Leave it **private**.
4. **S3 credentials.** In the storage settings, enable the S3 connection and create an access
   key. Note the access key id, the secret, the endpoint
   (`https://<project-ref>.storage.supabase.co/storage/v1/s3`) and the region shown there.

These S3 keys bypass Supabase's row-level security. They belong only in the backend's
environment.

### 2. Render: the API

1. **New → Blueprint**, choose this repository. Render reads `render.yaml`.
2. Enter the values it asks for:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the session pooler string from step 1 |
   | `GROQ_API_KEY` | your Groq key |
   | `S3_ENDPOINT_URL`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from step 1 |
   | `FRONTEND_ORIGINS` | `https://example.invalid` for now; corrected in step 4 |
   | `PROXY_SHARED_SECRET` | a random string of 32+ characters, for example from `python -c "import secrets; print(secrets.token_urlsafe(36))"`; the frontend gets the same value in step 3 |

   `SECRET_KEY` is generated by Render. The container runs `alembic upgrade head` before it
   starts serving, so the schema is created on first deploy.
3. When the deploy finishes, open `https://<your-service>.onrender.com/ready`. Expect
   `{"status":"ready","checks":{"database":"ok","storage":"ok","llm":"ok"}}`. A `failed`
   entry names the dependency whose settings to recheck; the service log has the detail.

### 3. Vercel: the frontend

1. **Add New → Project**, import this repository.
2. Set **Root Directory** to `frontend`.
3. Add environment variables:

   | Variable | Value |
   | --- | --- |
   | `BACKEND_URL` | `https://<your-service>.onrender.com` |
   | `NEXT_PUBLIC_API_DIRECT_URL` | the same URL (used for direct file uploads) |
   | `PROXY_SHARED_SECRET` | the same value as on Render |

4. Deploy and note the URL, for example `https://<project>.vercel.app`.

### 4. Connect the two

In Render, set `FRONTEND_ORIGINS` to the exact Vercel URL (no trailing slash) and let the
service redeploy. This is the only origin allowed to upload files directly to the API.

### 5. Verify production

```bash
pip install httpx
python backend/scripts/smoke_test.py --base-url https://<project>.vercel.app
```

The script registers two throwaway accounts through the frontend's proxy, uploads a dataset,
runs one real analysis, checks the report and all four export formats, signs out and back in,
confirms the second account cannot reach the first account's data, and deletes both accounts.
It exits non-zero if any step fails. Add `--skip-analysis` to check everything except the
model call.

Then check the interface itself in a real browser (Chrome or Edge; set `BROWSER_PATH` if it
is not found):

```bash
cd frontend
BASE_URL=https://<project>.vercel.app npm run e2e
```

Screenshots of every page are saved in `frontend/e2e/output/`.

### 6. Turn on the scheduled health check

In the GitHub repository, **Settings → Secrets and variables → Actions → Variables**, add
`BACKEND_URL` and `FRONTEND_URL`. The **Production health check** workflow then runs daily,
fails visibly if the API is not ready, and keeps the Supabase project from pausing. It can
also be run by hand with the full smoke test.

## Configuration reference

All settings are environment variables; `backend/.env.example` lists them with comments.
The ones that matter in production:

| Variable | Purpose |
| --- | --- |
| `ENVIRONMENT` | `production` enables secure cookies, HSTS and the startup safety checks. |
| `SECRET_KEY` | Signs upload tickets. At least 32 random characters. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `STORAGE_BACKEND`, `S3_*` | Object storage. Production requires `s3`. |
| `GROQ_API_KEY`, `GROQ_MODEL` | Model access. |
| `LLM_REQUEST_TOKEN_BUDGET` | Largest request the model plan accepts (7,600 for Groq's free tier). |
| `FRONTEND_ORIGINS` | Origins allowed to upload directly (CORS). |
| `PROXY_SHARED_SECRET` | Set to the same value on Render and Vercel. The frontend's proxy stamps forwarded sign-in and registration requests with the visitor's address (from Vercel's edge) and this secret. The API uses that address for its per-address limit, and **refuses sign-in and registration that do not carry a valid stamp** (403 `proxy_required`), so those go through the frontend only. Every other route, including direct uploads, is unaffected. |
| `TRUSTED_PROXY_HOPS` | How many `X-Forwarded-For` entries, counted from the right, were added by proxies you trust. Used for the per-address limit only when no `PROXY_SHARED_SECRET` is set. `render.yaml` sets 0. Measured on the live deployment: Render's edge keeps whatever `X-Forwarded-For` the caller sent, and with 1 or 2 hops a caller could still change or spread the address used; Vercel does not add the visitor's address when it proxies to the API. Hence the shared secret. |
| `MAX_UPLOAD_MB`, `MAX_ROWS`, `FRAME_CACHE_MB`, `WORKER_CONCURRENCY` | Sized to the instance. |
| `DAILY_ANALYSIS_LIMIT` | Per-user analyses per 24 hours. |
| `SENTRY_DSN` | Optional error tracking. |

The application refuses to start in production with a default `SECRET_KEY`, a SQLite database
or local-disk storage.

## Migrations

```bash
cd backend
alembic upgrade head                               # apply
alembic revision --autogenerate -m "describe it"   # after changing models
alembic check                                      # fails if models and migrations differ
```

The container applies migrations on start. CI applies them to a fresh PostgreSQL, runs
`alembic check`, and downgrades to base.

## Upgrade path

| When | Move to | Change needed |
| --- | --- | --- |
| Cold starts hurt, or files are too large | Render Starter (always on), or any container host | Remove the lowered limits in `render.yaml`. |
| More than about a dozen analyses a day | Groq Developer tier | Raise `LLM_REQUEST_TOKEN_BUDGET`, `DAILY_ANALYSIS_LIMIT`, `WORKER_CONCURRENCY`. |
| Database or storage quota | Supabase Pro, Neon, R2, S3 | Change `DATABASE_URL` or the `S3_*` settings. No data-format change. |
| Commercial use | Vercel Pro | None in the code. |
| Several API instances | Add Redis | Swap the in-process rate limiter (see ARCHITECTURE.md). Run the worker as a separate service. |

## Rollback

Render and Vercel each keep previous deployments and can redeploy one from their dashboards.
The single migration creates the schema; for a later migration that must be undone, run
`alembic downgrade -1` against the production `DATABASE_URL` before redeploying the older
image.
