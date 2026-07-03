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
