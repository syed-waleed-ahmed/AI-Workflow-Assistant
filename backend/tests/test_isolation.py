"""Tenant isolation: one user must never see, change or learn about another user's resources.

Every route that takes a resource id is exercised as the wrong user. The expected answer is 404,
identical to a resource that does not exist, so ids cannot be probed.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.db import session_scope
from app.models import Analysis, Dataset, Report
from app.workers.analysis_worker import worker


@pytest.fixture
def alice_resources(alice, sales_csv, scripted) -> dict[str, str]:
    """Alice owns a dataset, a completed analysis and a report."""
    scripted()
    dataset_id = alice.upload(sales_csv).json()["id"]
    analysis_id = alice.post("/analyses", json={"dataset_id": dataset_id, "question": "Which region leads?"}).json()[
        "id"
    ]
    worker.process_next()
    report_id = alice.get(f"/analyses/{analysis_id}").json()["messages"][1]["report_id"]
    return {"dataset": dataset_id, "analysis": analysis_id, "report": report_id}


def cross_user_requests(ids: dict[str, str]) -> list[tuple[str, str, dict | None, dict | None]]:
    d, a, r = ids["dataset"], ids["analysis"], ids["report"]
    return [
        ("GET", f"/datasets/{d}", None, None),
        ("GET", f"/datasets/{d}/preview", None, None),
        ("GET", f"/datasets/{d}/suggestions", None, None),
        ("PATCH", f"/datasets/{d}", {"name": "stolen"}, None),
        ("DELETE", f"/datasets/{d}", None, None),
        ("POST", "/analyses", {"dataset_id": d, "question": "What is in this data?"}, None),
        ("GET", f"/analyses/{a}", None, None),
        ("GET", f"/analyses/{a}/events", None, None),
        ("POST", f"/analyses/{a}/messages", {"question": "Tell me more about it"}, None),
        ("POST", f"/analyses/{a}/cancel", None, None),
        ("DELETE", f"/analyses/{a}", None, None),
        ("GET", f"/reports/{r}", None, None),
        ("GET", f"/reports/{r}/export", None, {"format": "md"}),
        ("GET", f"/reports/{r}/export", None, {"format": "pdf"}),
        ("GET", f"/reports/{r}/export", None, {"format": "xlsx"}),
        ("GET", f"/reports/{r}/export", None, {"format": "csv", "evidence_id": "E1"}),
        ("DELETE", f"/reports/{r}", None, None),
    ]


def test_other_user_gets_404_on_every_resource_route(alice_resources, bob):
    for method, path, body, params in cross_user_requests(alice_resources):
        response = bob.request(method, path, json=body, params=params)
        assert response.status_code == 404, f"{method} {path} returned {response.status_code}"
        payload = response.text
        assert "8200" not in payload and "revenue" not in payload.lower(), f"{method} {path} leaked data"


def test_not_found_is_indistinguishable_from_forbidden(alice_resources, bob):
    """The response for someone else's resource matches the response for a random id."""
    real = bob.get(f"/datasets/{alice_resources['dataset']}").json()["error"]
    fake = bob.get(f"/datasets/{uuid.uuid4()}").json()["error"]
    assert (real["code"], real["message"]) == (fake["code"], fake["message"])
    real = bob.get(f"/reports/{alice_resources['report']}").json()["error"]
    fake = bob.get(f"/reports/{uuid.uuid4()}").json()["error"]
    assert (real["code"], real["message"]) == (fake["code"], fake["message"])


def test_anonymous_requests_get_401_on_every_resource_route(alice_resources, anon):
    for method, path, body, params in cross_user_requests(alice_resources):
        response = anon.request(method, path, json=body, params=params)
        assert response.status_code == 401, f"{method} {path} returned {response.status_code}"
    for path in ("/datasets", "/analyses", "/reports", "/users/me/usage", "/auth/me"):
        assert anon.get(path).status_code == 401


def test_lists_and_usage_only_include_own_resources(alice_resources, alice, bob):
    for path in ("/datasets", "/analyses", "/reports"):
        assert alice.get(path).json()["total"] == 1
        body = bob.get(path).json()
        assert body == {"items": [], "total": 0}
    usage = bob.get("/users/me/usage").json()
    assert (
        usage["datasets"] == 0
        and usage["reports"] == 0
        and usage["analyses_total"] == 0
        and usage["storage_used_bytes"] == 0
    )


def test_filtering_a_list_by_someone_elses_dataset_returns_nothing(alice_resources, bob):
    assert bob.get("/analyses", params={"dataset_id": alice_resources["dataset"]}).json()["total"] == 0


def test_failed_cross_user_attempts_change_nothing(alice_resources, alice, bob):
    for method, path, body, params in cross_user_requests(alice_resources):
        bob.request(method, path, json=body, params=params)
    dataset = alice.get(f"/datasets/{alice_resources['dataset']}").json()
    assert dataset["name"] == "sales"
    assert alice.get(f"/analyses/{alice_resources['analysis']}").json()["status"] == "completed"
    assert alice.get(f"/reports/{alice_resources['report']}").status_code == 200
    with session_scope() as db:
        assert len(db.scalars(select(Dataset)).all()) == 1
        assert len(db.scalars(select(Analysis)).all()) == 1
        assert len(db.scalars(select(Report)).all()) == 1


def test_deleting_one_account_leaves_other_accounts_intact(alice_resources, alice, bob, sales_csv):
    from tests.conftest import PASSWORD

    bob_dataset = bob.upload(sales_csv, "bobs.csv").json()["id"]
    assert bob.post("/users/me/delete", json={"password": PASSWORD}).status_code == 204
    assert alice.get(f"/datasets/{alice_resources['dataset']}/preview").status_code == 200
    assert alice.get(f"/reports/{alice_resources['report']}").status_code == 200
    with session_scope() as db:
        assert db.get(Dataset, uuid.UUID(bob_dataset)) is None


def test_storage_keys_are_namespaced_by_owner(alice, bob, sales_csv):
    alice_id, bob_id = alice.get("/auth/me").json()["id"], bob.get("/auth/me").json()["id"]
    alice.upload(sales_csv)
    bob.upload(sales_csv)
    with session_scope() as db:
        keys = {str(dataset.user_id): dataset.storage_key for dataset in db.scalars(select(Dataset))}
    assert keys[alice_id].startswith(f"datasets/{alice_id}/") and keys[bob_id].startswith(f"datasets/{bob_id}/")


def test_a_run_only_ever_sees_its_own_dataset(alice, bob, sales_csv, scripted):
    """The worker binds tools to the analysis's dataset; another user's data cannot enter the run."""
    other = b"region,revenue\nSECRET-REGION,999999\n"
    bob.upload(other, "bobs-secret.csv")
    gateway = scripted()
    dataset_id = alice.upload(sales_csv).json()["id"]
    alice.post("/analyses", json={"dataset_id": dataset_id, "question": "Which region leads?"})
    worker.process_next()
    everything_sent = " ".join(str(m.content) for request in gateway.chat_requests for m in request)
    everything_sent += " ".join(str(m.content) for _, request in gateway.structured_requests for m in request)
    assert "SECRET-REGION" not in everything_sent and "999999" not in everything_sent
    assert "8200" in everything_sent
