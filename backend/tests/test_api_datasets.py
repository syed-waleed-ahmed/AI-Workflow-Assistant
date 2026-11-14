"""Dataset upload, profiling, preview, quotas and upload tickets."""

from __future__ import annotations

import time
import uuid

import pandas as pd
import pytest
from sqlalchemy import select

from app.core import security
from app.core.db import session_scope
from app.models import Dataset
from app.services.storage_service import ObjectNotFoundError, get_storage
from tests.conftest import ApiClient, make_xlsx


def test_upload_csv_profiles_and_stores_parquet(alice, sales_csv):
    response = alice.upload(sales_csv, "Q2 sales.csv")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "Q2 sales" and body["file_format"] == "csv"
    assert body["row_count"] == 12 and body["column_count"] == 8 and body["quality_score"] == 100
    kinds = {column["name"]: column["kind"] for column in body["profile"]["columns"]}
    assert kinds["date"] == "datetime" and kinds["revenue"] == "numeric" and kinds["region"] == "categorical"
    revenue = next(column for column in body["profile"]["columns"] if column["name"] == "revenue")
    assert revenue["stats"]["sum"] == 17350 and revenue["stats"]["max"] == 2500

    with session_scope() as db:
        dataset = db.scalar(select(Dataset))
        assert dataset.storage_key == f"datasets/{dataset.user_id}/{dataset.id}.parquet"
        assert get_storage().get(dataset.storage_key)[:4] == b"PAR1"


def test_upload_excel_and_choose_a_sheet(alice, sales):
    workbook = make_xlsx(
        {"Orders": sales, "Lookup": pd.DataFrame({"code": ["NA", "EU"], "name": ["North America", "Europe"]})}
    )
    first = alice.upload(workbook, "book.xlsx")
    assert first.status_code == 409
    error = first.json()["error"]
    assert error["code"] == "sheet_selection_required" and error["details"]["sheets"] == ["Orders", "Lookup"]

    chosen = alice.upload(workbook, "book.xlsx", sheet="Lookup")
    assert chosen.status_code == 201
    body = chosen.json()
    assert body["sheet_name"] == "Lookup" and body["row_count"] == 2 and body["name"] == "book — Lookup"
    assert alice.upload(workbook, "book.xlsx", sheet="Nope").json()["error"]["code"] == "unknown_sheet"


def test_single_sheet_excel_uploads_directly(alice, sales):
    response = alice.upload(make_xlsx({"Data": sales}), "single.xlsx", name="My orders")
    assert (
        response.status_code == 201
        and response.json()["name"] == "My orders"
        and response.json()["file_format"] == "xlsx"
    )


def test_preview_is_paginated(alice, sales_csv):
    dataset_id = alice.upload(sales_csv).json()["id"]
    page = alice.get(f"/datasets/{dataset_id}/preview", params={"limit": 5, "offset": 10}).json()
    assert page["total_rows"] == 12 and page["offset"] == 10 and len(page["rows"]) == 2
    assert page["columns"][0] == "order_id" and page["rows"][0][0] == "O11" and page["rows"][0][1] == "2025-06-08"
    assert alice.get(f"/datasets/{dataset_id}/preview", params={"limit": 500}).status_code == 422


def test_preview_survives_a_cold_cache(alice, sales_csv):
    from app.services.dataset_service import frame_cache

    dataset_id = alice.upload(sales_csv).json()["id"]
    frame_cache.clear()
    assert len(alice.get(f"/datasets/{dataset_id}/preview").json()["rows"]) == 12


