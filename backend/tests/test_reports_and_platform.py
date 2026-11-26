"""Report exports, health endpoints, security headers, error handling and configuration."""

from __future__ import annotations

import io
import json
import logging

import pytest
from openpyxl import load_workbook

from app import __version__
from app.core.config import Settings
from app.core.logging import JsonFormatter
from app.services.report_service import neutralise_formula
from app.workers.analysis_worker import worker
from tests.conftest import DONE, batch, simple_draft

HOSTILE_CELLS = [
    '=HYPERLINK("http://evil.example","click")',
    "+SUM(1,2)",
    "-2+3",
    "@cmd",
    "\t=1+1",
    "=cmd|' /C calc'!A0",
]


def run_report(client, content: bytes, scripted, **gateway) -> str:
    scripted(**gateway)
    dataset_id = client.upload(content).json()["id"]
    analysis_id = client.post("/analyses", json={"dataset_id": dataset_id, "question": "Which region leads?"}).json()[
        "id"
    ]
    worker.process_next()
    analysis = client.get(f"/analyses/{analysis_id}").json()
    assert analysis["status"] == "completed", analysis["error"]
    return analysis["messages"][1]["report_id"]


@pytest.fixture
def report_id(alice, sales_csv, scripted) -> str:
    return run_report(alice, sales_csv, scripted)


# ---------------------------------------------------------------- exports


def test_markdown_export(alice, report_id):
    response = alice.get(f"/reports/{report_id}/export", params={"format": "md"})
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/markdown")
    assert (
        "attachment" in response.headers["content-disposition"]
        and "regional-revenue.md" in response.headers["content-disposition"]
    )
    text = response.text
    assert text.startswith("# Regional revenue")
    for section in (
        "## Executive summary",
        "## Key metrics",
        "## Findings",
        "## Recommendations",
        "## Limitations",
        "## Methodology",
        "## Verification",
    ):
        assert section in text
    assert "| NA | 5 | 8,200 | 47.26 |" in text and "### E1 — Calculating sum of revenue by region" in text
    assert "All figures verified" in text


def test_pdf_export_is_a_real_pdf_with_the_report_text(alice, report_id):
    response = alice.get(f"/reports/{report_id}/export", params={"format": "pdf"})
    assert response.status_code == 200 and response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-") and response.content.rstrip().endswith(b"%%EOF")
    assert len(response.content) > 5000


def test_pdf_export_handles_non_latin_text(alice, scripted):
    content = "région,revenue\nZürich — 北京,100\nМосква,200\nZürich — 北京,50\n".encode()
    draft = simple_draft(
        summary="Zürich — 北京 and Москва were compared.", title="Ünïcödé — 报告", key_metrics=[], findings=[]
    )
    calls = [batch(("aggregate", {"metrics": [{"column": "revenue", "agg": "sum"}], "group_by": ["région"]})), DONE]
    report = run_report(alice, content, scripted, chat=calls, drafts=[draft])
    response = alice.get(f"/reports/{report}/export", params={"format": "pdf"})
    assert response.status_code == 200 and response.content.startswith(b"%PDF-")


def test_excel_export_has_summary_and_evidence_sheets(alice, report_id):
    response = alice.get(f"/reports/{report_id}/export", params={"format": "xlsx"})
    assert response.status_code == 200
    workbook = load_workbook(io.BytesIO(response.content))
    assert workbook.sheetnames == ["Summary", "E1"]
    summary = {row[0]: row[1] for row in workbook["Summary"].iter_rows(values_only=True) if row[0]}
    assert summary["Report"] == "Regional revenue" and summary["Rows"] == 12 and summary["Verification"] == "verified"
    evidence = list(workbook["E1"].iter_rows(values_only=True))
    assert evidence[3][:3] == ("region", "rows", "sum_revenue") and evidence[4][:3] == ("NA", 5, 8200)


def test_csv_export_of_one_evidence_table(alice, report_id):
    response = alice.get(f"/reports/{report_id}/export", params={"format": "csv", "evidence_id": "E1"})
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    lines = response.content.decode("utf-8-sig").splitlines()
    assert lines[0] == "region,rows,sum_revenue,share_pct_revenue" and lines[1] == "NA,5,8200,47.26"


def test_export_argument_validation(alice, report_id):
    assert (
        alice.get(f"/reports/{report_id}/export", params={"format": "csv"}).json()["error"]["code"]
        == "evidence_id_required"
    )
    assert alice.get(f"/reports/{report_id}/export", params={"format": "csv", "evidence_id": "E9"}).status_code == 404
    assert alice.get(f"/reports/{report_id}/export", params={"format": "exe"}).status_code == 422
    assert (
        alice.get(f"/reports/{report_id}/export", params={"format": "csv", "evidence_id": "../E1"}).status_code == 422
    )
    assert alice.get(f"/reports/{report_id}/export").status_code == 422


