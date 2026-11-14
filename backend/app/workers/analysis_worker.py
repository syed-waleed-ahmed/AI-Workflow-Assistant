"""Background execution of analysis turns.

The job queue is the `analyses` table itself: a turn is queued by setting `status = 'queued'`,
claimed with a conditional UPDATE (so two workers can never take the same job), and reports
progress by inserting `analysis_events` rows that the client polls.

Worker threads run inside the API process. That is deliberate for the free-tier deployment
target, which offers a single small instance and no separate worker service or message broker.
Because all coordination goes through the database, the same class can run in a dedicated
process, or in several, without changes.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from sqlalchemy import select, update

from app.agents.llm import (
    DeadlineExceeded,
    GroqGateway,
    LLMError,
    ModelGateway,
    RunCancelled,
    RunControl,
)
from app.agents.runner import RunResult, run_analysis
from app.agents.state import AnalysisFailed, RunDeps, RunLimits
from app.core.config import get_settings
from app.core.db import session_scope, utcnow
from app.core.exceptions import AppError
from app.core.logging import analysis_id_var
from app.models import Analysis, AnalysisEvent, AnalysisMessage, AnalysisStatus, Dataset, Report, UsageRecord
from app.services import dataset_service

logger = logging.getLogger(__name__)

POLL_SECONDS = 5.0
STALE_AFTER_SECONDS = 240
MAX_ATTEMPTS = 2
CANCEL_CHECK_SECONDS = 1.5


def _default_gateway() -> ModelGateway:
    return GroqGateway(get_settings())


class AnalysisWorker:
    def __init__(self, gateway_factory: Callable[[], ModelGateway] = _default_gateway):
        self.gateway_factory = gateway_factory
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._threads: list[threading.Thread] = []

    # ------------------------------------------------------------------ lifecycle
    def start(self, concurrency: int) -> None:
        if self._threads:
            return
        self._stop.clear()
        for index in range(max(1, concurrency)):
            thread = threading.Thread(target=self._loop, name=f"analysis-worker-{index}", daemon=True)
            thread.start()
            self._threads.append(thread)
        logger.info("analysis worker started", extra={"concurrency": len(self._threads)})

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        self._wake.set()
        for thread in self._threads:
            thread.join(timeout)
        self._threads.clear()

    def notify(self) -> None:
        """Wake the worker immediately after a job has been queued."""
        self._wake.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.recover_stale()
                if self.process_next():
                    continue
            except Exception:
                logger.exception("analysis worker iteration failed")
            self._wake.wait(POLL_SECONDS)
            self._wake.clear()

    # ------------------------------------------------------------------ queue
    def recover_stale(self) -> None:
        """Requeue (once) or fail jobs whose worker died, e.g. when the host restarted."""
        cutoff = utcnow() - timedelta(seconds=STALE_AFTER_SECONDS)
        with session_scope() as db:
            stale = db.scalars(
                select(Analysis).where(Analysis.status == AnalysisStatus.RUNNING.value, Analysis.heartbeat_at < cutoff)
            ).all()
            for analysis in stale:
                if analysis.attempts < MAX_ATTEMPTS and not analysis.cancel_requested:
                    analysis.status = AnalysisStatus.QUEUED.value
                    logger.warning("requeueing interrupted analysis", extra={"analysis_id": str(analysis.id)})
                else:
                    analysis.status = AnalysisStatus.FAILED.value
                    analysis.finished_at = utcnow()
                    analysis.error = "The analysis was interrupted by a server restart. Please run it again."
                    logger.warning("failing interrupted analysis", extra={"analysis_id": str(analysis.id)})

    def _claim(self) -> uuid.UUID | None:
        with session_scope() as db:
            candidate = db.scalar(
                select(Analysis.id)
                .where(Analysis.status == AnalysisStatus.QUEUED.value)
                .order_by(Analysis.queued_at)
                .limit(1)
            )
            if candidate is None:
                return None
            now = utcnow()
            claimed = db.execute(
                update(Analysis)
                .where(Analysis.id == candidate, Analysis.status == AnalysisStatus.QUEUED.value)
                .values(
                    status=AnalysisStatus.RUNNING.value,
                    started_at=now,
                    heartbeat_at=now,
                    attempts=Analysis.attempts + 1,
                )
            )
            return candidate if claimed.rowcount else None  # type: ignore[attr-defined]

    def process_next(self) -> bool:
        """Claim and run one queued turn. Returns False when the queue is empty."""
        analysis_id = self._claim()
        if analysis_id is None:
            return False
        token = analysis_id_var.set(str(analysis_id))
        try:
            self._run(analysis_id)
        finally:
            analysis_id_var.reset(token)
        return True

    # ------------------------------------------------------------------ execution
    def _run(self, analysis_id: uuid.UUID) -> None:
        settings = get_settings()
        started = time.monotonic()
        gateway: ModelGateway | None = None
        deps: RunDeps | None = None
        outcome, error = AnalysisStatus.FAILED.value, "Something went wrong while running the analysis."
        result: RunResult | None = None

        with session_scope() as db:
            analysis = db.get(Analysis, analysis_id)
            assert analysis is not None
            turn, user_id = analysis.turn, analysis.user_id
            dataset = db.get(Dataset, analysis.dataset_id) if analysis.dataset_id else None
            messages = db.scalars(
                select(AnalysisMessage)
                .where(AnalysisMessage.analysis_id == analysis_id)
                .order_by(AnalysisMessage.created_at)
            ).all()
            question = next((m.content for m in reversed(messages) if m.role == "user" and m.turn == turn), "")
            answers = {m.turn: m.content for m in messages if m.role == "assistant"}
            history = [
                {"question": m.content, "answer": answers[m.turn]}
                for m in messages
                if m.role == "user" and m.turn < turn and m.turn in answers
            ]
            dataset_name = analysis.dataset_name
            profile: dict[str, Any] = dict(dataset.profile) if dataset else {}

        last_cancel_check = 0.0
        cancelled = False

        def is_cancelled() -> bool:
            nonlocal last_cancel_check, cancelled
            if cancelled or time.monotonic() - last_cancel_check < CANCEL_CHECK_SECONDS:
                return cancelled
            last_cancel_check = time.monotonic()
            with session_scope() as db:
                cancelled = bool(db.scalar(select(Analysis.cancel_requested).where(Analysis.id == analysis_id)))
            return cancelled

        def emit(kind: str, label: str, detail: dict[str, Any] | None) -> None:
            with session_scope() as db:
                db.add(AnalysisEvent(analysis_id=analysis_id, turn=turn, kind=kind, label=label[:300], detail=detail))
                db.execute(update(Analysis).where(Analysis.id == analysis_id).values(heartbeat_at=utcnow()))

        try:
            if dataset is None:
                raise AnalysisFailed("The dataset for this analysis has been deleted.")
            emit("status", "Loading the dataset", None)
            frame = dataset_service.load_frame(dataset)
            gateway = self.gateway_factory()
            deps = RunDeps(
                question=question,
                dataset_name=dataset_name,
                frame=frame,
                profile=profile,
                history=history,
                gateway=gateway,
                control=RunControl(
                    deadline=time.monotonic() + settings.analysis_timeout_seconds,
                    is_cancelled=is_cancelled,
                    on_wait=lambda seconds: emit(
                        "status",
                        f"Waiting about {seconds:.0f}s for AI model capacity",
                        {"wait_seconds": round(seconds)},
                    ),
                ),
                limits=RunLimits(
                    max_tool_calls=settings.max_tool_calls,
                    max_agent_rounds=settings.max_agent_rounds,
                    request_token_budget=settings.llm_request_token_budget,
                ),
                emit=emit,
            )
            result = run_analysis(deps)
            outcome, error = AnalysisStatus.COMPLETED.value, ""
        except RunCancelled:
            outcome, error = AnalysisStatus.CANCELLED.value, "Cancelled."
        except DeadlineExceeded:
            minutes = settings.analysis_timeout_seconds // 60
            error = f"The analysis exceeded the {minutes}-minute time limit. Try a narrower question."
        except (AnalysisFailed, LLMError) as exc:
            error = str(exc)
        except AppError as exc:
            error = exc.message
        except Exception:
            logger.exception("analysis crashed")

        duration_ms = int((time.monotonic() - started) * 1000)
        usage = gateway.usage if gateway else None
        with session_scope() as db:
            analysis = db.get(Analysis, analysis_id)
            assert analysis is not None
            analysis.status = outcome
            analysis.finished_at = utcnow()
            analysis.error = error or None
            analysis.cancel_requested = False
            if result is not None:
                report = Report(
                    user_id=user_id,
                    analysis_id=analysis_id,
                    turn=turn,
                    title=result.report.title,
                    dataset_name=dataset_name,
                    question=question[:2000],
                    content=result.report.model_dump(mode="json"),
                )
                db.add(report)
                db.flush()
                db.add(
                    AnalysisMessage(
                        analysis_id=analysis_id,
                        turn=turn,
                        role="assistant",
                        content=result.report.executive_summary,
                        report_id=report.id,
                    )
                )
                if turn == 1:
                    analysis.title = result.report.title[:200]
            db.add(
                UsageRecord(
                    user_id=user_id,
                    analysis_id=analysis_id,
                    outcome=outcome,
                    llm_calls=usage.llm_calls if usage else 0,
                    tool_calls=deps.tool_calls if deps else 0,
                    total_tokens=usage.total_tokens if usage else 0,
                    duration_ms=duration_ms,
                )
            )
        logger.info(
            "analysis finished",
            extra={
                "outcome": outcome,
                "turn": turn,
                "duration_ms": duration_ms,
                "llm_calls": usage.llm_calls if usage else 0,
                "tool_calls": deps.tool_calls if deps else 0,
                "total_tokens": usage.total_tokens if usage else 0,
            },
        )


worker = AnalysisWorker()
