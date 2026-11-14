# AI Workflow Assistant — frontend

Next.js (App Router) client for the AI Workflow Assistant API in `../backend`.

## Run it

```bash
npm install
cp .env.example .env.local   # optional; the defaults work for local development
npm run dev                  # http://localhost:3000, expects the API on http://localhost:8000
```

The browser only talks to this origin. `next.config.ts` rewrites `/api/*` to `BACKEND_URL`, so
the session cookies set by the API are first-party.

| Variable                     | Purpose                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKEND_URL`                | Where `/api/*` is proxied to. Default `http://localhost:8000`.                                                                                        |
| `NEXT_PUBLIC_API_DIRECT_URL` | Optional. When set, dataset uploads go straight to this origin with a short-lived upload ticket instead of through the proxy (hosts limit body size). |

## Scripts

| Script                            | What it does                                                      |
| --------------------------------- | ----------------------------------------------------------------- |
| `npm run dev` / `build` / `start` | Next.js development server, production build, production server   |
| `npm run lint`                    | ESLint (Next.js config), zero warnings allowed                    |
| `npm run typecheck`               | Generates route types, then `tsc --noEmit`                        |
| `npm run test`                    | Vitest + React Testing Library (jsdom)                            |
| `npm run format` / `format:check` | Prettier                                                          |
| `npm run gen:api`                 | Regenerates `src/lib/api/schema.d.ts` from `../docs/openapi.json` |

The scripts call the tools through `node` rather than the `node_modules/.bin` shims. On
Windows those shims break when the project path contains `&`, which this repository's path
can.

## Layout

- `src/app` — routes. `/` is public; `/login` and `/register`; everything under `/app` is the signed-in product.
- `src/proxy.ts` — route guard (Next.js 16 renamed `middleware.ts` to `proxy.ts`). It only checks that the session cookie exists; the API enforces authentication.
- `src/lib/api` — the API client (`apiFetch`, `ApiError`), generated types, upload and download helpers.
- `src/lib/query` — TanStack Query hooks, including the analysis progress polling.
- `src/components` — UI primitives (`ui/`), and feature components for datasets, analyses, reports, the dashboard and settings.
- `src/data/sample-report.json` — a real report produced by the backend for `public/samples/sample_sales.csv`; shown on the landing page and used as a test fixture.