@pytest.mark.parametrize("value", HOSTILE_CELLS)
def test_formula_like_text_is_neutralised(value):
    assert neutralise_formula(value) == "'" + value


@pytest.mark.parametrize("value", ["plain", "a=b", "3.5", "", 42, -7, -2.5, None, True])
def test_ordinary_values_are_left_alone(value):
    assert neutralise_formula(value) == value


def test_exports_never_contain_live_formulas(alice, scripted):
    """A dataset full of formula payloads must come back out of Excel/CSV exports as inert text."""
    rows = "\n".join(f'"{cell.replace(chr(34), chr(34) * 2)}",{index + 1}' for index, cell in enumerate(HOSTILE_CELLS))
    content = ("label,amount\n" + rows + "\n").encode()
    draft = simple_draft(summary="Rows were listed.", key_metrics=[], findings=[], chart_evidence_ids=[])
    report = run_report(alice, content, scripted, chat=[batch(("filter_rows", {"limit": 20})), DONE], drafts=[draft])

    workbook = load_workbook(io.BytesIO(alice.get(f"/reports/{report}/export", params={"format": "xlsx"}).content))
    cells = [cell for sheet in workbook for row in sheet.iter_rows() for cell in row if cell.value is not None]
    assert not [cell.value for cell in cells if cell.data_type == "f"], "no cell may be stored as a formula"
    exported_labels = [str(cell.value) for cell in workbook["E1"]["A"]][4:]
    assert exported_labels and all(label.startswith("'") for label in exported_labels)

    csv_text = alice.get(f"/reports/{report}/export", params={"format": "csv", "evidence_id": "E1"}).content.decode(
        "utf-8-sig"
    )
    first_cells = [line.lstrip('"')[0] for line in csv_text.splitlines()[1:]]
    assert first_cells == ["'"] * len(HOSTILE_CELLS)


def test_report_list_and_delete(alice, report_id):
    listing = alice.get("/reports").json()
    assert listing["total"] == 1
    item = listing["items"][0]
    assert item["id"] == report_id and item["title"] == "Regional revenue" and "content" not in item
    assert alice.delete(f"/reports/{report_id}").status_code == 204
    assert alice.get(f"/reports/{report_id}").status_code == 404
    # The conversation survives; its message simply no longer links to a report.
    analysis = alice.get("/analyses").json()["items"][0]
    messages = alice.get(f"/analyses/{analysis['id']}").json()["messages"]
    assert messages[1]["report_id"] is None and messages[1]["content"] == "NA leads on revenue."


def test_pagination_bounds(alice):
    assert alice.get("/reports", params={"limit": 0}).status_code == 422
    assert alice.get("/reports", params={"limit": 101}).status_code == 422
    assert alice.get("/reports", params={"offset": -1}).status_code == 422


# ---------------------------------------------------------------- health


@pytest.mark.parametrize("path", ["/health", "/api/v1/health"])
def test_liveness(anon, path):
    response = anon.http.get(path)
    assert response.status_code == 200 and response.json() == {"status": "ok", "version": __version__}


def test_readiness_reports_each_dependency_without_details(anon, settings):
    degraded = anon.http.get("/ready")
    assert degraded.status_code == 503
    assert degraded.json() == {
        "status": "degraded",
        "checks": {"database": "ok", "storage": "ok", "llm": "not_configured"},
    }
    settings.groq_api_key = "gsk_test_secret_value"
    ready = anon.http.get("/api/v1/ready")
    assert ready.status_code == 200 and ready.json()["status"] == "ready"
    assert "gsk_test_secret_value" not in ready.text and "sqlite" not in ready.text


def test_readiness_fails_when_the_database_is_down(anon, monkeypatch):
    def broken():
        raise RuntimeError("could not connect: password=hunter2")

    monkeypatch.setattr("app.api.v1.health.get_engine", broken)
    response = anon.http.get("/ready")
    assert response.status_code == 503 and response.json()["checks"]["database"] == "failed"
    assert "hunter2" not in response.text


# ---------------------------------------------------------------- headers and errors


def test_security_headers_on_api_responses(alice):
    response = alice.get("/datasets")
    headers = response.headers
    assert headers["x-content-type-options"] == "nosniff" and headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "no-referrer" and headers["cache-control"] == "no-store"
    assert headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert len(headers["x-request-id"]) == 32
    assert "strict-transport-security" not in headers  # only sent in production, over HTTPS


