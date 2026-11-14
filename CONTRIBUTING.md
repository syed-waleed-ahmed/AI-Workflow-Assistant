# Contributing

## Setup

See the README for running the backend and frontend locally.

## Before opening a pull request

Run the same checks CI runs.

```bash
# backend/
ruff check app tests scripts
ruff format --check app tests scripts
mypy
pytest

# frontend/
npm run lint
npm run format:check
npm run typecheck
npm run test
npm run build
```

## Conventions

- **Numbers come from tools.** Anything a report states as a figure must be produced by a
  function in `backend/app/tools`. Do not add code paths where the model computes or supplies
  a value that is then shown as fact.
- **New analytical tool.** Add a pure function in `app/tools` that takes a DataFrame and
  returns a `ToolResult`; register it in `app/agents/toolkit.py` with an argument schema, a
  one-line catalogue entry and a progress label; add tests that compare its output with a hand
  calculation. Tools must not accept paths, URLs or code, and must not modify the DataFrame
  they are given.
- **User-owned data.** Every query for a user-owned resource filters on the user id in the
  service layer and returns 404 for someone else's resource. Add the route to
  `tests/test_isolation.py`.
- **Schema changes.** Change the models, then `alembic revision --autogenerate`, and read the
  generated migration before committing it.
- **API changes.** Regenerate `docs/openapi.json` and the frontend types:

  ```bash
  cd backend && python -c "import json; from app.main import app; open('../docs/openapi.json','w').write(json.dumps(app.openapi(), indent=2))"
  cd ../frontend && npm run gen:api
  ```

- **Tests do not call the model.** Use the scripted gateway in `tests/conftest.py`. Tests
  that need the real Groq API are marked `live` and run only with
  `LIVE_GROQ_API_KEY=... pytest -m live`.
- **Secrets** never go in the repository, in logs or in error messages.
