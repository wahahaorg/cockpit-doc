from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.modules.cashflow import models as cashflow_models  # noqa
from app.modules.data_import import models as import_models  # noqa
from tests.unit.test_parser import workbook_bytes


@pytest.fixture
def client():
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(engine, expire_on_commit=False)
    def override():
        with Session() as db: yield db
    app.dependency_overrides[get_db] = override
    with TestClient(app) as test_client: yield test_client
    app.dependency_overrides.clear()


def test_import_publish_and_dashboard(client):
    response = client.post("/api/v1/imports", data={"templateVersion": "V0.1", "dataPeriodStart": "2026-05-01", "dataPeriodEnd": "2026-07-31"}, files={"file": ("sample.xlsx", workbook_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert response.status_code == 201, response.text
    batch = response.json()["data"]
    assert batch["errorRows"] == 0
    published = client.post(f"/api/v1/imports/{batch['id']}:publish", json={"version": batch["version"], "reviewNote": "测试确认"})
    assert published.status_code == 200, published.text
    overview = client.get("/api/v1/cockpit/overview", params={"asOfDate": "2026-07-02"})
    assert overview.status_code == 200, overview.text
    assert overview.json()["data"]["metrics"]["availableCash"] == "3000000.00"
    assert overview.json()["data"]["metrics"]["overdueAmount"] == "1000000.00"
    risks = client.get("/api/v1/receivable-risks", params={"asOfDate": "2026-07-02"})
    assert risks.json()["data"][0]["riskLevel"] == "red"


def test_uniform_error_shape(client):
    response = client.get("/api/v1/cockpit/overview")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "published_batch_not_found"


def test_deterministic_cockpit_modules(client):
    response = client.post("/api/v1/imports", data={"templateVersion": "V0.1", "dataPeriodStart": "2026-05-01", "dataPeriodEnd": "2026-09-30"}, files={"file": ("modules.xlsx", workbook_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    batch = response.json()["data"]
    published = client.post(f"/api/v1/imports/{batch['id']}:publish", json={"version": batch["version"]})
    assert published.status_code == 200, published.text

    forecast = client.get("/api/v1/cashflow-forecasts", params={"asOfDate": "2026-07-02"})
    assert forecast.status_code == 200, forecast.text
    assert len(forecast.json()["data"]["daily"]) == 90
    assert {item["days"] for item in forecast.json()["data"]["windows"]} == {30, 60, 90}

    risk_top3 = client.get("/api/v1/receivable-risks/top3", params={"asOfDate": "2026-07-02"})
    assert risk_top3.status_code == 200
    assert risk_top3.json()["data"]["redCount"] == 1
    assert risk_top3.json()["data"]["items"][0]["reasonCodes"] == ["overdue_30_days", "overdue_large_amount"]

    payments = client.get("/api/v1/payment-recommendations/top3", params={"asOfDate": "2026-07-02"})
    assert payments.status_code == 200, payments.text
    payment = payments.json()["data"]["items"][0]
    assert payment["decision"] == "pay"
    assert payment["aiExplanation"] is None
    payment_explanation = client.post(f"/api/v1/payment-recommendations/{payment['id']}/ai-explanation")
    assert payment_explanation.status_code == 200, payment_explanation.text
    assert payment_explanation.json()["data"]["cached"] is False
    assert "一句话结论" in payment_explanation.json()["data"]["aiExplanation"]
    cached_explanation = client.post(f"/api/v1/payment-recommendations/{payment['id']}/ai-explanation")
    assert cached_explanation.status_code == 200, cached_explanation.text
    assert cached_explanation.json()["data"]["cached"] is True

    events = client.get("/api/v1/decision-events", params={"asOfDate": "2026-07-02"})
    assert events.status_code == 200, events.text
    event = events.json()["data"][0]
    assert event["eventType"] == "receivable_risk"
    explanation = client.get(f"/api/v1/decision-events/{event['id']}/ai-explanation:stream")
    assert explanation.status_code == 200
    assert explanation.headers["content-type"].startswith("text/event-stream")
    assert "一句话结论" in explanation.text
    assert '"degraded": true' in explanation.text
    decided = client.post(f"/api/v1/decision-events/{event['id']}:decide", json={"option": "escalate_collection", "note": "升级处理", "version": event["version"]})
    assert decided.status_code == 200, decided.text
    assert decided.json()["data"]["status"] == "decided"
    refreshed = client.get("/api/v1/decision-events", params={"asOfDate": "2026-07-02"})
    assert refreshed.status_code == 200
    assert refreshed.json()["pagination"]["total"] == 0
