"""End-to-end smoke test against a running deployment.

    python scripts/smoke_test.py --base-url http://localhost:8000
    python scripts/smoke_test.py --base-url https://your-app.vercel.app   # through the frontend proxy

Walks the full user journey with two throwaway accounts: register, upload a generated dataset,
run a real analysis, read and export the report, sign out and back in, and check that a second
user cannot reach the first user's data. Both accounts are deleted at the end.

Exit code 0 means every step passed. The analysis step calls the real model, so it consumes
quota; pass --skip-analysis to check everything else.
"""

from __future__ import annotations

import argparse
import io
import random
import secrets
import sys
import time
from typing import Any

import httpx

CSRF_COOKIE = "awa_csrf"
QUESTION = (
    "Analyze regional sales performance, identify underperforming regions, "
    "calculate revenue growth, and recommend actions."
)


def build_csv(rows: int = 600) -> bytes:
    """A small but realistic sales dataset, generated deterministically."""
    rng = random.Random(42)  # noqa: S311 - test data, not security
    regions = [("North America", 1.0), ("Europe", 0.8), ("APAC", 0.6), ("LATAM", 0.3)]
    channels = ["Online", "Retail", "Partner"]
    out = io.StringIO()
    out.write("order_id,order_date,region,channel,units,unit_price,revenue\n")
    for index in range(rows):
        month = rng.randint(1, 12)
        region, weight = rng.choice(regions)
        units = max(1, int(rng.gauss(20, 8) * weight * (1 + month / 24)))
        price = round(rng.uniform(80, 320), 2)
        out.write(
            f"ORD-{index:05d},2025-{month:02d}-{rng.randint(1, 28):02d},{region},{rng.choice(channels)},"
            f"{units},{price},{round(units * price, 2)}\n"
        )
    return out.getvalue().encode()


class Client:
    """Thin wrapper that sends the CSRF header the way the browser frontend does."""

    def __init__(self, base_url: str):
        self.http = httpx.Client(base_url=base_url.rstrip("/") + "/api/v1", timeout=120, follow_redirects=True)

    def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = dict(kwargs.pop("headers", {}))
        if token := self.http.cookies.get(CSRF_COOKIE):
            headers["X-CSRF-Token"] = token
        return self.http.request(method, path, headers=headers, **kwargs)


