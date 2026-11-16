"""The analysis job lifecycle through the HTTP API and the background worker."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.agents.llm import LLMError
from app.core.db import session_scope, utcnow
from app.models import Analysis, AnalysisEvent, Report, UsageRecord
from app.workers.analysis_worker import STALE_AFTER_SECONDS, worker
from tests.conftest import AGGREGATE_BY_REGION, DONE, batch, simple_draft

QUESTION = "Which region has the most revenue?"


@pytest.fixture
def dataset_id(alice, sales_csv) -> str:
    return alice.upload(sales_csv).json()["id"]


def start(client, dataset_id: str, question: str = QUESTION):
    return client.post("/analyses", json={"dataset_id": dataset_id, "question": question})


def test_full_turn_from_queue_to_persisted_report(alice, dataset_id, scripted):
    gateway = scripted()
    created = start(alice, dataset_id)
    assert created.status_code == 202
    analysis = created.json()
    assert analysis["status"] == "queued" and analysis["turn"] == 1
    assert [m["role"] for m in analysis["messages"]] == ["user"]

    assert worker.process_next() is True
    assert worker.process_next() is False  # queue drained

    done = alice.get(f"/analyses/{analysis['id']}").json()
    assert done["status"] == "completed" and done["error"] is None and done["title"] == "Regional revenue"
    assert done["started_at"] and done["finished_at"]
    assistant = done["messages"][1]
    assert (
        assistant["role"] == "assistant" and assistant["content"] == "NA leads on revenue." and assistant["report_id"]
    )

    report = alice.get(f"/reports/{assistant['report_id']}").json()
    assert report["question"] == QUESTION and report["dataset_name"] == "sales"
    content = report["content"]
    assert content["methodology"][0]["table"]["rows"][0][:3] == ["NA", 5, 8200]
    assert content["visualizations"][0]["chart"]["type"] == "bar"
    assert content["verification"]["status"] == "verified"

    with session_scope() as db:
        usage = db.scalar(select(UsageRecord))
        assert usage.outcome == "completed" and usage.tool_calls == 1 and usage.llm_calls == gateway.usage.llm_calls
        assert usage.total_tokens == gateway.usage.total_tokens and usage.duration_ms >= 0
    assert alice.get("/users/me/usage").json()["analyses_today"] == 1


def test_progress_events_can_be_polled_incrementally(alice, dataset_id, scripted):
    scripted()
    analysis_id = start(alice, dataset_id).json()["id"]
    before = alice.get(f"/analyses/{analysis_id}/events").json()
    assert before["status"] == "queued" and before["events"] == []

    worker.process_next()
    body = alice.get(f"/analyses/{analysis_id}/events").json()
    labels = [event["label"] for event in body["events"]]
    assert body["status"] == "completed"
    assert labels[0] == "Loading the dataset" and "Planning the analysis" in labels
    assert "Calculating sum of revenue by region" in labels and labels[-1].startswith("All ")
    plan_event = next(event for event in body["events"] if event["kind"] == "plan")
    assert plan_event["detail"]["steps"] == ["Aggregate revenue by region"]
    tool_events = [event for event in body["events"] if event["kind"] == "tool"]
    assert [event["detail"]["state"] for event in tool_events] == ["running", "done"]

    midpoint = body["events"][3]["id"]
    later = alice.get(f"/analyses/{analysis_id}/events", params={"after": midpoint}).json()["events"]
    assert [event["id"] for event in later] == [event["id"] for event in body["events"][4:]]


def test_follow_up_turn_carries_history_and_gets_its_own_report(alice, dataset_id, scripted):
    scripted()
    analysis_id = start(alice, dataset_id).json()["id"]
    worker.process_next()

    gateway = scripted(drafts=[simple_draft(summary="APAC is last with 3750.", title="Lowest region")])
    follow_up = alice.post(f"/analyses/{analysis_id}/messages", json={"question": "And which region is last?"})
    assert follow_up.status_code == 202 and follow_up.json()["turn"] == 2 and follow_up.json()["status"] == "queued"
    worker.process_next()

    opening = gateway.chat_requests[0][1].content
    assert "Earlier question: Which region has the most revenue?" in opening and "NA leads on revenue." in opening

    done = alice.get(f"/analyses/{analysis_id}").json()
    assert [(m["turn"], m["role"]) for m in done["messages"]] == [
        (1, "user"),
        (1, "assistant"),
        (2, "user"),
        (2, "assistant"),
    ]
    assert done["title"] == "Regional revenue"  # the conversation keeps its first title
    assert alice.get("/reports").json()["total"] == 2
    # Polling shows only the current turn's events.
    events = alice.get(f"/analyses/{analysis_id}/events").json()
    assert events["turn"] == 2 and {event["turn"] for event in events["events"]} == {2}


def test_only_one_active_analysis_per_user(alice, bob, dataset_id, sales_csv, scripted):
    scripted()
    first = start(alice, dataset_id).json()
    second = start(alice, dataset_id)
    assert second.status_code == 409 and second.json()["error"]["code"] == "analysis_in_progress"
    assert alice.post(f"/analyses/{first['id']}/messages", json={"question": "more please"}).status_code == 409
    # Another user is not blocked by Alice's job.
    assert start(bob, bob.upload(sales_csv).json()["id"]).status_code == 202


def test_daily_limit(alice, dataset_id, scripted, settings):
    settings.daily_analysis_limit = 2
    scripted()
    for _ in range(2):
        assert start(alice, dataset_id).status_code == 202
        worker.process_next()
    blocked = start(alice, dataset_id)
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "daily_limit_reached"
    # The limit is a rolling 24-hour window.
    with session_scope() as db:
        for record in db.scalars(select(UsageRecord)):
            record.created_at = utcnow() - timedelta(hours=25)
    assert start(alice, dataset_id).status_code == 202


def test_question_validation(alice, dataset_id):
    assert start(alice, dataset_id, "  a ").status_code == 422
    assert start(alice, dataset_id, "x" * 2001).status_code == 422
    assert alice.post("/analyses", json={"dataset_id": "not-a-uuid", "question": QUESTION}).status_code == 422
    assert start(alice, str(uuid.uuid4())).status_code == 404


def test_cancel_a_queued_analysis(alice, dataset_id, scripted):
    scripted()
    analysis_id = start(alice, dataset_id).json()["id"]
    cancelled = alice.post(f"/analyses/{analysis_id}/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert worker.process_next() is False  # nothing left to run
    assert alice.get("/users/me/usage").json()["analyses_today"] == 0  # never reached the model
    assert start(alice, dataset_id).status_code == 202  # and does not block the next one


def test_cancel_a_running_analysis(alice, dataset_id, scripted, monkeypatch):
    # The worker re-reads the cancel flag at most every 1.5 s; a scripted run is faster than that.
    monkeypatch.setattr("app.workers.analysis_worker.CANCEL_CHECK_SECONDS", 0)

    def request_cancel(_control) -> None:
        response = alice.post(f"/analyses/{analysis_id}/cancel")
        assert response.status_code == 200
        with session_scope() as db:  # the worker re-reads the flag at its next checkpoint
            assert db.get(Analysis, uuid.UUID(analysis_id)).cancel_requested is True

    scripted(chat=[batch(AGGREGATE_BY_REGION), DONE], on_chat=request_cancel)
    analysis_id = start(alice, dataset_id).json()["id"]
    worker.process_next()
    done = alice.get(f"/analyses/{analysis_id}").json()
    assert done["status"] == "cancelled" and done["error"] == "Cancelled."
    assert alice.get("/reports").json()["total"] == 0


def test_failed_analysis_reports_a_safe_error(alice, dataset_id, scripted):
    scripted(chat=[DONE])  # the model never computes anything
    analysis_id = start(alice, dataset_id).json()["id"]
    worker.process_next()
    done = alice.get(f"/analyses/{analysis_id}").json()
    assert done["status"] == "failed" and "could not compute results" in done["error"]
    assert alice.get(f"/analyses/{analysis_id}/events").json()["error"] == done["error"]
    assert alice.post(f"/analyses/{analysis_id}/messages", json={"question": "try again please"}).status_code == 202


def test_model_outage_fails_the_turn_without_leaking_details(alice, dataset_id):
    def unavailable():
        raise LLMError("The AI model could not be reached. Please try again.")

    worker.gateway_factory = unavailable
    analysis_id = start(alice, dataset_id).json()["id"]
    worker.process_next()
    done = alice.get(f"/analyses/{analysis_id}").json()
    assert done["status"] == "failed" and done["error"] == "The AI model could not be reached. Please try again."


def test_unexpected_crash_is_reported_generically(alice, dataset_id):
    def crash():
        raise RuntimeError("psycopg.OperationalError: password=hunter2 host=10.0.0.5")

    worker.gateway_factory = crash
    analysis_id = start(alice, dataset_id).json()["id"]
    worker.process_next()
    done = alice.get(f"/analyses/{analysis_id}").json()
    assert done["status"] == "failed" and done["error"] == "Something went wrong while running the analysis."
    assert "hunter2" not in str(done)


def test_deleting_the_dataset_keeps_history_but_blocks_follow_ups(alice, dataset_id, scripted):
    scripted()
    analysis_id = start(alice, dataset_id).json()["id"]
    worker.process_next()
    report_id = alice.get(f"/analyses/{analysis_id}").json()["messages"][1]["report_id"]

    assert alice.delete(f"/datasets/{dataset_id}").status_code == 204
    kept = alice.get(f"/analyses/{analysis_id}").json()
    assert kept["dataset_id"] is None and kept["dataset_name"] == "sales" and kept["status"] == "completed"
    assert alice.get(f"/reports/{report_id}").status_code == 200
    blocked = alice.post(f"/analyses/{analysis_id}/messages", json={"question": "one more thing"})
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "dataset_deleted"


def test_dataset_deleted_while_queued_fails_the_turn(alice, dataset_id, scripted):
    scripted()
    analysis_id = start(alice, dataset_id).json()["id"]
    alice.delete(f"/datasets/{dataset_id}")
    worker.process_next()
    done = alice.get(f"/analyses/{analysis_id}").json()
    assert done["status"] == "failed" and "dataset for this analysis has been deleted" in done["error"]


def test_list_filter_and_delete(alice, dataset_id, sales_csv, scripted):
    scripted()
    other_dataset = alice.upload(sales_csv, "other.csv").json()["id"]
    first = start(alice, dataset_id).json()["id"]
    worker.process_next()
    second = start(alice, other_dataset).json()["id"]

    listing = alice.get("/analyses").json()
    assert listing["total"] == 2 and [item["id"] for item in listing["items"]] == [second, first]
    assert alice.get("/analyses", params={"dataset_id": dataset_id}).json()["total"] == 1
    # The finished analysis links its report; the queued one has none yet.
    first_report = alice.get(f"/analyses/{first}").json()["messages"][1]["report_id"]
    latest = {item["id"]: item["latest_report_id"] for item in listing["items"]}
    assert latest == {first: first_report, second: None}

    assert alice.delete(f"/analyses/{second}").status_code == 409  # still queued
    alice.post(f"/analyses/{second}/cancel")
    assert alice.delete(f"/analyses/{second}").status_code == 204

    assert alice.delete(f"/analyses/{first}").status_code == 204
    with session_scope() as db:  # reports and events go with the conversation
        assert db.scalar(select(Report)) is None and db.scalar(select(AnalysisEvent)) is None
        assert db.scalar(select(UsageRecord)) is not None  # usage history is kept for quotas


def test_two_workers_cannot_claim_the_same_job(alice, dataset_id, scripted):
    scripted()
    start(alice, dataset_id)
    first = worker._claim()
    assert first is not None and worker._claim() is None
    with session_scope() as db:
        analysis = db.get(Analysis, first)
        assert analysis.status == "running" and analysis.attempts == 1


def test_interrupted_job_is_requeued_once_then_failed(alice, dataset_id, scripted):
    scripted()
    analysis_id = uuid.UUID(start(alice, dataset_id).json()["id"])

    def simulate_crash() -> None:
        assert worker._claim() == analysis_id  # a worker took the job and then died
        with session_scope() as db:
            db.get(Analysis, analysis_id).heartbeat_at = utcnow() - timedelta(seconds=STALE_AFTER_SECONDS + 5)
        worker.recover_stale()

    simulate_crash()
    with session_scope() as db:
        assert db.get(Analysis, analysis_id).status == "queued"
    simulate_crash()
    done = alice.get(f"/analyses/{analysis_id}").json()
    assert done["status"] == "failed" and "interrupted by a server restart" in done["error"]


def test_a_live_job_is_not_treated_as_stale(alice, dataset_id, scripted):
    scripted()
    start(alice, dataset_id)
    claimed = worker._claim()
    worker.recover_stale()
    with session_scope() as db:
        assert db.get(Analysis, claimed).status == "running"


def test_jobs_run_oldest_first(alice, bob, dataset_id, sales_csv, scripted):
    scripted()
    first = start(alice, dataset_id).json()["id"]
    second = start(bob, bob.upload(sales_csv).json()["id"]).json()["id"]
    with session_scope() as db:
        db.get(Analysis, uuid.UUID(first)).queued_at = utcnow() - timedelta(minutes=5)
    assert str(worker._claim()) == first and str(worker._claim()) == second