def test_errors_share_one_shape_and_carry_the_request_id(alice):
    response = alice.get("/datasets/00000000-0000-0000-0000-000000000000")
    error = response.json()["error"]
    assert set(error) == {"code", "message", "request_id"} and error["code"] == "not_found"
    assert error["request_id"] == response.headers["x-request-id"]
    unknown = alice.get("/no-such-route")
    assert unknown.status_code == 404 and unknown.json()["error"]["code"] == "not_found"
    wrong_method = alice.request("PUT", "/datasets")
    assert wrong_method.status_code == 405 and wrong_method.json()["error"]["code"] == "method_not_allowed"


def test_unhandled_errors_do_not_leak_internals(alice, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    def explode(*_args, **_kwargs):
        raise RuntimeError("SELECT * FROM users WHERE password='hunter2' -- at /srv/app/secret.py")

    monkeypatch.setattr("app.api.v1.datasets.dataset_service.list_datasets", explode)
    client = TestClient(app, raise_server_exceptions=False)
    client.cookies.update(alice.http.cookies)
    response = client.get("/api/v1/datasets")
    assert response.status_code == 500
    error = response.json()["error"]
    assert error["code"] == "internal_error" and error["request_id"] == response.headers["x-request-id"]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "hunter2" not in response.text and "secret.py" not in response.text and "Traceback" not in response.text


def test_oversized_json_body_is_refused(alice):
    response = alice.post(
        "/analyses", content=b"{" + b" " * 70_000 + b"}", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413


def test_malformed_json_is_a_validation_error(alice):
    response = alice.post("/analyses", content=b"{not json", headers={"Content-Type": "application/json"})
    assert response.status_code == 422 and response.json()["error"]["code"] == "validation_error"


def test_openapi_schema_is_served(anon):
    schema = anon.http.get("/openapi.json").json()
    assert schema["info"]["title"] == "AI Workflow Assistant API" and "/api/v1/analyses" in schema["paths"]


# ---------------------------------------------------------------- logging


def test_log_records_are_json_and_redact_sensitive_fields():
    record = logging.LogRecord("app.test", logging.INFO, __file__, 1, "user %s signed in", ("alice",), None)
    record.password = "hunter2"
    record.session_token = "abc123"
    record.api_key = "gsk_live"
    record.user_id = "u-1"
    payload = json.loads(JsonFormatter().format(record))
    assert payload["message"] == "user alice signed in" and payload["user_id"] == "u-1" and payload["level"] == "INFO"
    assert payload["password"] == payload["session_token"] == payload["api_key"] == "[redacted]"


def test_request_log_omits_bodies_cookies_and_query_strings(alice, sales_csv, caplog):
    with caplog.at_level(logging.INFO, logger="app.request"):
        alice.post("/auth/login", json={"email": "alice@example.com", "password": "super-secret-pass-1"})
        alice.upload(sales_csv)
        alice.get("/datasets", params={"limit": 5})
    logged = " ".join(JsonFormatter().format(record) for record in caplog.records)
    assert '"path": "/api/v1/datasets"' in logged and '"status": 201' in logged
    token = alice.http.cookies.get("awa_session")
    assert "super-secret-pass-1" not in logged and token not in logged and "limit=5" not in logged
    assert "8200" not in logged and "O11" not in logged  # no dataset contents


# ---------------------------------------------------------------- configuration


PRODUCTION = {
    "environment": "production",
    "secret_key": "x" * 48,
    "database_url": "postgresql://user:pass@db.example.com:5432/app",
    "storage_backend": "s3",
    "s3_endpoint_url": "https://s3.example.com",
    "s3_access_key_id": "key",
    "s3_secret_access_key": "secret",
    "s3_bucket": "datasets",
}


def test_production_settings_accept_a_complete_configuration():
    settings = Settings(_env_file=None, **PRODUCTION)
    assert settings.is_production and settings.database_url.startswith("postgresql+psycopg://")


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"secret_key": "dev-only-secret-change-me"}, "SECRET_KEY"),
        ({"secret_key": "too-short"}, "SECRET_KEY"),
        ({"database_url": "sqlite:///./dev.db"}, "PostgreSQL"),
        ({"storage_backend": "local"}, "STORAGE_BACKEND"),
        ({"s3_bucket": None}, "s3_bucket"),
    ],
)
def test_production_refuses_unsafe_configuration(override, message):
    with pytest.raises(ValueError, match=message):
        Settings(_env_file=None, **{**PRODUCTION, **override})


def test_provider_database_urls_are_normalised():
    assert Settings(_env_file=None, database_url="postgres://u:p@h/db").database_url == "postgresql+psycopg://u:p@h/db"
    assert Settings(_env_file=None, frontend_origins="https://a.example/, https://b.example").cors_origins == [
        "https://a.example",
        "https://b.example",
    ]
