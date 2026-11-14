# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY migrations ./migrations
COPY app ./app

# Run as an unprivileged user; the application never writes to its own directory.
RUN useradd --system --uid 10001 --no-create-home appuser
USER appuser

ENV ENVIRONMENT=production \
    PORT=8000
EXPOSE 8000

# Migrations run before the server starts, so a deploy never serves requests against an old
# schema. One process: the job queue is coordinated through the database, and the free-tier
# host provides a single small instance.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --timeout-keep-alive 75"]