class Checker:
    def __init__(self) -> None:
        self.failures = 0
        self.passed = 0

    def check(self, name: str, condition: bool, detail: str = "") -> bool:
        if condition:
            self.passed += 1
            print(f"  PASS  {name}")
        else:
            self.failures += 1
            print(f"  FAIL  {name}  {detail}")
        return condition


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--skip-analysis", action="store_true")
    parser.add_argument("--timeout", type=int, default=600, help="Seconds to wait for the analysis.")
    args = parser.parse_args()

    c = Checker()
    suffix = secrets.token_hex(5)
    password = "Smoke-" + secrets.token_urlsafe(12)
    alice, bob = Client(args.base_url), Client(args.base_url)
    alice_email, bob_email = f"smoke-a-{suffix}@example.com", f"smoke-b-{suffix}@example.com"
    print(f"Target: {args.base_url}")

    root = httpx.get(args.base_url.rstrip("/") + "/api/v1/health", timeout=120, follow_redirects=True)
    if not c.check("health endpoint", root.status_code == 200 and root.json().get("status") == "ok", root.text[:200]):
        return 1
    ready = httpx.get(args.base_url.rstrip("/") + "/api/v1/ready", timeout=120, follow_redirects=True)
    c.check("readiness (database, storage, model key)", ready.status_code == 200, ready.text[:300])

    r = alice.request("GET", "/auth/me")
    c.check("unauthenticated request is rejected", r.status_code == 401, str(r.status_code))

    r = alice.request("POST", "/auth/register", json={"email": alice_email, "password": password, "name": "Smoke A"})
    if not c.check("register", r.status_code == 201, r.text[:300]):
        return 1
    r = bob.request("POST", "/auth/register", json={"email": bob_email, "password": password, "name": "Smoke B"})
    c.check("register second user", r.status_code == 201, r.text[:300])

    try:
        r = alice.http.post("/datasets", files={"file": ("x.csv", b"a,b\n1,2\n")})  # no CSRF header
        c.check("state-changing request without CSRF token is rejected", r.status_code == 403, str(r.status_code))

        r = alice.request("POST", "/datasets", files={"file": ("payload.exe", b"MZ\x90\x00binary")})
        c.check("disallowed file type is rejected", r.status_code == 422, str(r.status_code))

        # A path-traversal filename never becomes a path. Hosting providers' edge firewalls
        # (Render, Vercel) block it with their own 403 before it reaches the API; without them
        # the API stores the file under the bare name.
        r = alice.request("POST", "/datasets", files={"file": ("../../etc/passwd.csv", b"a,b\n1,2\n")})
        traversal_safe = r.status_code == 403 or (
            r.status_code == 201 and r.json().get("original_filename") == "passwd.csv"
        )
        c.check("path-traversal filename is neutralised", traversal_safe, f"{r.status_code} {r.text[:200]}")
        if r.status_code == 201:
            alice.request("DELETE", f"/datasets/{r.json()['id']}")

        r = alice.request("POST", "/datasets", files={"file": ("sales smoke.csv", build_csv(), "text/csv")})
        if not c.check("upload CSV", r.status_code == 201, r.text[:300]):
            return 1
        dataset = r.json()
        dataset_id = dataset["id"]
        c.check("dataset profiled", dataset["row_count"] == 600 and len(dataset["profile"]["columns"]) == 7)
        kinds = {col["name"]: col["kind"] for col in dataset["profile"]["columns"]}
        c.check(
            "column types inferred",
            kinds.get("order_date") == "datetime" and kinds.get("revenue") == "numeric",
            str(kinds),
        )

        r = alice.request("POST", "/datasets/upload-ticket")
        ticket = r.json().get("ticket", "")
        direct = httpx.post(
            args.base_url.rstrip("/") + "/api/v1/datasets",
            headers={"Authorization": f"Bearer {ticket}"},
            files={"file": ("ticket upload.csv", b"city,sales\nOslo,10\nRome,20\nLima,30\n", "text/csv")},
            timeout=120,
        )
        c.check("upload with upload ticket (no cookies)", direct.status_code == 201, direct.text[:300])

        r = alice.request("GET", f"/datasets/{dataset_id}/preview", params={"limit": 5})
        c.check("dataset preview", r.status_code == 200 and len(r.json()["rows"]) == 5, r.text[:200])
        r = alice.request("GET", f"/datasets/{dataset_id}/suggestions")
        c.check("suggested questions", r.status_code == 200 and len(r.json()["questions"]) >= 2, r.text[:200])

        r = bob.request("GET", f"/datasets/{dataset_id}")
        c.check("other user cannot read the dataset", r.status_code == 404, str(r.status_code))
        r = bob.request("DELETE", f"/datasets/{dataset_id}")
        c.check("other user cannot delete the dataset", r.status_code == 404, str(r.status_code))
        r = bob.request("POST", "/analyses", json={"dataset_id": dataset_id, "question": QUESTION})
        c.check("other user cannot analyse the dataset", r.status_code == 404, str(r.status_code))

        if not args.skip_analysis:
            r = alice.request("POST", "/analyses", json={"dataset_id": dataset_id, "question": QUESTION})
            if not c.check("queue analysis", r.status_code == 202, r.text[:300]):
                return 1
            analysis_id = r.json()["id"]
            started, last_event, status, labels = time.monotonic(), 0, "queued", []
            while time.monotonic() - started < args.timeout:
                r = alice.request("GET", f"/analyses/{analysis_id}/events", params={"after": last_event})
                body = r.json()
                for event in body["events"]:
                    last_event = event["id"]
                    if (event.get("detail") or {}).get("state") != "running":
                        labels.append(event["label"])
                        print(f"        · {event['label']}")
                status = body["status"]
                if status in ("completed", "failed", "cancelled"):
                    break
                time.sleep(2)
            elapsed = time.monotonic() - started
            if not c.check(
                f"analysis completed ({elapsed:.0f}s)",
                status == "completed",
                f"status={status} error={body.get('error')}",
            ):
                return 1
            c.check("progress events were reported", len(labels) >= 4, str(labels))

            r = bob.request("GET", f"/analyses/{analysis_id}")
            c.check("other user cannot read the analysis", r.status_code == 404, str(r.status_code))

            r = alice.request("GET", f"/analyses/{analysis_id}")
            messages = r.json()["messages"]
            report_id = next((m["report_id"] for m in messages if m["role"] == "assistant"), None)
            if not c.check("analysis has a report", bool(report_id)):
                return 1
            r = alice.request("GET", f"/reports/{report_id}")
            report = r.json()["content"]
            c.check(
                "report has summary, metrics and findings",
                bool(report["executive_summary"]) and bool(report["findings"]) and bool(report["key_metrics"]),
            )
            c.check("report has computed evidence", len(report["methodology"]) >= 1)
            c.check(
                "report has chart data from tools",
                any(v["chart"]["data"] for v in report["visualizations"]),
                "no visualizations",
            )
            c.check(
                f"figures verified ({report['verification']['status']}, {report['verification']['numbers_checked']} checked)",
                report["verification"]["numbers_checked"] > 0,
            )

            # Independent check: the largest region total in the evidence must equal a direct recomputation.
            import csv as _csv

            totals: dict[str, float] = {}
            for row in _csv.DictReader(io.StringIO(build_csv().decode())):
                totals[row["region"]] = totals.get(row["region"], 0.0) + float(row["revenue"])
            expected = round(max(totals.values()), 2)
            found = any(
                isinstance(value, int | float) and abs(float(value) - expected) < 0.01
                for record in report["methodology"]
                if record.get("table")
                for row in record["table"]["rows"]
                for value in row
            )
            c.check(f"evidence matches an independent recomputation (top region revenue {expected:,.2f})", found)

            r = bob.request("GET", f"/reports/{report_id}")
            c.check("other user cannot read the report", r.status_code == 404, str(r.status_code))
            r = bob.request("GET", f"/reports/{report_id}/export", params={"format": "pdf"})
            c.check("other user cannot export the report", r.status_code == 404, str(r.status_code))

            r = alice.request("GET", f"/reports/{report_id}/export", params={"format": "md"})
            c.check("export Markdown", r.status_code == 200 and r.text.startswith("# "), str(r.status_code))
            r = alice.request("GET", f"/reports/{report_id}/export", params={"format": "pdf"})
            c.check("export PDF", r.status_code == 200 and r.content.startswith(b"%PDF"), str(r.status_code))
            r = alice.request("GET", f"/reports/{report_id}/export", params={"format": "xlsx"})
            c.check("export Excel", r.status_code == 200 and r.content.startswith(b"PK"), str(r.status_code))
            table_id = next((rec["id"] for rec in report["methodology"] if rec.get("table")), None)
            if table_id:
                r = alice.request(
                    "GET", f"/reports/{report_id}/export", params={"format": "csv", "evidence_id": table_id}
                )
                c.check("export CSV table", r.status_code == 200 and "," in r.text, str(r.status_code))

            alice.request("POST", "/auth/logout")
            r = alice.request("GET", "/reports")
            c.check("signed out: reports are not accessible", r.status_code == 401, str(r.status_code))
            r = alice.request("POST", "/auth/login", json={"email": alice_email, "password": password})
            c.check("sign in again", r.status_code == 200, r.text[:200])
            r = alice.request("GET", "/reports")
            c.check("report persisted across sessions", r.status_code == 200 and r.json()["total"] == 1, r.text[:200])
            r = alice.request("GET", "/datasets")
            c.check("datasets persisted across sessions", r.status_code == 200 and r.json()["total"] == 2, r.text[:200])

        r = bob.request("GET", "/datasets")
        c.check("other user's dataset list is empty", r.status_code == 200 and r.json()["total"] == 0, r.text[:200])
        r = alice.request("POST", "/auth/login", json={"email": alice_email, "password": "wrong-password-123"})
        c.check("wrong password is rejected", r.status_code == 401, str(r.status_code))
    finally:
        for client, email in ((alice, alice_email), (bob, bob_email)):
            client.request("POST", "/auth/login", json={"email": email, "password": password})
            r = client.request("POST", "/users/me/delete", json={"password": password})
            c.check(f"cleanup: delete {email.split('@')[0]}", r.status_code == 204, f"{r.status_code} {r.text[:200]}")

    print(f"\n{c.passed} passed, {c.failures} failed")
    return 1 if c.failures else 0


if __name__ == "__main__":
    sys.exit(main())
