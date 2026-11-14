"""Accounts, sessions, CSRF protection and rate limiting."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.db import session_scope, utcnow
from app.core.security import hash_token, verify_password
from app.models import User, UserSession
from tests.conftest import PASSWORD, ApiClient


def test_register_starts_a_session(anon):
    response = anon.post(
        "/auth/register", json={"email": "  New@Example.com ", "password": PASSWORD, "name": " New   User "}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "new@example.com" and body["name"] == "New User"
    assert "password" not in str(body).lower()
    assert anon.get("/auth/me").json()["email"] == "new@example.com"


def test_session_cookie_is_httponly_and_csrf_cookie_is_readable(anon):
    response = anon.post("/auth/register", json={"email": "c@example.com", "password": PASSWORD, "name": "C"})
    cookies = response.headers.get_list("set-cookie")
    session = next(c for c in cookies if c.startswith("awa_session="))
    csrf = next(c for c in cookies if c.startswith("awa_csrf="))
    assert "HttpOnly" in session and "SameSite=lax" in session and "Path=/" in session
    assert "HttpOnly" not in csrf and "SameSite=lax" in csrf


def test_passwords_are_stored_as_argon2id_hashes_and_tokens_as_digests(alice):
    token = alice.http.cookies.get("awa_session")
    with session_scope() as db:
        user = db.scalar(select(User))
        stored = db.scalar(select(UserSession))
        assert user.password_hash.startswith("$argon2id$") and PASSWORD not in user.password_hash
        assert verify_password(PASSWORD, user.password_hash)
        assert stored.token_hash == hash_token(token) and stored.token_hash != token


def test_duplicate_email_is_rejected(alice, anon):
    response = anon.post("/auth/register", json={"email": "ALICE@example.com", "password": PASSWORD, "name": "Other"})
    assert response.status_code == 409 and response.json()["error"]["code"] == "email_taken"


@pytest.mark.parametrize(
    ("payload", "fragment"),
    [
        ({"email": "a@example.com", "password": "short", "name": "A"}, "at least 10"),
        ({"email": "a@example.com", "password": "1234567890123", "name": "A"}, "too simple"),
        ({"email": "a@example.com", "password": "aaaaaaaaaaaa", "name": "A"}, "too simple"),
        ({"email": "not-an-email", "password": PASSWORD, "name": "A"}, "valid email"),
        ({"email": "a@example.com", "password": PASSWORD, "name": "   "}, "name"),
        ({"email": "a@example.com", "password": "x" * 200, "name": "A"}, "at most 128"),
    ],
)
def test_registration_validation(anon, payload, fragment):
    response = anon.post("/auth/register", json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error" and fragment in str(error).lower()
    assert payload["password"] not in str(error)  # the submitted password is never echoed back


def test_login_logout_cycle(alice):
    alice.post("/auth/logout")
    assert alice.get("/auth/me").status_code == 401
    assert alice.post("/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 200
    assert alice.get("/auth/me").status_code == 200


def test_wrong_password_and_unknown_email_look_the_same(alice, anon):
    wrong = anon.post("/auth/login", json={"email": "alice@example.com", "password": "not-the-password-1"})
    unknown = anon.post("/auth/login", json={"email": "nobody@example.com", "password": "not-the-password-1"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"] == "Incorrect email or password."


def test_logout_revokes_the_session_on_the_server(alice):
    stolen = alice.http.cookies.get("awa_session")
    alice.post("/auth/logout")
    thief = ApiClient()
    thief.http.cookies.set("awa_session", stolen)
    assert thief.get("/auth/me").status_code == 401


def test_expired_session_is_rejected(alice):
    with session_scope() as db:
        db.scalar(select(UserSession)).expires_at = utcnow() - timedelta(seconds=1)
    assert alice.get("/auth/me").status_code == 401


def test_forged_session_cookie_is_rejected(anon):
    anon.http.cookies.set("awa_session", "forged-token-value")
    assert anon.get("/auth/me").status_code == 401


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PATCH", "/users/me", {"name": "X"}),
        ("POST", "/users/me/password", {"current_password": PASSWORD, "new_password": "another-good-pass-1"}),
        ("POST", "/users/me/delete", {"password": PASSWORD}),
        ("POST", "/datasets/upload-ticket", None),
        ("DELETE", "/datasets/00000000-0000-0000-0000-000000000000", None),
        ("POST", "/analyses", {"dataset_id": "00000000-0000-0000-0000-000000000000", "question": "hello there"}),
    ],
)
def test_state_changing_requests_need_the_csrf_header(alice, method, path, body):
    missing = alice.request(method, path, json=body, csrf=False)
    assert missing.status_code == 403 and missing.json()["error"]["code"] == "csrf_failed"
    wrong = alice.request(method, path, json=body, csrf=False, headers={"X-CSRF-Token": "wrong"})
    assert wrong.status_code == 403
    assert alice.get("/auth/me").json()["name"] == "Alice"  # nothing was changed


def test_reads_do_not_need_the_csrf_header(alice):
    assert alice.request("GET", "/datasets", csrf=False).status_code == 200


def test_update_profile(alice):
    assert alice.patch("/users/me", json={"name": "  Alice   Cooper "}).json()["name"] == "Alice Cooper"
    assert alice.patch("/users/me", json={"name": ""}).status_code == 422


def test_change_password_signs_out_other_devices(alice):
    other_device = ApiClient()
    other_device.post("/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
    assert other_device.get("/auth/me").status_code == 200

    new_password = "a-brand-new-passphrase-7"
    wrong = alice.post(
        "/users/me/password", json={"current_password": "wrong-password-1", "new_password": new_password}
    )
    assert wrong.status_code == 401
    assert (
        alice.post("/users/me/password", json={"current_password": PASSWORD, "new_password": new_password}).status_code
        == 204
    )

    assert alice.get("/auth/me").status_code == 200  # this device stays signed in
    assert other_device.get("/auth/me").status_code == 401
    assert ApiClient().post("/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 401
    assert (
        ApiClient().post("/auth/login", json={"email": "alice@example.com", "password": new_password}).status_code
        == 200
    )


def test_delete_account_requires_password_and_removes_everything(alice, sales_csv):
    from app.models import Dataset
    from app.services.storage_service import ObjectNotFoundError, get_storage

    assert alice.upload(sales_csv).status_code == 201
    with session_scope() as db:
        key = db.scalar(select(Dataset.storage_key))
    assert get_storage().get(key)

    assert alice.post("/users/me/delete", json={"password": "wrong-password-1"}).status_code == 401
    assert alice.post("/users/me/delete", json={"password": PASSWORD}).status_code == 204
    assert alice.get("/auth/me").status_code == 401
    with session_scope() as db:
        assert (
            db.scalar(select(User)) is None
            and db.scalar(select(Dataset)) is None
            and db.scalar(select(UserSession)) is None
        )
    with pytest.raises(ObjectNotFoundError):
        get_storage().get(key)
    assert ApiClient().post("/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 401


def test_usage_reports_limits(alice, settings):
    usage = alice.get("/users/me/usage").json()
    assert usage["analyses_today"] == 0 and usage["datasets"] == 0 and usage["storage_used_bytes"] == 0
    assert usage["daily_analysis_limit"] == settings.daily_analysis_limit
    assert usage["max_upload_bytes"] == settings.max_upload_mb * 1024 * 1024


def test_login_attempts_are_rate_limited(alice, settings):
    settings.rate_limit_auth_per_minute = 5
    client = ApiClient()
    statuses = [
        client.post("/auth/login", json={"email": "alice@example.com", "password": f"wrong-password-{i}"}).status_code
        for i in range(7)
    ]
    # Registration in the fixture already used one of the five attempts allowed per address.
    assert statuses == [401] * 4 + [429] * 3
    limited = client.post("/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
    assert limited.status_code == 429 and limited.json()["error"]["code"] == "rate_limited"
    assert int(limited.headers["retry-after"]) >= 1


def test_login_limit_follows_the_account_across_addresses(alice, settings):
    """Guessing one account's password from many addresses is still limited."""
    from app.core.rate_limit import rate_limiter

    settings.rate_limit_auth_per_minute = 3
    statuses = []
    for attempt in range(5):
        rate_limiter._hits.pop("auth:testclient", None)  # simulate a fresh source address each time
        response = ApiClient().post(
            "/auth/login", json={"email": "alice@example.com", "password": f"wrong-password-{attempt}"}
        )
        statuses.append(response.status_code)
    assert statuses == [401, 401, 401, 429, 429]


def test_api_requests_are_rate_limited_per_user(alice, bob, settings):
    settings.rate_limit_api_per_minute = 3
    assert [alice.get("/datasets").status_code for _ in range(5)] == [200, 200, 200, 429, 429]
    assert bob.get("/datasets").status_code == 200  # another user's budget is unaffected
