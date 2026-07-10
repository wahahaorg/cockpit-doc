import logging
import uuid

from fastapi import FastAPI, Request

from app.core.config import get_settings
from app.core.exceptions import install_exception_handlers
from app.modules.cashflow.controller import router as cashflow_router
from app.modules.ai.controller import router as ai_router
from app.modules.dashboard.controller import router as dashboard_router
from app.modules.data_import.controller import router as import_router
from app.modules.decision.controller import router as decision_router
from app.modules.income_reconciliation.controller import router as income_reconciliation_router

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logging.getLogger("app").setLevel(logging.INFO)

app = FastAPI(title=get_settings().app_name, version="0.1.0")


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-Id", f"req_{uuid.uuid4().hex}")
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    return response


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(import_router, prefix="/api/v1")
app.include_router(cashflow_router, prefix="/api/v1")
app.include_router(dashboard_router, prefix="/api/v1")
app.include_router(decision_router, prefix="/api/v1")
app.include_router(ai_router, prefix="/api/v1")
app.include_router(income_reconciliation_router, prefix="/api/v1")
install_exception_handlers(app)