def test_list_rename_and_delete(alice, sales_csv):
    first = alice.upload(sales_csv, "a.csv").json()
    alice.upload(sales_csv, "b.csv")
    listing = alice.get("/datasets", params={"limit": 1}).json()
    assert listing["total"] == 2 and len(listing["items"]) == 1 and "profile" not in listing["items"][0]

    renamed = alice.patch(f"/datasets/{first['id']}", json={"name": "../../Renamed <b>"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Renamed _b_"

    with session_scope() as db:
        key = db.get(Dataset, uuid.UUID(first["id"])).storage_key
    assert alice.delete(f"/datasets/{first['id']}").status_code == 204
    assert alice.get(f"/datasets/{first['id']}").status_code == 404
    with pytest.raises(ObjectNotFoundError):
        get_storage().get(key)
    assert alice.get("/datasets").json()["total"] == 1


def test_suggested_questions_use_real_columns(alice, sales_csv):
    dataset_id = alice.upload(sales_csv).json()["id"]
    questions = alice.get(f"/datasets/{dataset_id}/suggestions").json()["questions"]
    assert 2 <= len(questions) <= 5
    assert any("revenue" in question and "region" in question for question in questions)


@pytest.mark.parametrize(
    ("filename", "content", "status", "code"),
    [
        ("malware.exe", b"MZ\x90\x00", 422, "unsupported_file_type"),
        ("notes.pdf", b"%PDF-1.7", 422, "unsupported_file_type"),
        ("fake.xlsx", b"just,text\n1,2\n", 422, "invalid_file"),
        ("binary.csv", b"\x00\x01\x02\x03binary", 422, "invalid_file"),
        ("empty.csv", b"", 422, "empty_file"),
        ("ragged.csv", b"a,b\n1,2\n3,4,5,6\n", 422, "malformed_file"),
    ],
)
def test_bad_uploads_are_rejected_and_nothing_is_stored(alice, filename, content, status, code):
    response = alice.upload(content, filename)
    assert response.status_code == status and response.json()["error"]["code"] == code
    assert alice.get("/datasets").json()["total"] == 0


def test_hostile_filename_never_reaches_storage(alice, sales_csv):
    response = alice.upload(sales_csv, "../../../../etc/cron.d/evil.csv")
    assert response.status_code == 201
    body = response.json()
    assert body["original_filename"] == "evil.csv" and body["name"] == "evil"
    with session_scope() as db:
        key = db.scalar(select(Dataset.storage_key))
    assert ".." not in key and "evil" not in key and key.startswith("datasets/")


def test_oversized_upload_is_rejected(alice, settings):
    settings.max_upload_mb = 1
    big = b"a,b\n" + b"1234567890,abcdefghij\n" * 60_000  # ~1.3 MB
    response = alice.upload(big, "big.csv")
    assert response.status_code == 413 and response.json()["error"]["code"] in ("file_too_large", "payload_too_large")
    assert alice.get("/datasets").json()["total"] == 0


def test_oversized_request_is_refused_from_its_declared_length(alice, settings):
    settings.max_upload_mb = 1
    response = alice.post(
        "/datasets",
        content=b"x",
        headers={"Content-Length": str(50 * 1024 * 1024), "Content-Type": "multipart/form-data; boundary=x"},
    )
    assert response.status_code == 413


def test_row_limit(alice, settings):
    settings.max_rows = 10
    response = alice.upload(b"a\n" + b"1\n" * 30, "rows.csv")
    assert response.status_code == 413 and response.json()["error"]["code"] == "too_many_rows"


def test_dataset_count_quota(alice, sales_csv, settings):
    settings.max_datasets_per_user = 2
    assert alice.upload(sales_csv, "1.csv").status_code == 201
    assert alice.upload(sales_csv, "2.csv").status_code == 201
    blocked = alice.upload(sales_csv, "3.csv")
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "dataset_limit_reached"


def test_storage_quota(alice, sales_csv, settings):
    first = alice.upload(sales_csv, "1.csv").json()
    object.__setattr__(settings, "user_storage_quota_mb", 0)
    settings.user_storage_quota_mb = 0
    blocked = alice.upload(sales_csv, "2.csv")
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "storage_quota_exceeded"
    assert alice.get("/users/me/usage").json()["storage_used_bytes"] == first["stored_size_bytes"]


def test_upload_rate_limit(alice, sales_csv, settings):
    settings.rate_limit_upload_per_minute = 2
    assert [alice.upload(sales_csv, f"{i}.csv").status_code for i in range(3)] == [201, 201, 429]


def test_unauthenticated_upload_is_rejected(anon, sales_csv):
    assert anon.upload(sales_csv).status_code == 401


# ---------------------------------------------------------------- upload tickets


def direct_upload(ticket: str, content: bytes):
    """Upload the way the browser does in production: cross-origin, no cookies."""
    return ApiClient().post(
        "/datasets", files={"file": ("direct.csv", content)}, headers={"Authorization": f"Bearer {ticket}"}
    )


def test_upload_ticket_authorises_one_users_upload_without_cookies(alice, bob, sales_csv):
    ticket = alice.post("/datasets/upload-ticket").json()
    assert ticket["expires_in"] == 300
    response = direct_upload(ticket["ticket"], sales_csv)
    assert response.status_code == 201
    assert alice.get("/datasets").json()["total"] == 1 and bob.get("/datasets").json()["total"] == 0


def test_upload_ticket_grants_nothing_but_uploading(alice, sales_csv):
    ticket = alice.post("/datasets/upload-ticket").json()["ticket"]
    client = ApiClient()
    headers = {"Authorization": f"Bearer {ticket}"}
    assert client.get("/datasets", headers=headers).status_code == 401
    assert client.get("/auth/me", headers=headers).status_code == 401
    assert client.post("/users/me/delete", json={"password": "x"}, headers=headers).status_code == 401


@pytest.mark.parametrize("ticket", ["garbage", "", "a.b.c", "eyJ1aWQiOiJ4In0.forged.signature"])
def test_invalid_upload_tickets_are_rejected(ticket, sales_csv):
    response = direct_upload(ticket, sales_csv) if ticket else ApiClient().upload(sales_csv)
    assert response.status_code == 401


def test_tampered_upload_ticket_is_rejected(alice, bob, sales_csv):
    ticket = alice.post("/datasets/upload-ticket").json()["ticket"]
    payload, rest = ticket.split(".", 1)
    forged = security._ticket_serializer().dump_payload({"uid": bob.get("/auth/me").json()["id"]}).decode()
    assert direct_upload(f"{forged}.{rest}", sales_csv).status_code == 401
    assert direct_upload(payload + "x." + rest, sales_csv).status_code == 401


def test_expired_upload_ticket_is_rejected(alice, sales_csv, monkeypatch):
    ticket = alice.post("/datasets/upload-ticket").json()["ticket"]
    real_time = time.time
    monkeypatch.setattr("itsdangerous.timed.time.time", lambda: real_time() + security.UPLOAD_TICKET_TTL_SECONDS + 5)
    response = direct_upload(ticket, sales_csv)
    assert response.status_code == 401 and response.json()["error"]["code"] == "invalid_upload_ticket"


def test_ticket_of_a_deleted_user_is_rejected(alice, sales_csv):
    from tests.conftest import PASSWORD

    ticket = alice.post("/datasets/upload-ticket").json()["ticket"]
    alice.post("/users/me/delete", json={"password": PASSWORD})
    assert direct_upload(ticket, sales_csv).status_code == 401


def test_cors_allows_only_the_configured_origin_and_never_credentials(anon):
    allowed = anon.http.options(
        "/api/v1/datasets",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-credentials" not in allowed.headers
    denied = anon.http.options(
        "/api/v1/datasets", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}
    )
    assert "access-control-allow-origin" not in denied.headers
